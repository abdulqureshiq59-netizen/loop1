const { getAIReply, LANGUAGE } = require("./aiReply");
const { checkHandoff } = require("../services/handoffDetector");
const { sendTextMessage } = require("../utils/whatsappAPI");
const conversationState = require("../services/conversationState");
const { extractPropertyId, findPropertyById } = require("../services/propertyLookup");
const { extractLeadInfo } = require("../services/leadExtractor");
const { upsertLead } = require("../services/leadSync");
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

    if (conversationState.getMode(from) === "human") {
      logger.info(`Mode is HUMAN for ${from} — AI stays silent`);
      return;
    }

    if (type === "text") {
      const propId = extractPropertyId(text);
      if (propId) {
        const property = await findPropertyById(propId);
        if (property) conversationState.setProperty(from, property);
      }
    }

    // Spec #8/#11: auto-detect complaints, requests for a human, price
    // negotiation, or high buying intent — hand off instead of letting the
    // AI keep answering. Runs only for text messages, before the normal
    // AI reply is generated.
    if (type === "text") {
      const handoffResult = await checkHandoff(text);
      if (handoffResult.handoff) {
        logger.info(`Handoff triggered for ${from}: ${handoffResult.reason}`);
        conversationState.addMessage(from, "ai", HANDOFF_MESSAGE);
        await sendTextMessage(from, HANDOFF_MESSAGE);
        conversationState.setMode(from, "human");
        // Still qualify the lead in the background even though we're
        // handing off — the info gathered so far is still useful to the
        // agent picking this up.
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

// Qualifies the lead in the background — doesn't delay the reply. Must
// never throw uncaught: an unhandled promise rejection crashes the whole
// Node process (this was the exact cause of an earlier bug), so this
// always ends in .catch().
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
        budget: lead.budget || "", financing: lead.financing || "",
        timeline: lead.timeline || "", temperature: lead.temperature || "Frio",
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
