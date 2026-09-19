// services/adminNotify.js
// Sends the client's own admin a WhatsApp message when something worth
// their attention happens — currently: a lead becomes HOT, or a visit gets
// scheduled. The admin's number is stored in app_settings (editable from
// the dashboard), not hardcoded, per the client's request (2026-09-19).
const settingsDb = require('./settingsDb');
const { sendTextMessage } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

const ADMIN_PHONE_KEY = 'admin_phone';

async function getAdminPhone() {
  return settingsDb.getSetting(ADMIN_PHONE_KEY, '');
}

async function setAdminPhone(phone) {
  return settingsDb.setSetting(ADMIN_PHONE_KEY, phone);
}

async function sendAdminAlert(message) {
  try {
    const phone = await getAdminPhone();
    if (!phone) {
      // Not configured yet — this is expected until the client sets it from
      // the dashboard, so this is informational, not an error.
      logger.info(`Admin alert skipped (no admin phone configured yet): ${message.split('\n')[0]}`);
      return;
    }
    await sendTextMessage(phone, message);
    logger.info(`Admin alert sent to ${phone}: ${message.split('\n')[0]}`);
  } catch (err) {
    logger.error('Failed to send admin alert:', err.message);
  }
}

async function notifyHotLead(phone, lead = {}) {
  const lines = [`🔥 New HOT lead: ${phone}`];
  if (lead.name) lines.push(`Name: ${lead.name}`);
  if (lead.operation) lines.push(`Operation: ${lead.operation}`);
  if (lead.zone) lines.push(`Zone: ${lead.zone}`);
  if (lead.budget) lines.push(`Budget: ${lead.budget}`);
  await sendAdminAlert(lines.join('\n'));
}

async function notifyVisitScheduled(phone, details = {}) {
  const lines = [`📅 Visit scheduled: ${phone}`];
  if (details.name) lines.push(`Name: ${details.name}`);
  if (details.visitWhen) lines.push(`Day/time: ${details.visitWhen}`);
  if (details.property) lines.push(`Property: ${details.property}`);
  if (details.link) lines.push(`Link: ${details.link}`);
  if (details.property_id && !details.property) lines.push(`Property: #${details.property_id}`);
  lines.push(`Note: exact address isn't in our system — confirm it directly with the customer.`);
  await sendAdminAlert(lines.join('\n'));
}

module.exports = { getAdminPhone, setAdminPhone, sendAdminAlert, notifyHotLead, notifyVisitScheduled };
