// services/aiConfig.js
// How the bot behaves. CONFIG below is edited in code (tone, questions...).
// Since 2026-10-01 the client can ALSO, from the dashboard's "Entrenar IA"
// page: add knowledge entries the bot must use (getTraining), and set each
// agent's WhatsApp number for alerts (getSavedAgentPhones).
//
//   CONFIG        -> bot name, tone, emojis, greeting, what it must never
//                    share, extra rules, extra handoff rules, and the
//                    qualification questions for each operation (in order).
//                    Keep "Nombre del cliente" and "Código postal" in every
//                    list: HOT-lead alerts and property suggestions wait for
//                    them.
//   AGENT_PHONES  -> WhatsApp number of each responsible agent, EXACTLY as
//                    their name appears on the website/NAI (vendedor), so
//                    they get handoff / HOT-lead / visit alerts.

const settingsDb = require('./settingsDb');
const logger = require('../utils/logger');

const CONFIG = {
  botName: '',
  tone: 'cercano, cálido, honesto y profesional, como un asesor de Loop',
  emojis: 'pocos', // "ninguno" | "pocos" | "libre"
  // Client (2026-10-01): "respuestas más cortas y no con tanto texto".
  maxLines: 2,
  greeting: '',
  extraInstructions: '',
  doNotShare:
    'Estrategias internas de precio (precio mínimo, margen de negociación), comisiones compartidas con colegas, ' +
    'datos personales de otros clientes o propietarios, y direcciones exactas de propiedades.',
  handoffRules: '',
  questions: {
    venta: [
      'Ubicación de la propiedad',
      'Tipo de propiedad',
      'Precio esperado',
      'Plazo o motivo para vender',
      'Baños',
      'Dormitorios',
      'Alguna característica o zona específica que quiera destacar',
      'Nombre del cliente',
      'Teléfono de contacto (si ya lo tenés de la conversación de WhatsApp, confirmalo en vez de volver a preguntar)',
      'Dirección',
      'Código postal',
    ],
    inversion: [
      'Presupuesto de inversión',
      'Zona preferida',
      'Tipo de propiedad',
      'Propósito o retorno esperado de la inversión (por ejemplo: renta, reventa, plazo de recupero)',
      'Financiación',
      'Plazo',
      'Nombre del cliente',
      'Teléfono de contacto (si ya lo tenés de la conversación de WhatsApp, confirmalo en vez de volver a preguntar)',
      'Dirección',
      'Código postal',
    ],
    compra: [
      'Zona',
      'Tipo de propiedad',
      'Presupuesto',
      'Dormitorios',
      'Baños',
      'Financiación (si aplica) y plazo o urgencia',
      'Nombre del cliente',
      'Teléfono de contacto (si ya lo tenés de la conversación de WhatsApp, confirmalo en vez de volver a preguntar)',
      'Dirección',
      'Código postal',
    ],
  },
};

// Agent name (as on the website) -> WhatsApp number with country code.
// Example:  'Martín Pérez': '59899123456',
// Numbers saved from the dashboard ("Entrenar IA" -> Agentes) take priority
// over these, and both over the phone NAI sends for the agent (if any).
const AGENT_PHONES = {
  // 'Nombre Apellido': '598XXXXXXXX',
};

function cleanList(list) {
  return (list || []).map(q => String(q || '').trim()).filter(Boolean);
}

const FINAL = {
  ...CONFIG,
  emojis: ['ninguno', 'pocos', 'libre'].includes(CONFIG.emojis) ? CONFIG.emojis : 'pocos',
  questions: {
    venta: cleanList(CONFIG.questions.venta),
    inversion: cleanList(CONFIG.questions.inversion),
    compra: cleanList(CONFIG.questions.compra),
  },
};

async function getConfig() {
  return FINAL;
}

function normName(name) {
  return String(name || '').trim().toLowerCase();
}

// ---- Saved from the dashboard (app_settings) ----
const TRAINING_KEY = 'ai_training';
const AGENT_PHONES_KEY = 'agent_phones';
const CACHE_MS = 15 * 1000;
const cache = {};

async function readJson(key, fallback) {
  const hit = cache[key];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value = fallback;
  try {
    const raw = await settingsDb.getSetting(key, '');
    value = raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    logger.error(`Could not read setting ${key}:`, err.message);
  }
  cache[key] = { value, at: Date.now() };
  return value;
}

async function writeJson(key, value) {
  await settingsDb.setSetting(key, JSON.stringify(value));
  cache[key] = { value, at: Date.now() };
  return value;
}

// Knowledge entries the client adds ("Entrenar IA"). Each: {id, title, content, updatedAt}.
const MAX_ENTRY_CHARS = 3000;
const MAX_TOTAL_CHARS = 20000;

async function getTraining() {
  const list = await readJson(TRAINING_KEY, []);
  return Array.isArray(list) ? list : [];
}

async function setTraining(list) {
  const clean = (Array.isArray(list) ? list : [])
    .map(e => ({
      id: String(e.id || Date.now() + Math.random()).slice(0, 40),
      title: String(e.title || '').trim().slice(0, 120),
      content: String(e.content || '').trim().slice(0, MAX_ENTRY_CHARS),
      updatedAt: e.updatedAt || new Date().toISOString(),
    }))
    .filter(e => e.content);
  const total = clean.reduce((n, e) => n + e.title.length + e.content.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    throw new Error(`Demasiado texto en total (${total} caracteres, máximo ${MAX_TOTAL_CHARS}). Resumí o borrá alguna entrada.`);
  }
  return writeJson(TRAINING_KEY, clean);
}

async function getSavedAgentPhones() {
  const obj = await readJson(AGENT_PHONES_KEY, {});
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
}

async function setSavedAgentPhones(map) {
  const clean = {};
  Object.entries(map || {}).forEach(([name, phone]) => {
    const n = String(name || '').trim();
    const p = normalizePhone(phone);
    if (n && p) clean[n] = p;
  });
  return writeJson(AGENT_PHONES_KEY, clean);
}

// Uruguay numbers are often written locally ("099 123 456"): turn a
// leading 0 into the 598 country code so WhatsApp accepts it.
function normalizePhone(phone) {
  let d = String(phone || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length >= 8 && d.length <= 9) d = '598' + d.slice(1);
  return d;
}

function findByName(map, name) {
  const target = normName(name);
  const hit = Object.entries(map || {}).find(([n]) => normName(n) === target);
  return hit ? normalizePhone(hit[1]) : '';
}

// Priority: number saved on the dashboard > AGENT_PHONES in code > phone
// that NAI sends with the property's agent (fallbackPhone).
async function getAgentPhone(agentName, fallbackPhone = '') {
  if (!agentName && !fallbackPhone) return '';
  const saved = agentName ? findByName(await getSavedAgentPhones(), agentName) : '';
  if (saved) return saved;
  const coded = agentName ? findByName(AGENT_PHONES, agentName) : '';
  if (coded) return coded;
  return normalizePhone(fallbackPhone);
}

module.exports = {
  CONFIG, AGENT_PHONES, getConfig, getAgentPhone, normalizePhone,
  getTraining, setTraining, getSavedAgentPhones, setSavedAgentPhones,
};
