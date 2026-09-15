const { getAIReply } = require("./aiReply");
const { sendTextMessage } = require("../utils/whatsappAPI");
const conversationState = require("../services/conversationState");
const logger = require("../utils/logger");

async function handleIncomingMessage(message, from) {
  try {
    const type = message.type;
    const text = type === "text" ? message.text.body : `[${type} message]`;
    logger.info(`Incoming from ${from} (${type}): "${text}"`);

    conversationState.addMessage(from, "customer", text);

    if (conversationState.getMode(from) === "human") {
      logger.info(`Mode is HUMAN for ${from} — AI stays silent, agent replies from dashboard`);
      return;
    }

    const reply = type === "text"
      ? await getAIReply(from, text)
      : "Got your message. An agent will follow up shortly.";

    conversationState.addMessage(from, "ai", reply);
    await sendTextMessage(from, reply);
  } catch (err) {
    logger.error("Error in handleIncomingMessage:", err);
  }
}

module.exports = { handleIncomingMessage };
