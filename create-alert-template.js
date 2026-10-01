// create-alert-template.js
// Creates the Meta-approved WhatsApp template used for INTERNAL alerts to
// Loop's agents (new property inquiry, hot lead, visit, handoff), so they
// arrive even if the agent hasn't written to the Loop number in 24 hours.
//
// Run once from the project folder (uses WHATSAPP_TOKEN and
// WHATSAPP_BUSINESS_ACCOUNT_ID from .env):
//
//   node create-alert-template.js          -> creates the template
//   node create-alert-template.js status   -> shows if Meta approved it
//
// Meta usually reviews UTILITY templates in minutes (can take up to 24 h).
// Until it's APPROVED the bot keeps sending alerts as normal text.

require("dotenv").config();
const axios = require("axios");

const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;
const NAME = process.env.ALERT_TEMPLATE_NAME || "alerta_interna_loop";
const LANG = process.env.ALERT_TEMPLATE_LANG || "es";
const BASE = `https://graph.facebook.com/v21.0/${WABA_ID}/message_templates`;
const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// {{1}} what happened · {{2}} customer · {{3}} property · {{4}} details · {{5}} dashboard link
// (Meta rule: a template can't start or end with a variable.)
const BODY =
  "Alerta interna de Loop Inmobiliaria: {{1}}.\n\n" +
  "Cliente: {{2}}\n" +
  "Propiedad: {{3}}\n" +
  "Información: {{4}}\n\n" +
  "Ver la conversación completa: {{5}}\n\n" +
  "Mensaje automático del Agente IA de Loop para el equipo comercial.";

const EXAMPLE = [
  "nuevo cliente consultando por tu propiedad",
  "Juan Pérez (+59899123456)",
  "#718 Casa en Carrasco con jardín (Carrasco) USD 350.000",
  "Agente: Martín | Operación: Compra, Zona: Carrasco | Último mensaje: \"¿Sigue disponible?\"",
  "https://loop1-qao5.onrender.com/dashboard?phone=59899123456",
];

async function create() {
  console.log(`Creating template "${NAME}" (${LANG}) on WABA ${WABA_ID}...`);
  try {
    const res = await axios.post(BASE, {
      name: NAME,
      language: LANG,
      category: "UTILITY",
      components: [{ type: "BODY", text: BODY, example: { body_text: [EXAMPLE] } }],
    }, { headers });
    console.log("✅ Sent to Meta for review:", JSON.stringify(res.data));
    console.log(`Check approval later with:  node create-alert-template.js status`);
  } catch (err) {
    const e = err.response?.data?.error;
    if (e && /already exists|duplicate/i.test(`${e.message} ${e.error_user_msg || ""}`)) {
      console.log(`ℹ️ The template "${NAME}" already exists — checking its status instead.`);
      return status();
    }
    console.log("❌ Error:", JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

async function status() {
  try {
    const res = await axios.get(BASE, { headers, params: { name: NAME, fields: "name,status,language,category,rejected_reason" } });
    const rows = res.data.data || [];
    if (!rows.length) return console.log(`Template "${NAME}" not found. Run: node create-alert-template.js`);
    rows.forEach(t => console.log(`${t.name} [${t.language}] ${t.category}: ${t.status}${t.rejected_reason && t.rejected_reason !== "NONE" ? ` (reason: ${t.rejected_reason})` : ""}`));
    if (rows.some(t => t.status === "APPROVED")) console.log("✅ Approved — agent alerts are now delivered even after 24 h.");
  } catch (err) {
    console.log("❌ Error:", JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

(process.argv[2] === "status" ? status() : create());
