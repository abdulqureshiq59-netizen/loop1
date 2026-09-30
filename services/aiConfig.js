// services/aiConfig.js
// ONE place to change how the bot behaves (2026-09-30). Edit this file and
// redeploy — nothing here is editable from the dashboard (the dashboard is
// kept to just Chats + Pipeline).
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

const CONFIG = {
  botName: '',
  tone: 'cercano, cálido, honesto y profesional, como un asesor de Loop',
  emojis: 'pocos', // "ninguno" | "pocos" | "libre"
  maxLines: 3,
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
// Agents not listed here get no alert; the admin number (Chats page) always does.
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

async function getAgentPhone(agentName) {
  if (!agentName) return '';
  const target = normName(agentName);
  const hit = Object.entries(AGENT_PHONES).find(([n]) => normName(n) === target);
  return hit ? String(hit[1]).replace(/[^\d]/g, '') : '';
}

module.exports = { CONFIG, AGENT_PHONES, getConfig, getAgentPhone };
