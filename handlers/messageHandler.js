const { getAIReply, LANGUAGE } = require("./aiReply");
const { checkHandoff } = require("../services/handoffDetector");
const { sendTextMessage } = require("../utils/whatsappAPI");
const conversationState = require("../services/conversationState");
const { extractPropertyId, findPropertyById } = require("../services/propertyLookup");
const { extractLeadInfo } = require("../services/leadExtractor");
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
    .then(lead => {
      if (!lead) return;
      conversationState.setLead(from, lead);
      const property = conversationState.getProperty(from);
      return upsertLead(from, {
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
    })
    .catch(err => {
      logger.error(`Background lead qualification failed for ${from}:`, err.message);
    });
}

module.exports = { handleIncomingMessage };
