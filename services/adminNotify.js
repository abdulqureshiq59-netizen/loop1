// services/adminNotify.js
// WhatsApp alerts to Loop's team, all in SPANISH (client request 2026-10-01).
//
// Who gets them:
//  - the admin number (saved on the Chats page) — always;
//  - the property's RESPONSIBLE AGENT (client request 2026-10-01: "siempre
//    que detecte de quién es la propiedad, que mande la alerta con toda la
//    información al agente correspondiente"). Agent number comes from, in
//    order: dashboard "Entrenar IA" -> Agentes, AGENT_PHONES in
//    services/aiConfig.js, or the phone NAI sends with the listing.
//
// When:
//  - notifyPropertyInquiry: the bot identified which property the customer
//    is asking about (link / number) or suggested one to them;
//  - notifyHotLead: qualification finished;
//  - notifyVisitScheduled: customer confirmed a day/time to visit;
//  - notifyHandoff: the AI handed the chat to a person.
//
// WhatsApp rule: the Cloud API only delivers a free-form message to a number
// that wrote to the Loop number in the last 24h. If an agent hasn't, Meta
// rejects the send (logged as a failed alert).
const settingsDb = require('./settingsDb');
const aiConfig = require('./aiConfig');
const { sendTextMessage } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

const ADMIN_PHONE_KEY = 'admin_phone';

const OPERATION_LABELS = { compra: 'Compra', alquiler: 'Alquiler', inversion: 'Inversión', venta: 'Venta (propietario)' };
const TEMP_LABELS = { Caliente: 'Caliente 🔥', Tibio: 'Tibio', Frio: 'Frío' };

// Link straight to this customer's chat on the dashboard (not wa.me, which
// would open a chat from the agent's personal number instead of the Loop
// business number the customer has been talking to).
const DASHBOARD_BASE = (process.env.PUBLIC_URL || 'https://loop1-qao5.onrender.com').replace(/\/$/, '');
function chatLink(phone) {
  return `${DASHBOARD_BASE}/dashboard?phone=${encodeURIComponent(phone)}`;
}

async function getAdminPhone() {
  return settingsDb.getSetting(ADMIN_PHONE_KEY, '');
}

async function setAdminPhone(phone) {
  return settingsDb.setSetting(ADMIN_PHONE_KEY, phone);
}

async function sendTo(phone, message, who) {
  try {
    await sendTextMessage(phone, message);
    logger.info(`Alert sent to ${who} ${phone}: ${message.split('\n')[0]}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send alert to ${who} ${phone} (if they haven't messaged the Loop number in 24h, WhatsApp blocks it):`, err.message);
    return false;
  }
}

// Sends to the responsible agent (if we have their number) and the admin.
// If the agent is known but has no number, the admin's copy says so, so
// someone can add it in "Entrenar IA" -> Agentes.
async function sendAlert(message, agentName = '', agentPhoneHint = '') {
  const [admin, agent] = await Promise.all([
    getAdminPhone().catch(() => ''),
    aiConfig.getAgentPhone(agentName, agentPhoneHint).catch(() => ''),
  ]);
  if (!admin && !agent) {
    logger.info(`Alert skipped (no admin/agent phone configured yet): ${message.split('\n')[0]}`);
    return;
  }
  if (agent) await sendTo(agent, message, `agent (${agentName || 'NAI phone'})`);
  if (admin && admin !== agent) {
    const note = agentName && !agent
      ? `\n\n⚠️ El agente ${agentName} no tiene número cargado. Agregalo en el Dashboard → 🧠 Entrenar IA → Agentes para que reciba sus alertas.`
      : '';
    await sendTo(admin, message + note, 'admin');
  }
}

// Kept for any caller that only wants the admin.
async function sendAdminAlert(message) {
  const phone = await getAdminPhone();
  if (!phone) {
    logger.info(`Admin alert skipped (no admin phone configured yet): ${message.split('\n')[0]}`);
    return;
  }
  await sendTo(phone, message, 'admin');
}

function leadLines(lead = {}) {
  const lines = [];
  const add = (label, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') lines.push(`${label}: ${v}`); };
  add('Nombre', lead.name);
  add('Operación', OPERATION_LABELS[lead.operation] || lead.operation);
  add('Tipo', lead.type);
  add('Zona', lead.zone);
  add('Presupuesto', lead.budget);
  add('Dormitorios', lead.bedrooms);
  add('Baños', lead.bathrooms);
  add('Financiación', lead.financing);
  add('Plazo', lead.timeline);
  add('Características', lead.features);
  add('Dirección', lead.address);
  add('Código postal', lead.postcode);
  add('Temperatura', TEMP_LABELS[lead.temperature] || lead.temperature);
  add('Link enviado', lead.property_link);
  return lines;
}

function propertyLines(property) {
  if (!property || !property.prop_id) return [];
  const lines = [`Propiedad: #${property.prop_id}${property.title ? ` ${property.title}` : ''}${property.zone ? ` (${property.zone})` : ''}${property.unavailable ? ' — YA NO DISPONIBLE' : ''}`];
  if (property.price_display) lines.push(`Precio: ${property.price_display}`);
  if (property.operation) lines.push(`Operación: ${property.operation}`);
  if (property.link) lines.push(`Link: ${property.link}`);
  return lines;
}

function recentLines(recent = []) {
  if (!recent.length) return [];
  const out = ['', 'Últimos mensajes:'];
  recent.forEach(m => {
    const who = m.sender === 'customer' ? 'Cliente' : (m.sender === 'agent' ? 'Agente' : 'IA');
    const text = String(m.text || '').replace(/\s+/g, ' ');
    out.push(`${who}: ${text.length > 160 ? text.slice(0, 157) + '…' : text}`);
  });
  return out;
}

// The bot just identified (or suggested) a property -> tell its agent now,
// so they can follow the conversation from the start.
async function notifyPropertyInquiry(phone, { property, lead = {}, recent = [], suggested = false } = {}) {
  const lines = [
    suggested
      ? `🏠 La IA le sugirió tu propiedad a un cliente: ${phone}`
      : `🏠 Nuevo cliente consultando por tu propiedad: ${phone}`,
    ...propertyLines(property),
  ];
  if (property && property.agent_name) lines.push(`Agente responsable: ${property.agent_name}`);
  const info = leadLines(lead);
  if (info.length) lines.push('', 'Lo que sabemos del cliente:', ...info);
  lines.push(...recentLines(recent));
  lines.push('', `La IA sigue atendiendo y calificando. Ver la conversación: ${chatLink(phone)}`);
  await sendAlert(lines.join('\n'), property && property.agent_name, property && property.agent_phone);
}

async function notifyHotLead(phone, lead = {}, agentName = '', agentPhoneHint = '', property = null) {
  const lines = [`🔥 Lead CALIENTE (calificación completa): ${phone}`, ...leadLines(lead), ...propertyLines(property)];
  if (agentName) lines.push(`Agente responsable: ${agentName}`);
  lines.push('', `Ver la conversación: ${chatLink(phone)}`);
  await sendAlert(lines.join('\n'), agentName, agentPhoneHint);
}

async function notifyVisitScheduled(phone, details = {}) {
  const lines = [`📅 Visita coordinada: ${phone}`];
  if (details.name) lines.push(`Nombre: ${details.name}`);
  if (details.visitWhen) lines.push(`Día/horario: ${details.visitWhen}`);
  if (details.property) lines.push(`Propiedad: ${details.property}`);
  if (details.link) lines.push(`Link: ${details.link}`);
  if (details.property_id && !details.property) lines.push(`Propiedad: #${details.property_id}`);
  if (details.agent_name) lines.push(`Agente responsable: ${details.agent_name}`);
  lines.push(`Nota: la dirección exacta no está en el sistema — confirmala directamente con el cliente.`);
  lines.push('', `Ver la conversación: ${chatLink(phone)}`);
  await sendAlert(lines.join('\n'), details.agent_name || '', details.agent_phone || '');
}

// "Derivar al agente correspondiente con todo el contexto recopilado.
// Evitar que el cliente tenga que repetir información."
async function notifyHandoff(phone, { reason = '', lead = {}, property = null, recent = [], agentName = '', agentPhoneHint = '' } = {}) {
  const lines = [`🙋 El cliente necesita una persona: ${phone}`];
  if (reason) lines.push(`Motivo: ${reason}`);
  lines.push(...propertyLines(property));
  if (agentName) lines.push(`Agente responsable: ${agentName}`);
  const info = leadLines(lead);
  if (info.length) lines.push('', 'Lo que sabemos del cliente:', ...info);
  lines.push(...recentLines(recent));
  lines.push('', `La IA quedó pausada en este chat. Respondé desde el Dashboard: ${chatLink(phone)}`);
  await sendAlert(lines.join('\n'), agentName, agentPhoneHint);
}

module.exports = {
  getAdminPhone, setAdminPhone, sendAdminAlert, sendAlert,
  notifyPropertyInquiry, notifyHotLead, notifyVisitScheduled, notifyHandoff,
};
