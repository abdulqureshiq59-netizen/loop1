// utils/whatsappAPI.js
const axios = require("axios");
const logger = require("./logger");

const GRAPH_API_URL = `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

async function sendTextMessage(to, bodyText) {
  try {
    const response = await axios.post(
      GRAPH_API_URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: bodyText },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    logger.info(`Message sent to ${to}`);
    return response.data;
  } catch (err) {
    logger.error(`Error sending message to ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

// Marks the incoming message as "read" (blue double-check) as soon as it
// arrives. Doesn't make the AI reply itself any faster, but it stops the
// customer thinking the message was never seen while OpenAI is generating
// the reply.
async function markMessageAsRead(messageId) {
  try {
    await axios.post(
      GRAPH_API_URL,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    // Not critical — log and move on, don't block the actual reply over this
    logger.error(`Error marking message ${messageId} as read:`, err.response?.data || err.message);
  }
}

module.exports = {
  sendTextMessage,
  markMessageAsRead,
};
