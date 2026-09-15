// handlers/aiReply.js
const openai = require("../config/openai");
const logger = require("../utils/logger");

// Store conversation history in memory (for testing)
// In production, use MongoDB or PostgreSQL
const conversations = {};

const SYSTEM_PROMPT = `You are the commercial assistant for Loop Inmobiliaria, a real estate agency in Uruguay.
// TEMP: replying in English for testing — switch back to Spanish before going live with the client.

Reply briefly, warmly, and professionally, in max 2-3 lines.
Your goal is to understand if the client wants to buy, rent, or invest, and get their zone, budget, and property type.
If they ask about a specific property, say an agent will follow up with exact info. Never invent property details.`;

async function getAIReply(from, userText) {
  try {
    // Initialize conversation history if not exists
    if (!conversations[from]) {
      conversations[from] = [
        { role: "system", content: SYSTEM_PROMPT }
      ];
    }

    // Add user message
    conversations[from].push({ role: "user", content: userText });

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[from],
      temperature: 0.7,
      max_tokens: 150,
    });

    const reply = response.choices[0].message.content.trim();

    // Store AI response
    conversations[from].push({ role: "assistant", content: reply });

    // Keep history manageable (max 20 messages)
    if (conversations[from].length > 20) {
      conversations[from] = [
        conversations[from][0],
        ...conversations[from].slice(-19),
      ];
    }

    logger.info(`AI reply generated for ${from}`);
    return reply;
  } catch (err) {
    logger.error("Error calling OpenAI:", err);
    return "Disculpá, tuve un problema técnico. Un agente te va a responder en breve.";
  }
}

module.exports = {
  getAIReply,
};
