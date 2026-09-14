// index.js
// Basic WhatsApp Cloud API webhook + send-message starter for Loop Inmobiliaria.

require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const {
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  VERIFY_TOKEN,
  OPENAI_API_KEY,
  PORT = 3000,
} = process.env;

const GRAPH_API_URL = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

// Simple in-memory conversation history per customer (resets on server
// restart). Good enough for testing — replace with a real database later.
const conversations = {};

// -----------------------------------------------------------------
// 1) WEBHOOK VERIFICATION (Meta calls this once when you click
//    "Verify and Save" in the Meta app dashboard).
// -----------------------------------------------------------------
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed. Token mismatch.");
  return res.sendStatus(403);
});

// -----------------------------------------------------------------
// 2) RECEIVING MESSAGES
//    Meta sends a POST request here every time a customer messages
//    the business number.
// -----------------------------------------------------------------
app.post("/webhook", async (req, res) => {
  // Always respond 200 quickly so Meta doesn't retry/resend.
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      // This could be a status update (delivered/read) instead of a message.
      return;
    }

    const from = message.from; // customer's WhatsApp number
    const type = message.type; // "text", "audio", "image", etc.

    console.log(`Incoming message from ${from} (type: ${type})`);

    if (type === "text") {
      const text = message.text.body;
      console.log(`Message text: ${text}`);

      const aiReply = await getAIReply(from, text);
      await sendTextMessage(from, aiReply);
    } else {
      console.log(`Unhandled message type: ${type} — extend this later (e.g. audio transcription).`);
    }
  } catch (err) {
    console.error("Error handling incoming webhook:", err.message);
  }
});

// -----------------------------------------------------------------
// 3) AI REPLY (OpenAI)
//    Keeps a short conversation history per customer so the AI
//    remembers context within the chat.
// -----------------------------------------------------------------
const SYSTEM_PROMPT = `Sos el asistente comercial de Loop Inmobiliaria, una
inmobiliaria en Uruguay. Respondé en español, de forma breve, cordial y
profesional. Tu objetivo es entender qué busca el cliente (compra, alquiler
o inversión), en qué zona, presupuesto y tipo de propiedad, para poder
ayudarlo. Esta es una versión de prueba: todavía no tenés acceso a las
propiedades reales ni a una base de datos, así que si preguntan por una
propiedad específica, aclará amablemente que un agente se va a poner en
contacto con la info exacta.`;

async function getAIReply(from, userText) {
  if (!conversations[from]) {
    conversations[from] = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  conversations[from].push({ role: "user", content: userText });

  try {
    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: "gpt-4o-mini",
        messages: conversations[from],
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const reply = response.data.choices[0].message.content.trim();
    conversations[from].push({ role: "assistant", content: reply });

    // Keep conversation history from growing forever (basic cap).
    if (conversations[from].length > 20) {
      conversations[from] = [
        conversations[from][0],
        ...conversations[from].slice(-19),
      ];
    }

    return reply;
  } catch (err) {
    console.error("Error calling OpenAI:", err.response?.data || err.message);
    return "Disculpá, tuve un problema técnico. Un agente te va a responder en breve.";
  }
}

// -----------------------------------------------------------------
// 4) SENDING MESSAGES
// -----------------------------------------------------------------
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
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Message sent:", response.data);
  } catch (err) {
    console.error("Error sending message:", err.response?.data || err.message);
  }
}

// -----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL (local): http://localhost:${PORT}/webhook`);
  console.log(`Expose it publicly with: ngrok http ${PORT}`);
});