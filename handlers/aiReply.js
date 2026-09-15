// handlers/aiReply.js
const openai = require("../config/openai");
const logger = require("../utils/logger");

// Store conversation history in memory (for testing)
// In production, use MongoDB or PostgreSQL
const conversations = {};

const SYSTEM_PROMPT = `Sos el asistente comercial de Loop Inmobiliaria, una inmobiliaria en Uruguay.

Respondé en español, de forma breve, cordial y profesional.

Tu objetivo es:
1. Entender qué busca el cliente (compra, alquiler o inversión)
2. Identificar zona, presupuesto y tipo de propiedad
3. Ser útil y amable

Instrucciones:
- Responde en máximo 2-3 líneas
- Sé profesional pero amable
- Si preguntan por una propiedad específica, aclara que un agente se contactará
- No inventes información sobre propiedades`;

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
