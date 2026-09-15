const openai = require("../config/openai");
const logger = require("../utils/logger");

const conversations = {};

const BASE_PROMPT = `You are the commercial assistant for Loop Inmobiliaria, a real estate agency in Uruguay.
// TEMP: replying in English for testing — switch back to Spanish before going live with the client.

Reply briefly, warmly, and professionally, in max 2-3 lines.
Your goal is to understand if the client wants to buy, rent, or invest, and get their zone, budget, and property type.
Never invent property details that aren't given to you.`;

function buildSystemPrompt(property) {
  if (!property) {
    return `${BASE_PROMPT}\nIf they ask about a specific property, say an agent will follow up with exact info.`;
  }
  return `${BASE_PROMPT}
The customer is asking about this specific property — use ONLY these real details:
- ID: ${property.prop_id}
- Title: ${property.title}
- Address/zone: ${property.address}, ${property.zone}
- Price: ${property.price || "not listed, tell them an agent will confirm"}
- Bedrooms: ${property.bedrooms}
- Operation: ${property.operation}
Mention that ${property.agent_name || "the assigned agent"} will follow up with more details.`;
}

async function getAIReply(from, userText, property = null) {
  try {
    if (!conversations[from]) {
      conversations[from] = [{ role: "system", content: buildSystemPrompt(property) }];
    } else {
      conversations[from][0] = { role: "system", content: buildSystemPrompt(property) };
    }

    conversations[from].push({ role: "user", content: userText });

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[from],
      temperature: 0.7,
      max_tokens: 150,
    });

    const reply = response.choices[0].message.content.trim();
    conversations[from].push({ role: "assistant", content: reply });

    if (conversations[from].length > 20) {
      conversations[from] = [conversations[from][0], ...conversations[from].slice(-19)];
    }

    logger.info(`AI reply generated for ${from}`);
    return reply;
  } catch (err) {
    logger.error("Error calling OpenAI:", err);
    return "Sorry, I had a technical issue. An agent will get back to you shortly.";
  }
}

module.exports = { getAIReply };
