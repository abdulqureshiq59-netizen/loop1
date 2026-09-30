const openai = require("../config/openai");
const settingsDb = require("../services/settingsDb");
const messagesDb = require("../services/messagesDb");
const aiConfig = require("../services/aiConfig");
const { LOOP_KNOWLEDGE, KNOWLEDGE_RULES } = require("../services/loopKnowledge");
const logger = require("../utils/logger");

// Reply language used to be fixed by BOT_LANGUAGE in .env at process start,
// requiring a redeploy to switch between testing (English) and the real
// client's customers (Spanish). Now editable live from the dashboard
// (2026-09-20): the dashboard's toggle calls setLanguage(), which updates
// this in-memory value immediately AND persists it to app_settings so it
// survives a restart. BOT_LANGUAGE in .env is still read once at boot as
// the initial default (in case the dashboard setting was never touched
// yet), but after that the dashboard is the source of truth.
const BOT_LANGUAGE_KEY = "bot_language";
let LANGUAGE = (process.env.BOT_LANGUAGE || "es").toLowerCase();

(async function hydrateLanguageFromDb() {
  try {
    const stored = await settingsDb.getSetting(BOT_LANGUAGE_KEY, "");
    if (stored === "en" || stored === "es") {
      LANGUAGE = stored;
      logger.info(`Bot reply language restored from dashboard setting: "${LANGUAGE}"`);
    }
  } catch (err) {
    logger.error("Failed to load bot language setting, keeping .env default:", err.message);
  }
})();

function getLanguage() {
  return LANGUAGE;
}

async function setLanguage(lang) {
  const normalized = (lang || "").toLowerCase();
  if (normalized !== "en" && normalized !== "es") {
    throw new Error('language must be "en" or "es"');
  }
  LANGUAGE = normalized;
  await settingsDb.setSetting(BOT_LANGUAGE_KEY, normalized);
  logger.info(`Bot reply language changed to "${LANGUAGE}" via dashboard`);
}

// Static company info (from loopinmobiliaria.uy footer + the client's
// 2026 agent-training PDF, which adds the office number "of. 601").
const COMPANY_INFO = {
  address: "Av. de las Américas 7775, of. 601, edificio Ventura Tower, Carrasco, Montevideo, Uruguay",
  phone: "+598 92 950 000",
  email: "hola@loopinmobiliaria.uy",
  website: "https://loopinmobiliaria.uy",
};

// How many saved messages to send to the model as context. Spec #12
// ("reconocer al cliente cuando vuelve a escribir / recordar el contexto").
const HISTORY_LIMIT = 24;

const EMOJI_RULE = {
  es: {
    ninguno: "No uses emojis.",
    pocos: "Usá como máximo un emoji ocasional, solo si suma calidez.",
    libre: "Podés usar emojis con naturalidad, sin exagerar.",
  },
  en: {
    ninguno: "Do not use emojis.",
    pocos: "Use at most one occasional emoji, only if it adds warmth.",
    libre: "You may use emojis naturally, without overdoing it.",
  },
};

function numbered(list) {
  return list.map((q, i) => `${i + 1}. ${q}`).join("\n");
}

// Everything that used to be a hardcoded prompt string now comes from
// services/aiConfig.js (edit that file to change the bot). The fixed parts
// below are the rules that keep the system itself working (checklist order
// gates property suggestions/alerts, never invent data, etc.).
function buildBasePrompt(cfg, lang) {
  const name = cfg.botName;
  const q = cfg.questions;
  if (lang === "en") {
    return `You are ${name ? `${name}, ` : ""}the commercial assistant for Loop Inmobiliaria, a real estate agency in Uruguay. Tone: ${cfg.tone}. ${EMOJI_RULE.en[cfg.emojis]}

Real company info (use it directly if asked for address, phone, email, or website — do NOT say "an agent will confirm" for this, you already know it):
- Address: ${COMPANY_INFO.address}
- Phone / WhatsApp: ${COMPANY_INFO.phone}
- Email: ${COMPANY_INFO.email}
- Website: ${COMPANY_INFO.website}

Reply briefly, warmly, and professionally, in max ${cfg.maxLines} lines.
${cfg.greeting ? `If this is the start of the conversation (no previous messages from you), greet using this greeting, translated to English: "${cfg.greeting}"\n` : ""}Your goal is to understand if the client wants to BUY, RENT, INVEST, or SELL a property of their own — and gather the relevant details to qualify them. NEVER re-ask something already answered in the conversation (including earlier conversations above) or already known from the property data. If the customer is writing again after a while, recognize them and continue from what you already know.
Never invent property details that weren't given to you.

NEVER share: ${cfg.doNotShare}

If at any point the customer says they want to visit a property in person / on-site (not a virtual tour, not photos), ask what day and time works for them. Confirm which property this is (repeat back its zone/title so it's clear) — we don't have the exact street address in the system, so don't invent one: tell them the agent will confirm the exact address along with the day/time. Once you have a confirmed day/time, tell them an agent will coordinate and confirm the visit details.

Do NOT close the conversation or say "an agent will follow up/confirm" after just 2-3 basic details — that cuts qualification short. Keep asking, one detail per message and IN THIS ORDER, until you've gone through the whole list (don't skip steps, and don't collapse it into an open-ended "is there anything else you'd like to share?"). The lists are written in Spanish — ask them in English:

If they want to SELL their own property:
${numbered(q.venta)}

If they want to INVEST:
${numbered(q.inversion)}

If they want to BUY or RENT (to live in, not to invest):
${numbered(q.compra)}

As soon as you have ALL the fields from the matching list, say IMMEDIATELY in that same message that an agent will follow up, and offer that the agent can call them (ask what time suits them) — do not keep requesting extra info or summarize before that. Same if the customer explicitly asked to speak with a person: hand off right away.
${cfg.extraInstructions ? `\nAdditional instructions from Loop (follow them):\n${cfg.extraInstructions}\n` : ""}`;
  }

  return `Sos ${name ? `${name}, ` : ""}el asistente comercial de Loop Inmobiliaria, una inmobiliaria en Uruguay. Tono: ${cfg.tone}. ${EMOJI_RULE.es[cfg.emojis]}

Datos reales de la empresa (usalos directamente si preguntan por dirección, teléfono, email o sitio web — NO digas que "un agente va a confirmar" para esto, ya lo sabés):
- Dirección: ${COMPANY_INFO.address}
- Teléfono / WhatsApp: ${COMPANY_INFO.phone}
- Email: ${COMPANY_INFO.email}
- Sitio web: ${COMPANY_INFO.website}

Respondé de forma breve, cálida y profesional, en máximo ${cfg.maxLines} líneas.
${cfg.greeting ? `Si es el inicio de la conversación (todavía no escribiste ningún mensaje), saludá usando este saludo: "${cfg.greeting}"\n` : ""}Tu objetivo es entender si el cliente quiere COMPRAR, ALQUILAR, INVERTIR, o VENDER una propiedad propia — y conseguir los datos relevantes para calificarlo. NUNCA vuelvas a preguntar algo que ya se respondió en la conversación (incluidas conversaciones anteriores que ves arriba) o que ya conocés por los datos de la propiedad. Si el cliente vuelve a escribir después de un tiempo, reconocelo y seguí desde lo que ya sabés.
Nunca inventes detalles de una propiedad que no te fueron dados.

NUNCA compartas: ${cfg.doNotShare}

Si en cualquier momento el cliente dice que quiere visitar una propiedad en persona / de forma presencial (no un tour virtual, no fotos), preguntale qué día y horario le conviene. Confirmá de qué propiedad se trata (repetile la zona/título para que quede claro cuál) — no tenemos la dirección exacta en el sistema, así que no la inventes: decile que el agente le va a confirmar la dirección exacta junto con el día/horario. En cuanto tengas el día/horario confirmado, decile que un agente va a coordinar y confirmar los detalles de la visita.

NO des por terminada la conversación ni digas que "un agente va a seguir/confirmar" después de solo 2 o 3 datos básicos — eso corta la calificación demasiado pronto. Seguí preguntando, de a un dato por mensaje y EN ESTE ORDEN, hasta completar toda la lista (no te saltes pasos, no la resumas en una pregunta abierta tipo "¿algo más que quieras compartir?"):

Si quiere VENDER su propiedad:
${numbered(q.venta)}

Si quiere INVERTIR:
${numbered(q.inversion)}

Si busca COMPRAR o ALQUILAR (para vivir, no para invertir):
${numbered(q.compra)}

En cuanto tengas TODOS los datos de la lista correspondiente, mencioná INMEDIATAMENTE en ese mismo mensaje que un agente va a seguir con más detalles, y ofrecé que el agente lo llame (preguntá qué horario le queda cómodo) — no sigas pidiendo información extra ni la resumas antes de eso. Lo mismo si el cliente pidió explícitamente hablar con una persona: derivá de inmediato.
${cfg.extraInstructions ? `\nInstrucciones adicionales de Loop (seguilas):\n${cfg.extraInstructions}\n` : ""}`;
}

const TEXT = {
  es: {
    languageLine: `IMPORTANTE: Respondé SIEMPRE en español, sin importar en qué idioma te escriba el cliente (inglés, portugués, o cualquier otro). Nunca cambies de idioma para "seguirle la corriente" al cliente — el negocio opera en español y todas tus respuestas deben ser en español.`,
    noProperty: `Si preguntan por una propiedad específica de Loop que no tenés en estos datos, decí que un agente va a seguir con la info exacta.`,
    propertyIntro: `El cliente está preguntando por esta propiedad específica — usá SOLO estos datos reales, y no vuelvas a preguntar por zona ni tipo de propiedad porque ya los tenés acá:`,
    unavailable: (id, status) => `El cliente preguntó por la propiedad #${id}, pero esa propiedad YA NO ESTÁ DISPONIBLE${status ? ` (estado: ${status})` : ""}. No la ofrezcas ni des sus datos. Avisale amablemente que ya no está disponible y ofrecele buscar opciones similares: seguí con la calificación para entender qué busca.`,
    priceUnlisted: "no listado, decí que un agente lo va a confirmar",
    operationUnspecified: "no especificada",
    mismatch: (operation) => `Si el cliente pide una operación distinta a la de esta propiedad (por ejemplo dice "comprar" pero esta propiedad es de "${operation}"), NO ignores la diferencia: avisale amablemente del malentendido y preguntale si de todas formas quiere info de esta propiedad o si busca otra para lo que realmente quiere hacer.`,
    remaining: `Lo único que todavía te puede faltar es presupuesto, financiación o plazo — preguntá solo por eso si hace falta.`,
    agentFollowUp: (agent) => `Mencioná que ${agent || "el agente asignado"} va a seguir con más detalles.`,
    errorReply: "Disculpá, tuvimos un problema técnico. Un agente te va a responder en breve.",
    agentNote: "[Mensaje de un agente humano de Loop]",
  },
  en: {
    languageLine: `IMPORTANT: This is a TEST-MODE English reply. Do not use this in front of real customers — this language is only for the developer's own testing.`,
    noProperty: `If they ask about a specific Loop property you don't have data for here, say an agent will follow up with exact info.`,
    propertyIntro: `The customer is asking about this specific property — use ONLY these real details, and don't re-ask for zone or type since you already have them here:`,
    unavailable: (id, status) => `The customer asked about property #${id}, but it is NO LONGER AVAILABLE${status ? ` (status: ${status})` : ""}. Do not offer it or share its details. Kindly tell them it's no longer available and offer to find similar options: continue qualifying to understand what they're looking for.`,
    priceUnlisted: "not listed, tell them an agent will confirm",
    operationUnspecified: "not specified",
    mismatch: (operation) => `If the customer asks for a different operation than this property's (e.g. says "buy" but this property is for "${operation}"), do NOT ignore the mismatch: point it out kindly and ask if they still want info on this property or are looking for a different one for what they actually want.`,
    remaining: `The only things you might still be missing are budget, financing, or timeline — only ask about those if needed.`,
    agentFollowUp: (agent) => `Mention that ${agent || "the assigned agent"} will follow up with more details.`,
    errorReply: "Sorry, we had a technical issue. An agent will get back to you shortly.",
    agentNote: "[Message from a human Loop agent]",
  },
};

function buildSystemPrompt(property, cfg) {
  const lang = LANGUAGE === "en" ? "en" : "es";
  const t = TEXT[lang];
  const rules = KNOWLEDGE_RULES[lang];
  // Knowledge base (client's 2026 training PDF) goes after the base
  // instructions and before the language line, so the language rule is
  // still the last thing the model reads.
  const base = `${buildBasePrompt(cfg, lang)}\n${rules}\n${LOOP_KNOWLEDGE}\n\n${t.languageLine}`;

  if (!property) {
    return `${base}\n${t.noProperty}`;
  }

  // Spec #4: a property that is no longer active must not keep being
  // offered — see propertyLookup.isActive / messageHandler.
  if (property.unavailable) {
    return `${base}\n${t.unavailable(property.prop_id, property.status)}`;
  }

  return `${base}
${t.propertyIntro}
- ID: ${property.prop_id}
- ${lang === "en" ? "Title" : "Título"}: ${property.title}
- ${lang === "en" ? "Zone" : "Zona"}: ${property.zone}
- ${lang === "en" ? "Price" : "Precio"}: ${property.price_display || t.priceUnlisted}
- ${lang === "en" ? "Bedrooms" : "Dormitorios"}: ${property.bedrooms ?? "-"}
- ${lang === "en" ? "Bathrooms" : "Baños"}: ${property.bathrooms ?? "-"}
- ${lang === "en" ? "Area" : "Superficie"}: ${property.area_m2 ? property.area_m2 + " m²" : "-"}
- ${lang === "en" ? "Operation" : "Operación"}: ${property.operation || t.operationUnspecified}
- Link: ${property.link || "-"}
${t.mismatch(property.operation)}
${t.remaining}
${t.agentFollowUp(property.agent_name)}`;
}

// Conversation context now comes from the database, not an in-memory
// object (2026-09-30, spec #12). The old in-memory version:
//  - was wiped on every Render restart/cold start, so a returning customer
//    was treated as a stranger and got re-asked everything;
//  - never contained what a HUMAN agent wrote while in human mode, so after
//    handing a chat back to AI, the bot didn't know what the agent had
//    already told the customer.
// Reading the last HISTORY_LIMIT messages from Postgres fixes both.
async function loadHistory(from, userText, lang) {
  let rows = [];
  try {
    rows = await messagesDb.getMessages(from, HISTORY_LIMIT);
  } catch (err) {
    logger.error(`Could not load history for ${from}, replying without it:`, err.message);
  }
  const history = rows.map(m => {
    if (m.sender === "customer") return { role: "user", content: m.text };
    if (m.sender === "agent") return { role: "assistant", content: `${TEXT[lang].agentNote} ${m.text}` };
    return { role: "assistant", content: m.text };
  });
  // messageHandler saves the incoming message fire-and-forget, so it may or
  // may not be in the DB yet — make sure it's the last user turn exactly once.
  const last = history[history.length - 1];
  if (!(last && last.role === "user" && last.content === userText)) {
    history.push({ role: "user", content: userText });
  }
  return history;
}

async function getAIReply(from, userText, property = null) {
  const lang = LANGUAGE === "en" ? "en" : "es";
  try {
    const cfg = await aiConfig.getConfig();
    const history = await loadHistory(from, userText, lang);
    const messages = [{ role: "system", content: buildSystemPrompt(property, cfg) }, ...history];

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      // Raised from 150 (2026-09-30): knowledge-base answers (costs,
      // purchase steps, guarantees) can need 4-5 lines, and 150 tokens was
      // cutting those off mid-sentence.
      max_tokens: 300,
    });

    const reply = response.choices[0].message.content.trim();
    logger.info(`AI reply generated for ${from} (language: ${LANGUAGE}, context: ${history.length} msgs)`);
    return reply;
  } catch (err) {
    logger.error("Error calling OpenAI:", err);
    return TEXT[lang].errorReply;
  }
}

// Kept for the dashboard's "delete chat" route. History now lives in the
// DB (which that route already deletes), so there's nothing extra to clear.
function clearConversationHistory() {}

module.exports = { getAIReply, getLanguage, setLanguage, clearConversationHistory };
