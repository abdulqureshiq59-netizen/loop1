// handlers/webhookHandler.js
const { handleIncomingMessage } = require("./messageHandler");
const logger = require("../utils/logger");

function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    logger.info("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  logger.error("Webhook verification failed. Token mismatch.");
  return res.sendStatus(403);
}

async function handleWebhookPost(req, res) {
  // Always respond 200 quickly so Meta doesn't retry
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // This could be a status update (delivered/read) instead of a message
      logger.info("Webhook received but no message — possibly a status update");
      return;
    }

    const from = message.from; // Customer's WhatsApp number
    await handleIncomingMessage(message, from);
  } catch (err) {
    logger.error("Error handling webhook POST:", err);
  }
}

module.exports = {
  verifyWebhook,
  handleWebhookPost,
};
