const openai = require("../config/openai");
const logger = require("../utils/logger");

const conversations = {};

// Reply language is controlled by BOT_LANGUAGE in .env — "es" (Spanish) or
// "en" (English). Defaults to Spanish since that's what the real client
// and their customers need. Set BOT_LANGUAGE=en in .env while YOU are
// testing in English, but make sure it's back to "es" (or just remove the
// line — es is the default) before this goes live for the client, or the
// client's customers will get English replies again.
const LANGUAGE = (process.env.BOT_LANGUAGE || "es").toLowerCase();

const PROMPTS = {
  es: {
    languageLine: `IMPORTANTE: Respondé SIEMPRE en español, sin importar en qué idioma te escriba el cliente (inglés, portugués, o cualquier otro). Nunca cambies de idioma para "seguirle la corriente" al cliente — el negocio opera en español y todas tus respuestas deben ser en español.`,
    base: `Sos el asistente comercial de Loop Inmobiliaria, una inmobiliaria en Uruguay.

Respondé de forma breve, cálida y profesional, en máximo 2-3 líneas.
Tu objetivo es entender si el cliente quiere comprar, alquilar o invertir, y conseguir su zona, presupuesto y tipo de propiedad — pero NUNCA vuelvas a preguntar algo que ya se respondió en la conversación o que ya conocés por los datos de la propiedad.
Nunca inventes detalles de una propiedad que no te fueron dados.`,
    noProperty: `Si preguntan por una propiedad específica, decí que un agente va a seguir con la info exacta.`,
    propertyIntro: `El cliente está preguntando por esta propiedad específica — usá SOLO estos datos reales, y no vuelvas a preguntar por zona ni tipo de propiedad porque ya los tenés acá:`,
    priceUnlisted: "no listado, decí que un agente lo va a confirmar",
    operationUnspecified: "no especificada",
    mismatch: (operation) => `Si el cliente pide una operación distinta a la de esta propiedad (por ejemplo dice "comprar" pero esta propiedad es de "${operation}"), NO ignores la diferencia: avisale amablemente del malentendido y preguntale si de todas formas quiere info de esta propiedad o si busca otra para lo que realmente quiere hacer.`,
    remaining: `Lo único que todavía te puede faltar es presupuesto, financiación o plazo — preguntá solo por eso si hace falta.`,
    agentFollowUp: (agent) => `Mencioná que ${agent || "el agente asignado"} va a seguir con más detalles.`,
    errorReply: "Disculpá, tuvimos un problema técnico. Un agente te va a responder en breve.",
  },
  en: {
    languageLine: `IMPORTANT: This is a TEST-MODE English reply. Do not use this in front of real customers — this language is only for the developer's own testing.`,
    base: `You are the commercial assistant for Loop Inmobiliaria, a real estate agency in Uruguay.

Reply briefly, warmly, and professionally, in max 2-3 lines.
Your goal is to understand if the client wants to buy, rent, or invest, and get their zone, budget, and property type — but NEVER re-ask something already answered in the conversation or already known from the property data.
Never invent property details that weren't given to you.`,
    noProperty: `If they ask about a specific property, say an agent will follow up with exact info.`,
    propertyIntro: `The customer is asking about this specific property — use ONLY these real details, and don't re-ask for zone or type since you already have them here:`,
    priceUnlisted: "not listed, tell them an agent will confirm",
    operationUnspecified: "not specified",
    mismatch: (operation) => `If the customer asks for a different operation than this property's (e.g. says "buy" but this property is for "${operation}"), do NOT ignore the mismatch: point it out kindly and ask if they still want info on this property or are looking for a different one for what they actually want.`,
    remaining: `The only things you might still be missing are budget, financing, or timeline — only ask about those if needed.`,
    agentFollowUp: (agent) => `Mention that ${agent || "the assigned agent"} will follow up with more details.`,
    errorReply: "Sorry, we had a technical issue. An agent will get back to you shortly.",
  },
};

function buildSystemPrompt(property) {
  const t = PROMPTS[LANGUAGE] || PROMPTS.es;
  const base = `${t.base}\n\n${t.languageLine}`;

  if (!property) {
    return `${base}\n${t.noProperty}`;
  }

  return `${base}
${t.propertyIntro}
- ID: ${property.prop_id}
- ${LANGUAGE === "en" ? "Title" : "Título"}: ${property.title}
- ${LANGUAGE === "en" ? "Zone" : "Zona"}: ${property.zone}
- ${LANGUAGE === "en" ? "Price" : "Precio"}: ${property.price || t.priceUnlisted}
- ${LANGUAGE === "en" ? "Bedrooms" : "Dormitorios"}: ${property.bedrooms}
- ${LANGUAGE === "en" ? "Operation" : "Operación"}: ${property.operation || t.operationUnspecified}
${t.mismatch(property.operation)}
${t.remaining}
${t.agentFollowUp(property.agent_name)}`;
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

    logger.info(`AI reply generated for ${from} (language: ${LANGUAGE})`);
    return reply;
  } catch (err) {
    logger.error("Error calling OpenAI:", err);
    const t = PROMPTS[LANGUAGE] || PROMPTS.es;
    return t.errorReply;
  }
}

module.exports = { getAIReply };
