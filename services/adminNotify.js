// services/adminNotify.js
// WhatsApp alerts to Loop's team, all in SPANISH.
//
// Who gets them:
//  - the admin number (saved on the Chats page) — always;
//  - the property's RESPONSIBLE AGENT. Agent number comes from, in order:
//    dashboard "Entrenar IA" -> Agentes, AGENT_PHONES in
//    services/aiConfig.js, or the phone NAI sends with the listing;
//  - anyone marked "Recibe todas las alertas" on that same page.
//
// When:
//  - notifyPropertyInquiry: the bot identified which property the customer
//    is asking about (link / number) or suggested one to them;
//  - notifyHotLead: qualification finished;
//  - notifyVisitScheduled: customer confirmed a day/time to visit;
//  - notifyHandoff: the AI handed the chat to a person.
//
// HOW (2026-10-01, client request): WhatsApp only lets a business send a
// free-form text to someone who wrote to it in the last 24h. To not depend
// on that, every alert is sent as a Meta-APPROVED TEMPLATE
// (ALERT_TEMPLATE_NAME, created once with create-alert-template.js), which
// is delivered any time. If the template isn't approved yet / doesn't
// exist, it falls back to the old free-form text automatically.
const settingsDb = require('./settingsDb');
const aiConfig = require('./aiConfig');
const { sendTextMessage, sendTemplateMessage } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

const ADMIN_PHONE_KEY = 'admin_phone';

// Template set up by create-alert-template.js. Set ALERT_TEMPLATE_NAME to
// an empty value in Render to turn templates off and use plain text only.
const ALERT_TEMPLATE_NAME = process.env.ALERT_TEMPLATE_NAME !== undefined
  ? process.env.ALERT_TEMPLATE_NAME.trim()
  : 'alerta_interna_loop';
const ALERT_TEMPLATE_LANG = process.env.ALERT_TEMPLATE_LANG || 'es';
// Max characters per template variable — keeps the whole template under
// WhatsApp's 1024-character body limit.
const PARAM_MAX = [80, 90, 160, 400, 120];

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

// If Meta says the template doesn't exist / isn't approved yet, don't try
// it again for a while (avoids an error on every single alert meanwhile).
let templateUnavailableUntil = 0;

async function deliver(phone, text, tpl, who) {
  if (tpl && ALERT_TEMPLATE_NAME && Date.now() > templateUnavailableUntil) {
    try {
      const params = [tpl.title, tpl.customer, tpl.property, tpl.info, tpl.link];
      await sendTemplateMessage(phone, ALERT_TEMPLATE_NAME, ALERT_TEMPLATE_LANG, params.map((p, i) => clip(p, PARAM_MAX[i])));
      logger.info(`Alert (template) sent to ${who} ${phone}: ${tpl.title}`);
      return true;
    } catch (err) {
      const code = err.response?.data?.error?.code;
      // 132000-132016 = template missing / not approved / wrong params.
      if (code && code >= 132000 && code < 133000) {
        templateUnavailableUntil = Date.now() + 10 * 60 * 1000;
        logger.warn(`Alert template "${ALERT_TEMPLATE_NAME}" not usable yet (code ${code}) — sending plain text for the next 10 min`);
      }
    }
  }
  try {
    await sendTextMessage(phone, text);
    logger.info(`Alert (text) sent to ${who} ${phone}: ${text.split('\n')[0]}`);
    return true;
  } catch (err) {
    logger.error(`Failed to send alert to ${who} ${phone}:`, err.message);
    return false;
  }
}

function clip(v, max) {
  const t = String(v == null ? '' : v).trim() || '-';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

// Sends to: responsible agent + everyone with "all alerts" + admin (each
// number once). If the agent is known but has no number, the admin's copy
// says so, so someone can add it in "Entrenar IA" -> Agentes.
async function sendAlert(message, agentName = '', agentPhoneHint = '', tpl = null) {
  const [admin, agent, allPhones] = await Promise.all([
    getAdminPhone().catch(() => ''),
    aiConfig.getAgentPhone(agentName, agentPhoneHint).catch(() => ''),
    aiConfig.getAlertAllPhones().catch(() => []),
  ]);
  const adminPhone = aiConfig.normalizePhone(admin);
  const sent = new Set();

  if (agent) { await deliver(agent, message, tpl, `agent (${agentName || 'NAI phone'})`); sent.add(agent); }
  for (const p of allPhones) {
    if (sent.has(p)) continue;
    await deliver(p, message, tpl, 'all-alerts recipient');
    sent.add(p);
  }
  if (adminPhone && !sent.has(adminPhone)) {
    const missing = agentName && !agent;
    const note = missing
      ? `\n\n⚠️ El agente ${agentName} no tiene número cargado. Agregalo en el Dashboard → 🧠 Entrenar IA → Agentes para que reciba sus alertas.`
      : '';
    const adminTpl = tpl && missing ? { ...tpl, info: `⚠️ ${agentName} sin número cargado (Entrenar IA → Agentes). ${tpl.info}` } : tpl;
    await deliver(adminPhone, message + note, adminTpl, 'admin');
    sent.add(adminPhone);
  }
  if (!sent.size) logger.info(`Alert skipped (no admin/agent phone configured yet): ${message.split('\n')[0]}`);
}

// Kept for any caller that only wants the admin.
async function sendAdminAlert(message) {
  const phone = await getAdminPhone();
  if (!phone) {
    logger.info(`Admin alert skipped (no admin phone configured yet): ${message.split('\n')[0]}`);
    return;
  }
  await deliver(phone, message, null, 'admin');
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

// ---- One-line versions for the template's variables ----
function tplCustomer(phone, lead = {}) {
  return lead.name ? `${lead.name} (+${phone})` : `+${phone}`;
}
function tplProperty(property) {
  if (!property || !property.prop_id) return 'Sin propiedad específica';
  return [
    `#${property.prop_id}`,
    property.title,
    property.zone ? `(${property.zone})` : '',
    property.price_display,
    property.unavailable ? 'YA NO DISPONIBLE' : '',
  ].filter(Boolean).join(' ');
}
function tplInfo(parts, lead = {}, recent = []) {
  const bits = [...parts];
  const l = leadLines(lead).filter(x => !x.startsWith('Nombre:'));
  if (l.length) bits.push(l.join(', '));
  const lastCustomer = [...recent].reverse().find(m => m.sender === 'customer');
  if (lastCustomer) bits.push(`Último mensaje: "${String(lastCustomer.text || '').replace(/\s+/g, ' ').slice(0, 140)}"`);
  return bits.filter(Boolean).join(' | ') || 'Sin más datos todavía';
}

// The bot just identified (or suggested) a property -> tell its agent now,
// so they can follow the conversation from the start.
async function notifyPropertyInquiry(phone, { property, lead = {}, recent = [], suggested = false } = {}) {
  const title = suggested ? 'la IA le sugirió tu propiedad a un cliente' : 'nuevo cliente consultando por tu propiedad';
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
  const tpl = {
    title,
    customer: tplCustomer(phone, lead),
    property: tplProperty(property),
    info: tplInfo([property && property.agent_name ? `Agente: ${property.agent_name}` : '', 'La IA sigue atendiendo'], lead, recent),
    link: chatLink(phone),
  };
  await sendAlert(lines.join('\n'), property && property.agent_name, property && property.agent_phone, tpl);
}

async function notifyHotLead(phone, lead = {}, agentName = '', agentPhoneHint = '', property = null) {
  const lines = [`🔥 Lead CALIENTE (calificación completa): ${phone}`, ...leadLines(lead), ...propertyLines(property)];
  if (agentName) lines.push(`Agente responsable: ${agentName}`);
  lines.push('', `Ver la conversación: ${chatLink(phone)}`);
  const tpl = {
    title: 'lead CALIENTE, calificación completa',
    customer: tplCustomer(phone, lead),
    property: tplProperty(property),
    info: tplInfo([agentName ? `Agente: ${agentName}` : ''], lead),
    link: chatLink(phone),
  };
  await sendAlert(lines.join('\n'), agentName, agentPhoneHint, tpl);
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
  const tpl = {
    title: 'visita coordinada',
    customer: tplCustomer(phone, { name: details.name }),
    property: details.property || (details.property_id ? `#${details.property_id}` : 'Sin propiedad específica'),
    info: [details.visitWhen ? `Día/horario: ${details.visitWhen}` : '', details.agent_name ? `Agente: ${details.agent_name}` : '', 'Confirmá la dirección exacta con el cliente'].filter(Boolean).join(' | '),
    link: chatLink(phone),
  };
  await sendAlert(lines.join('\n'), details.agent_name || '', details.agent_phone || '', tpl);
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
  const tpl = {
    title: 'el cliente necesita una persona (la IA quedó pausada)',
    customer: tplCustomer(phone, lead),
    property: tplProperty(property),
    info: tplInfo([reason ? `Motivo: ${reason}` : '', agentName ? `Agente: ${agentName}` : ''], lead, recent),
    link: chatLink(phone),
  };
  await sendAlert(lines.join('\n'), agentName, agentPhoneHint, tpl);
}

module.exports = {
  getAdminPhone, setAdminPhone, sendAdminAlert, sendAlert,
  notifyPropertyInquiry, notifyHotLead, notifyVisitScheduled, notifyHandoff,
  ALERT_TEMPLATE_NAME, ALERT_TEMPLATE_LANG,
};
