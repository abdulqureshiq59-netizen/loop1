const { getAIReply, getLanguage } = require("./aiReply");
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
const messagesDb = require("../services/messagesDb");
const adminNotify = require("../services/adminNotify");
const aiConfig = require("../services/aiConfig");
const logger = require("../utils/logger");

// A function, not a load-time constant (2026-09-20): language can now be
// toggled live from the dashboard, so this must be re-evaluated on every
// handoff instead of being frozen at whatever it was when the process
// booted. Offers a call (training PDF 2026: "La importancia de la llamada").
function getHandoffMessage() {
  return getLanguage() === "en"
    ? "Got it! An agent will contact you shortly. Would you prefer a call? Tell me what time suits you."
    : "¡Perfecto! Un agente te va a contactar en breve. ¿Preferís que te llamen? Decime qué horario te queda cómodo.";
}

// Messages for the background classifiers (lead extraction, visit
// detection) now come from the DATABASE (2026-09-30). They used to read
// conversationState's in-memory list, which is empty after every Render
// restart — so after a restart the extractor only saw the newest message,
// could downgrade a HOT lead to Frio, and the "checklist complete" gates
// (postcode) never passed again for that customer.
async function getTranscript(from, latestText, limit = 60) {
  let rows = [];
  try {
    rows = await messagesDb.getMessages(from, limit);
  } catch (err) {
    logger.error(`Could not load transcript for ${from}, using in-memory copy:`, err.message);
    rows = conversationState.getConversation(from).messages || [];
  }
  const lastCustomer = [...rows].reverse().find(m => m.sender === "customer");
  if (latestText && !(lastCustomer && lastCustomer.text === latestText)) {
    rows = [...rows, { sender: "customer", text: latestText, timestamp: new Date().toISOString() }];
  }
  return rows;
}

// Spec #4/#5: identify the property from a link / "propiedad #NN", and
// never keep offering one that is no longer active.
async function resolveProperty(from, text) {
  const propId = extractPropertyId(text);
  if (!propId) return;

  const property = await findPropertyById(propId, text);
  if (property) {
    if (property.is_active === false) {
      logger.info(`${from} asked about property #${propId}, which is NOT active (${property.status || "inactive"})`);
      conversationState.setProperty(from, { ...property, unavailable: true });
    } else {
      conversationState.setProperty(from, property);
      notifyPropertyAgentInBackground(from, property, text);
    }
    return;
  }

  // Not in the catalog at all. Only call it "no longer available" if the
  // catalog actually loaded — if the NAI API is down we'd otherwise tell
  // every customer that every property is gone.
  const [properties, projects] = await Promise.all([getAllProperties(), getAllProjects()]);
  if (properties.length + projects.length > 0) {
    logger.info(`${from} asked about property #${propId}, which is not in the live catalog — treating as unavailable`);
    conversationState.setProperty(from, { prop_id: propId, title: "", zone: "", link: "", agent_name: "", unavailable: true });
  }
}

// Messages from Loop's own team (admin or a saved agent number) are not
// leads: an agent replying "ok" to an alert, or writing to the Loop number,
// used to get an AI reply and show up as a new customer in Chats/Pipeline.
async function isTeamNumber(from) {
  try {
    const [admin, team] = await Promise.all([adminNotify.getAdminPhone(), aiConfig.getTeamPhones()]);
    const n = aiConfig.normalizePhone(from);
    return (admin && aiConfig.normalizePhone(admin) === n) || team.has(n);
  } catch (err) {
    return false; // if settings can't be read, treat as a normal customer
  }
}

async function handleIncomingMessage(message, from) {
  try {
    if (await isTeamNumber(from)) {
      logger.info(`Message from a Loop team number (${from}) — not a lead, AI does not reply`);
      return;
    }

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
      // Still keep the lead card up to date with what the customer says to
      // the agent (no AI reply, no alerts re-fired — flags are already set).
      if (type === "text") qualifyLeadInBackground(from, text, { silent: true });
      return;
    }

    if (type === "text") {
      await resolveProperty(from, text);
    }

    // Spec #8/#11: auto-detect complaints, requests for a human, price
    // negotiation, complex cases or high buying intent — hand off instead of
    // letting the AI keep answering, and send the agent the whole context.
    if (type === "text") {
      const handoffResult = await checkHandoff(text);
      if (handoffResult.handoff) {
        logger.info(`Handoff triggered for ${from}: ${handoffResult.reason}`);
        const handoffMessage = getHandoffMessage();
        conversationState.addMessage(from, "ai", handoffMessage);
        await sendTextMessage(from, handoffMessage);
        conversationState.setMode(from, "human");
        notifyHandoffInBackground(from, text, handoffResult.reason);
        qualifyLeadInBackground(from, text);
        return;
      }
    }

    const reply = type === "text"
      ? await getAIReply(from, text, conversationState.getProperty(from))
      : (getLanguage() === "en"
          ? "Got your message. An agent will follow up shortly."
          : "Recibimos tu mensaje. Un agente te va a responder en breve.");

    conversationState.addMessage(from, "ai", reply);
    await sendTextMessage(from, reply);

    if (type === "text") {
      qualifyLeadInBackground(from, text);
    }
  } catch (err) {
    logger.error("Error in handleIncomingMessage:", err);
  }
}

// Client (2026-10-01): "siempre que detecte de quién es la propiedad, que
// mande la alerta con toda la información al AGENTE correspondiente".
// Fires once per property per conversation cycle, as soon as the property
// is identified (link / number) or suggested — then the agent gets the
// HOT / visit / handoff alerts for the same lead later on.
function notifyPropertyAgentInBackground(from, property, text, { suggested = false } = {}) {
  if (!property || !property.prop_id) return;
  if (conversationState.wasPropertyAlerted(from, property.prop_id)) return;
  conversationState.markPropertyAlerted(from, property.prop_id);
  (async () => {
    const [row, recent] = await Promise.all([
      leadsDb.getLeadByPhone(from).catch(() => null),
      getTranscript(from, text, 6),
    ]);
    const lead = { ...(row || {}) };
    const mem = conversationState.getLead(from) || {};
    Object.entries(mem).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") lead[k] = v; });
    await adminNotify.notifyPropertyInquiry(from, { property, lead, recent, suggested });
  })().catch(err => logger.error(`Property-agent alert failed for ${from}:`, err.message));
}

// Handoff alert to admin + the property's responsible agent (spec #6/#11),
// with everything known so far so nobody has to re-ask the customer.
function notifyHandoffInBackground(from, text, reason) {
  (async () => {
    const [row, recent] = await Promise.all([
      leadsDb.getLeadByPhone(from).catch(() => null),
      getTranscript(from, text, 8),
    ]);
    const memLead = conversationState.getLead(from) || {};
    const lead = { ...(row || {}) };
    Object.entries(memLead).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") lead[k] = v; });
    const property = conversationState.getProperty(from);
    const agentName = (property && property.agent_name) || lead.agent_name || "";
    const agentPhoneHint = (property && property.agent_phone) || "";
    await adminNotify.notifyHandoff(from, { reason, lead, property, recent, agentName, agentPhoneHint });
  })().catch(err => logger.error(`Handoff alert failed for ${from}:`, err.message));
}

function qualifyLeadInBackground(from, text, { silent = false } = {}) {
  (async () => {
    const transcript = await getTranscript(from, text);
    const lead = await extractLeadInfo(transcript);
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
      property_link: (property && property.link) || lead.property_link || "",
      last_message: text,
    });
    if (silent) return; // human mode: keep the card updated, but don't message anyone
    await maybeNotifyHotLead(from, lead);
    await maybeSuggestProperties(from, lead);
    await maybeMarkVisitScheduled(from, transcript, lead, property);
  })().catch(err => {
    logger.error(`Background lead qualification failed for ${from}:`, err.message);
  });
}

// Client requirement (2026-09-20): admin gets a WhatsApp alert whenever a
// lead comes in HOT — no matter the operation (buy/rent/sell/invest). Gated
// by conversationState.hotAlerted (resets when the chat is handed back to
// AI = fresh inquiry cycle) instead of the forward-only DB `stage` column,
// which can never re-produce a CALIENTE transition for a returning number.
//
// Also gated on name + postcode (2026-09-20): "Caliente" alone only needs
// zone + budget + operation, which is too early for the admin to act on.
// Postcode is the last checklist field, so this fires once qualification
// is actually complete. Since 2026-09-30 it also goes to the responsible
// agent (spec #6: "derivarle el lead").
async function maybeNotifyHotLead(from, lead) {
  try {
    if (lead?.temperature !== "Caliente") return;
    if (!lead.name || !lead.postcode) return;
    if (conversationState.getHotAlerted(from)) return;
    conversationState.setHotAlerted(from, true);
    const row = await leadsDb.getLeadByPhone(from).catch(() => null);
    const property = conversationState.getProperty(from);
    const agentName = (property && property.agent_name) || (row && row.agent_name) || "";
    await adminNotify.notifyHotLead(
      from,
      { ...lead, property_link: lead.property_link || (row && row.property_link) || "" },
      agentName,
      (property && property.agent_phone) || "",
      property && !property.unavailable ? property : null
    );
  } catch (err) {
    logger.error(`Hot-lead alert failed for ${from}:`, err.message);
  }
}

// Client requirement (2026-09-19): when the customer confirms they want an
// in-person/on-site visit AND gives a day/time, move the lead straight to
// the VISITA pipeline stage and alert the admin + responsible agent.
// Gated by conversationState.visitScheduled so it fires once per
// conversation cycle.
async function maybeMarkVisitScheduled(from, messages, lead, property) {
  try {
    if (conversationState.getVisitScheduled(from)) return;

    const { visitConfirmed, visitWhen } = await extractVisitInfo(messages);
    if (!visitConfirmed) return;

    conversationState.setVisitScheduled(from, true);
    // notify:false — the detailed alert below replaces the generic
    // stage-change alert (used to send the admin two alerts per visit).
    await leadsDb.bumpStageTo(from, "VISITA", { notify: false });
    logger.info(`Visit scheduled detected for ${from}${visitWhen ? ` (${visitWhen})` : ""} — moved to VISITA`);

    const row = await leadsDb.getLeadByPhone(from).catch(() => null);
    await adminNotify.notifyVisitScheduled(from, {
      name: lead?.name || "",
      visitWhen: visitWhen || "",
      property: property && property.title ? `${property.title} (${property.zone})` : "",
      link: property ? property.link : (row && row.property_link) || "",
      property_id: property ? property.prop_id : (row && row.property_id) || "",
      agent_name: (property && property.agent_name) || (row && row.agent_name) || "",
      agent_phone: (property && property.agent_phone) || "",
    });
  } catch (err) {
    logger.error(`Visit detection failed for ${from}:`, err.message);
  }
}

// Spec #4/#5: once we know enough about what the customer (buyer/renter/
// investor — not a seller, who isn't looking for a property) wants, search
// the real NAI catalog (ACTIVE listings only, see propertyMatcher) and send
// them matches. Sent at most once per conversation cycle.
async function maybeSuggestProperties(from, lead) {
  try {
    if (!lead.operation || lead.operation === "venta") return; // sellers aren't looking for a property

    // `postcode` is required — it's the last field in every checklist, so
    // suggestions only go out once the whole flow is done (not mid-flow,
    // which made the AI keep asking questions after the list was sent).
    // `type` is intentionally NOT required — "Caliente" doesn't need it.
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

    const language = getLanguage();
    const top = matches.slice(0, 3);
    const lines = top.map((p, i) => {
      const price = p.price_display || (language === "en" ? "price on request" : "precio a consultar");
      return `${i + 1}. ${p.title} — ${price} (${p.link})`;
    });
    const intro = language === "en"
      ? "These properties match what you're looking for:"
      : "Estas propiedades coinciden con lo que buscás:";
    const outro = language === "en"
      ? `${top[0].agent_name || "An agent"} will contact you with more details.`
      : `${top[0].agent_name || "Un agente"} te va a contactar con más detalles.`;
    const message = `${intro}\n\n${lines.join("\n")}\n\n${outro}`;

    conversationState.addMessage(from, "ai", message);
    await sendTextMessage(from, message);
    conversationState.setPropertiesSuggested(from, true);

    // Record which property/agent this lead got matched to, same as the
    // manual link-lookup path does.
    await upsertLead(from, {
      property_id: top[0].prop_id,
      agent_name: top[0].agent_name || "",
      property_link: top[0].link || "",
    });

    // Each suggested property's agent gets the lead too (once per property).
    top.forEach(p => notifyPropertyAgentInBackground(from, p, "", { suggested: true }));
  } catch (err) {
    logger.error(`Property matching failed for ${from}:`, err.message);
  }
}

module.exports = { handleIncomingMessage };
