const openai = require("../config/openai");
const logger = require("../utils/logger");

const conversations = {};

// IMPORTANT: reply is ALWAYS in Spanish, no matter what language the
// customer writes in — models otherwise mirror the customer's language
// by default, which is why English/other-language messages were getting
// English/other-language replies before this instruction was added.
const BASE_PROMPT = `Sos el asistente comercial de Loop Inmobiliaria, una inmobiliaria en Uruguay.

IMPORTANTE: Respondé SIEMPRE en español, sin importar en qué idioma te escriba el cliente (inglés, portugués, o cualquier otro). Nunca cambies de idioma para "seguirle la corriente" al cliente — el negocio opera en español y todas tus respuestas deben ser en español.

Respondé de forma breve, cálida y profesional, en máximo 2-3 líneas.
Tu objetivo es entender si el cliente quiere comprar, alquilar o invertir, y conseguir su zona, presupuesto y tipo de propiedad — pero NUNCA vuelvas a preguntar algo que ya se respondió en la conversación o que ya conocés por los datos de la propiedad.
Nunca inventes detalles de una propiedad que no te fueron dados.`;

function buildSystemPrompt(property) {
  if (!property) {
    return `${BASE_PROMPT}\nSi preguntan por una propiedad específica, decí que un agente va a seguir con la info exacta.`;
  }

  const operationMismatchNote = `Si el cliente pide una operación distinta a la de esta propiedad (por ejemplo dice "comprar" pero esta propiedad es de "${property.operation}"), NO ignores la diferencia: avisale amablemente del malentendido y preguntale si de todas formas quiere info de esta propiedad o si busca otra para lo que realmente quiere hacer.`;

  return `${BASE_PROMPT}
El cliente está preguntando por esta propiedad específica — usá SOLO estos datos reales, y no vuelvas a preguntar por zona ni tipo de propiedad porque ya los tenés acá:
- ID: ${property.prop_id}
- Título: ${property.title}
- Zona: ${property.zone}
- Precio: ${property.price || "no listado, decí que un agente lo va a confirmar"}
- Dormitorios: ${property.bedrooms}
- Operación de esta propiedad: ${property.operation || "no especificada"}
${operationMismatchNote}
Lo único que todavía te puede faltar es presupuesto, financiación o plazo — preguntá solo por eso si hace falta.
Mencioná que ${property.agent_name || "el agente asignado"} va a seguir con más detalles.`;
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
    return "Disculpá, tuvimos un problema técnico. Un agente te va a responder en breve.";
  }
}

module.exports = { getAIReply };
