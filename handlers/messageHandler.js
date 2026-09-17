const { getAIReply } = require("./aiReply");
const { sendTextMessage } = require("../utils/whatsappAPI");
const conversationState = require("../services/conversationState");
const { extractPropertyId, findPropertyById } = require("../services/propertyLookup");
const { extractLeadInfo } = require("../services/leadExtractor");
const { upsertLead } = require("../services/leadSync");
const logger = require("../utils/logger");

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

    const reply = type === "text"
      ? await getAIReply(from, text, conversationState.getProperty(from))
      : "Got your message. An agent will follow up shortly.";

    conversationState.addMessage(from, "ai", reply);
    await sendTextMessage(from, reply);

    // Qualify the lead in the background — doesn't delay the reply.
    // IMPORTANT: this chain must never throw uncaught, or it crashes the
    // whole Node process (an unhandled promise rejection is fatal by
    // default) — that's exactly what was happening before (see
    // conversationState.js fix), so this now has a .catch() as a safety net
    // even though the root cause there is fixed too.
    if (type === "text") {
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
  } catch (err) {
    logger.error("Error in handleIncomingMessage:", err);
  }
}

module.exports = { handleIncomingMessage };
