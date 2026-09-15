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

module.exports = {
  sendTextMessage,
};
