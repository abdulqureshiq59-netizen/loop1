const { getAIReply, LANGUAGE } = require("./aiReply");
const { checkHandoff } = require("../services/handoffDetector");
const { sendTextMessage } = require("../utils/whatsappAPI");
const conversationState = require("../services/conversationState");
const { extractPropertyId, findPropertyById, getAllProperties, getAllProjects } = require("../services/propertyLookup");
const { extractLeadInfo } = require("../services/leadExtractor");
const { extractVisitInfo } = require("../services/visitExtractor");
const { matchProperties } = require("../services/propertyMatcher");
const { transcribeAudio } = require("../services/transcribeAudio");
const { upsertLead } = require("../services/leadSync");
const leadsDb = require("../services/leadsDb");
const adminNotify = require("../services/adminNotify");
const logger = require("../utils/logger");

const HANDOFF_MESSAGE = LANGUAGE === "en"
  ? "Understood — I'm connecting you with one of our agents now, they'll take it from here."
  : "Entendido — te voy a conectar con uno de nuestros agentes, ellos van a continuar la conversación.";

async function handleIncomingMessage(message, from) {
  try {
    let type = message.type;
    let text;

    if (type === "text") {
      text = message.text.body;
    } else if (type === "audio") {
      // Voice note (2026-09-19): transcribe with Whisper and, if that
      // succeeds, treat it exactly like a normal text message from here on
      // — same qualification, property matching, and handoff logic. If
      // transcription fails for any reason, fall back to the old generic
      // behavior instead of crashing the whole message.
      const transcribed = await transcribeAudio(message.audio?.id);
      if (transcribed) {
        text = transcribed;
        type = "text";
        logger.info(`Transcribed voice note from ${from}: "${text}"`);
      } else {
        text = "[audio message — could not transcribe]";
        logger.error(`Failed to transcribe voice note from ${from}`);
      }
    } else {
      text = `[${type} message]`;
    }

    logger.info(`Incoming from ${from} (${message.type}): "${text}"`);

    conversationState.addMessage(from, "customer", text);

    // Authoritative check straight from the database (see leadsDb.getMode
    // comment) — avoids a race right after a Render cold start where the
    // in-memory cache hasn't finished hydrating yet and the AI would
    // otherwise incorrectly reply to a human-controlled conversation.
    const currentMode = await leadsDb.getMode(from);
    if (currentMode === "human") {
      logger.info(`Mode is HUMAN for ${from} — AI stays silent`);
      return;
    }

    if (type === "text") {
      const propId = extractPropertyId(text);
      if (propId) {
        const property = await findPropertyById(propId, text);
        if (property) conversationState.setProperty(from, property);
      }
    }

    // Spec #8/#11: auto-detect complaints, requests for a human, price
    // negotiation, or high buying intent — hand off instead of letting the
    // AI keep answering.
    if (type === "text") {
      const handoffResult = await checkHandoff(text);
      if (handoffResult.handoff) {
        logger.info(`Handoff triggered for ${from}: ${handoffResult.reason}`);
        conversationState.addMessage(from, "ai", HANDOFF_MESSAGE);
        await sendTextMessage(from, HANDOFF_MESSAGE);
        conversationState.setMode(from, "human");
        qualifyLeadInBackground(from, text);
        return;
      }
    }

    const reply = type === "text"
      ? await getAIReply(from, text, conversationState.getProperty(from))
      : "Got your message. An agent will follow up shortly.";

    conversationState.addMessage(from, "ai", reply);
    await sendTextMessage(from, reply);

    if (type === "text") {
      qualifyLeadInBackground(from, text);
    }
  } catch (err) {
    logger.error("Error in handleIncomingMessage:", err);
  }
}

function qualifyLeadInBackground(from, text) {
  const conv = conversationState.getConversation(from);
  extractLeadInfo(conv.messages)
    .then(async lead => {
      if (!lead) return;
      conversationState.setLead(from, lead);
      const property = conversationState.getProperty(from);
      await upsertLead(from, {
        name: lead.name || "", channel: "WhatsApp",
        operation: lead.operation || "", type: lead.type || "",
        zone: lead.zone || "", bedrooms: lead.bedrooms || "",
        bathrooms: lead.bathrooms || "",
        budget: lead.budget || "", financing: lead.financing || "",
        timeline: lead.timeline || "", temperature: lead.temperature || "Frio",
        features: lead.features || "", address: lead.address || "", postcode: lead.postcode || "",
        property_id: property ? property.prop_id : "",
        agent_name: property ? property.agent_name : "",
        last_message: text,
      });
      await maybeSuggestProperties(from, lead);
      await maybeMarkVisitScheduled(from, conv.messages, lead, property);
    })
    .catch(err => {
      logger.error(`Background lead qualification failed for ${from}:`, err.message);
    });
}

// Client requirement (2026-09-19): when the customer confirms they want an
// in-person/on-site visit AND gives a day/time, move the lead straight to
// the VISITA pipeline stage and alert the admin — instead of relying on an
// agent to notice this in the chat and drag the pipeline card manually.
// Runs on every message like the other background qualification steps, but
// is gated by conversationState.visitScheduled so it only ever fires once
// per conversation.
async function maybeMarkVisitScheduled(from, messages, lead, property) {
  try {
    if (conversationState.getVisitScheduled(from)) return;

    const { visitConfirmed, visitWhen } = await extractVisitInfo(messages);
    if (!visitConfirmed) return;

    conversationState.setVisitScheduled(from, true);
    await leadsDb.bumpStageTo(from, "VISITA");
    logger.info(`Visit scheduled detected for ${from}${visitWhen ? ` (${visitWhen})` : ""} — moved to VISITA`);

    // bumpStageTo already sends the admin alert on the CALIENTE/VISITA
    // transition itself (services/leadsDb.js -> notifyOnStageChange), but
    // that alert only has whatever was already in the leads row (e.g. the
    // customer's own address, not the property's, and no visitWhen at
    // all). Send a second, more specific alert with what this classifier
    // actually extracted, so the admin isn't left guessing the day/time.
    await adminNotify.notifyVisitScheduled(from, {
      name: lead?.name || "",
      visitWhen: visitWhen || "",
      property: property ? `${property.title} (${property.zone})` : "",
      link: property ? property.link : "",
      property_id: property ? property.prop_id : (lead?.property_id || ""),
    });
  } catch (err) {
    logger.error(`Visit detection failed for ${from}:`, err.message);
  }
}

// Spec #4/#5: once we know enough about what the customer (buyer/renter/
// investor — not a seller, who isn't looking for a property) wants, search
// the real NAI catalog and actually send them matches, instead of the AI
// just chatting about wanting to help and never looking anything up. Sent
// at most once per conversation (conversationState.propertiesSuggested)
// so this doesn't re-fire and resend the same list on every later message.
async function maybeSuggestProperties(from, lead) {
  try {
    if (!lead.operation || lead.operation === "venta") return; // sellers aren't looking for a property

    // `type` is intentionally NOT required (see 2026-09-19 note below), but
    // `postcode` IS required — it's the last field in every checklist
    // (aiReply.js), right before the AI hands off. Requiring it means the
    // suggestion message only goes out once the whole flow is done, not
    // mid-conversation right after bedrooms/bathrooms — which is what was
    // happening before: the customer got the property list AND THEN the AI
    // kept asking financing/timeline questions afterwards, because the
    // suggestion (background, async) and the main AI reply (immediate)
    // don't know about each other and postcode wasn't required as a gate.
    //
    // `type` note (2026-09-19): leadExtractor's "Caliente" classification
    // only requires zone + budget + operation (not type) — so a lead can be
    // fully qualified with lead.type still null, and requiring it here used
    // to silently block property matching from ever running in that case.
    if (!lead.zone || !lead.budget || !lead.postcode) {
      logger.info(`Skipping property suggestion for ${from}: flow not complete yet (zone=${lead.zone || "null"}, budget=${lead.budget || "null"}, postcode=${lead.postcode || "null"})`);
      return;
    }
    if (conversationState.getPropertiesSuggested(from)) {
      logger.info(`Skipping property suggestion for ${from}: already sent once this conversation (resets when the chat is handed back to AI from human mode)`);
      return;
    }

    const [properties, projects] = await Promise.all([getAllProperties(), getAllProjects()]);
    logger.info(`Matching properties for ${from}: ${properties.length} properties + ${projects.length} projects loaded, criteria zone=${lead.zone} budget=${lead.budget} type=${lead.type || "any"} bedrooms=${lead.bedrooms || "any"} operation=${lead.operation || "any"}`);
    const matches = await matchProperties(
      { zone: lead.zone, budget: lead.budget, type: lead.type, bedrooms: lead.bedrooms, operation: lead.operation },
      [...properties, ...projects]
    );
    if (!matches.length) {
      logger.info(`No property matches found for ${from} against the given criteria`);
      return;
    }
    logger.info(`Found ${matches.length} property match(es) for ${from}, sending top ${Math.min(3, matches.length)}`);

    const top = matches.slice(0, 3);
    const lines = top.map((p, i) => {
      const price = p.price_display || (LANGUAGE === "en" ? "price on request" : "precio a consultar");
      return `${i + 1}. ${p.title} — ${price} (${p.link})`;
    });
    const intro = LANGUAGE === "en"
      ? "Here are a few properties that match what you're looking for:"
      : "¡Encontramos estas propiedades que podrían interesarte!";
    const outro = LANGUAGE === "en"
      ? `An agent (${top[0].agent_name || "the assigned agent"}) will follow up with more details.`
      : `Un agente (${top[0].agent_name || "el agente asignado"}) va a seguir con más detalles.`;
    const message = `${intro}\n\n${lines.join("\n")}\n\n${outro}`;

    conversationState.addMessage(from, "ai", message);
    await sendTextMessage(from, message);
    conversationState.setPropertiesSuggested(from, true);

    // Record which property/agent this lead got matched to, same as the
    // manual link-lookup path does.
    await upsertLead(from, {
      property_id: top[0].prop_id,
      agent_name: top[0].agent_name || "",
    });
  } catch (err) {
    logger.error(`Property matching failed for ${from}:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
