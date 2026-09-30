// services/adminNotify.js
// Sends WhatsApp alerts to the client's team when something needs a human:
// a lead finishes qualification (HOT), a visit gets scheduled, or the AI
// hands a conversation off. The admin's number is stored in app_settings
// (editable from the dashboard). Since 2026-09-30 (spec #6 / #11) the
// property's RESPONSIBLE AGENT is also notified, using the agent -> phone
// map in services/aiConfig.js (AGENT_PHONES), and handoff alerts carry the full lead
// summary + last messages so nobody has to ask the customer again.
//
// NOTE (WhatsApp rule): the Cloud API only delivers a free-form text to a
// number that has messaged the business number in the last 24h. If an
// admin/agent hasn't, Meta rejects the send (logged below as a failed
// alert) — they just need to send any message to the Loop number once a day,
// or a Meta-approved template has to be set up for alerts.
const settingsDb = require('./settingsDb');
const aiConfig = require('./aiConfig');
const { sendTextMessage } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

const ADMIN_PHONE_KEY = 'admin_phone';

const OPERATION_LABELS = { compra: 'Compra', alquiler: 'Alquiler', inversion: 'Inversión', venta: 'Venta (propietario)' };

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
  } catch (err) {
    logger.error(`Failed to send alert to ${who} ${phone} (if they haven't messaged the Loop number in 24h, WhatsApp blocks it):`, err.message);
  }
}

// Admin always; the responsible agent too when we know their number.
// Same number for both (admin is also the agent) -> sent once.
async function sendAlert(message, agentName = '') {
  const [admin, agent] = await Promise.all([
    getAdminPhone().catch(() => ''),
    aiConfig.getAgentPhone(agentName).catch(() => ''),
  ]);
  if (!admin && !agent) {
    logger.info(`Alert skipped (no admin/agent phone configured yet): ${message.split('\n')[0]}`);
    return;
  }
  if (admin) await sendTo(admin, message, 'admin');
  if (agent && agent !== admin) await sendTo(agent, message, `agent (${agentName})`);
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
  add('Name', lead.name);
  add('Operation', OPERATION_LABELS[lead.operation] || lead.operation);
  add('Type', lead.type);
  add('Zone', lead.zone);
  add('Budget', lead.budget);
  add('Bedrooms', lead.bedrooms);
  add('Bathrooms', lead.bathrooms);
  add('Financing', lead.financing);
  add('Timeline', lead.timeline);
  add('Features', lead.features);
  add('Address', lead.address);
  add('Postcode', lead.postcode);
  add('Link sent', lead.property_link);
  return lines;
}

// Link straight to this customer's chat on the dashboard (not wa.me, which
// would open a chat from the agent's PERSONAL number instead of the Loop
// business number the customer has been talking to).
const DASHBOARD_BASE = (process.env.PUBLIC_URL || 'https://loop1-qao5.onrender.com').replace(/\/$/, '');
function chatLink(phone) {
  return `${DASHBOARD_BASE}/dashboard?phone=${encodeURIComponent(phone)}`;
}

async function notifyHotLead(phone, lead = {}, agentName = '') {
  const lines = [`🔥 New HOT lead: ${phone}`, ...leadLines(lead)];
  if (agentName) lines.push(`Assigned agent: ${agentName}`);
  lines.push(`Chat: ${chatLink(phone)}`);
  await sendAlert(lines.join('\n'), agentName);
}

async function notifyVisitScheduled(phone, details = {}) {
  const lines = [`📅 Visit scheduled: ${phone}`];
  if (details.name) lines.push(`Name: ${details.name}`);
  if (details.visitWhen) lines.push(`Day/time: ${details.visitWhen}`);
  if (details.property) lines.push(`Property: ${details.property}`);
  if (details.link) lines.push(`Link: ${details.link}`);
  if (details.property_id && !details.property) lines.push(`Property: #${details.property_id}`);
  if (details.agent_name) lines.push(`Assigned agent: ${details.agent_name}`);
  lines.push(`Note: exact address isn't in our system — confirm it directly with the customer.`);
  await sendAlert(lines.join('\n'), details.agent_name || '');
}

// Spec #11: "Derivar al agente correspondiente con todo el contexto
// recopilado. Evitar que el cliente tenga que repetir información."
async function notifyHandoff(phone, { reason = '', lead = {}, property = null, recent = [], agentName = '' } = {}) {
  const lines = [`🙋 Handoff to a human: ${phone}`];
  if (reason) lines.push(`Reason: ${reason}`);
  if (property && property.prop_id) {
    lines.push(`Property: #${property.prop_id}${property.title ? ` ${property.title}` : ''}${property.zone ? ` (${property.zone})` : ''}${property.unavailable ? ' — NO LONGER AVAILABLE' : ''}`);
    if (property.link) lines.push(`Link: ${property.link}`);
  }
  if (agentName) lines.push(`Assigned agent: ${agentName}`);
  const info = leadLines(lead);
  if (info.length) lines.push('', 'What we know:', ...info);
  if (recent.length) {
    lines.push('', 'Last messages:');
    recent.forEach(m => {
      const who = m.sender === 'customer' ? 'Customer' : (m.sender === 'agent' ? 'Agent' : 'AI');
      const text = String(m.text || '').replace(/\s+/g, ' ');
      lines.push(`${who}: ${text.length > 160 ? text.slice(0, 157) + '…' : text}`);
    });
  }
  lines.push('', `The AI is now paused for this chat — reply from the dashboard: ${chatLink(phone)}`);
  await sendAlert(lines.join('\n'), agentName);
}

module.exports = { getAdminPhone, setAdminPhone, sendAdminAlert, sendAlert, notifyHotLead, notifyVisitScheduled, notifyHandoff };
