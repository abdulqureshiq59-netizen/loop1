// utils/whatsappAPI.js
const axios = require("axios");
const logger = require("./logger");

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";
const GRAPH_API_URL = `${GRAPH_API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

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

// Downloads a voice note / media file sent by a customer. WhatsApp Cloud
// API is two-step: first resolve the media ID to a short-lived URL, then
// fetch that URL (still needs the same bearer token) to get the actual
// bytes. Used for voice-note transcription (services/transcribeAudio.js).
async function downloadMedia(mediaId) {
  const metaRes = await axios.get(`${GRAPH_API_BASE}/${mediaId}`, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
  });
  const { url, mime_type } = metaRes.data;

  const fileRes = await axios.get(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: "arraybuffer",
  });

  return { buffer: Buffer.from(fileRes.data), mimeType: mime_type };
}

// Sends a Meta-APPROVED template (2026-10-01, client request). Unlike a
// free-form text, a template reaches the number even if it hasn't written
// to the Loop number in the last 24 hours — used for internal alerts to
// agents (see services/adminNotify.js). Meta rejects parameters that
// contain line breaks, tabs or 4+ spaces in a row, so they're cleaned here.
function cleanTemplateParam(v, max) {
  let t = String(v == null ? "" : v).replace(/[\r\n\t]+/g, " · ").replace(/ {2,}/g, " ").trim();
  if (!t) t = "-";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

async function sendTemplateMessage(to, templateName, languageCode, params = [], maxParamChars = 300) {
  try {
    const response = await axios.post(
      GRAPH_API_URL,
      {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [{
            type: "body",
            parameters: params.map(p => ({ type: "text", text: cleanTemplateParam(p, maxParamChars) })),
          }],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    logger.info(`Template "${templateName}" sent to ${to}`);
    return response.data;
  } catch (err) {
    logger.error(`Error sending template "${templateName}" to ${to}:`, err.response?.data || err.message);
    throw err;
  }
}

module.exports = {
  sendTextMessage,
  sendTemplateMessage,
  markMessageAsRead,
  downloadMedia,
};
