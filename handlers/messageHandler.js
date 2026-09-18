const { getAIReply, LANGUAGE } = require("./aiReply");
const { checkHandoff } = require("../services/handoffDetector");
const { sendTextMessage } = require("../utils/whatsappAPI");
const conversationState = require("../services/conversationState");
const { extractPropertyId, findPropertyById, getAllProperties, getAllProjects } = require("../services/propertyLookup");
const { extractLeadInfo } = require("../services/leadExtractor");
const { matchProperties } = require("../services/propertyMatcher");
const { upsertLead } = require("../services/leadSync");
const leadsDb = require("../services/leadsDb");
const logger = require("../utils/logger");

const HANDOFF_MESSAGE = LANGUAGE === "en"
  ? "Understood — I'm connecting you with one of our agents now, they'll take it from here."
  : "Entendido — te voy a conectar con uno de nuestros agentes, ellos van a continuar la conversación.";

async function handleIncomingMessage(message, from) {
  try {
    const type = message.type;
    const text = type === "text" ? message.text.body : `[${type} message]`;
    logger.info(`Incoming from ${from} (${type}): "${text}"`);

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
    })
    .catch(err => {
      logger.error(`Background lead qualification failed for ${from}:`, err.message);
    });
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
    if (!lead.zone || !lead.type || !lead.budget) return; // not enough to search yet
    if (conversationState.getPropertiesSuggested(from)) return;

    const [properties, projects] = await Promise.all([getAllProperties(), getAllProjects()]);
    const matches = await matchProperties(
      { zone: lead.zone, budget: lead.budget, type: lead.type, bedrooms: lead.bedrooms },
      [...properties, ...projects]
    );
    if (!matches.length) return;

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
