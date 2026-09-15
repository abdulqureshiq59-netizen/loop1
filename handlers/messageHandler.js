// handlers/messageHandler.js
const { getAIReply } = require("./aiReply");
const { sendTextMessage } = require("../utils/whatsappAPI");
const logger = require("../utils/logger");

async function handleIncomingMessage(message, from) {
  try {
    const type = message.type; // "text", "audio", "image", etc.

    logger.info(`Incoming message from ${from} (type: ${type})`);

    if (type === "text") {
      const text = message.text.body;
      logger.info(`Message text: "${text}"`);

      // Get AI response
      const aiReply = await getAIReply(from, text);

      // Send reply
      await sendTextMessage(from, aiReply);
    } else if (type === "audio") {
      logger.warn(`Audio message from ${from} — audio handling not yet implemented`);
      await sendTextMessage(from, "Recibí tu audio. Por ahora no puedo procesarlo, pero un agente te responderá pronto.");
    } else {
      logger.warn(`Unhandled message type: ${type} from ${from}`);
      await sendTextMessage(from, "Recibí tu mensaje. Un agente te va a responder en breve.");
    }
  } catch (err) {
    logger.error("Error in handleIncomingMessage:", err);
  }
}

module.exports = {
  handleIncomingMessage,
};
