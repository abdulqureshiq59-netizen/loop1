const express = require('express');
const router = express.Router();
const conversationState = require('../services/conversationState');
const messagesDb = require('../services/messagesDb');
const leadsDb = require('../services/leadsDb');
const { sendTextMessage } = require('../utils/whatsappAPI');
const { getAllProperties, getAllProjects } = require('../services/propertyLookup');
const adminNotify = require('../services/adminNotify');
const logger = require('../utils/logger');

// TEMPORARY (2026-09-19): one-off check the client asked for — how many
// properties/projects in the live NAI catalog actually have no listed
// price, to decide whether a "customer asked about an unpriced property"
// admin alert is worth building. Safe to delete this route once answered;
// it doesn't change any data, just counts and samples.
router.get('/api/debug/price-check', async (req, res) => {
  try {
    const [properties, projects] = await Promise.all([getAllProperties(), getAllProjects()]);
    const all = [...properties, ...projects];
    const missing = all.filter(p => !p.price_display);
    res.json({
      success: true,
      total: all.length,
      with_price: all.length - missing.length,
      without_price: missing.length,
      examples_without_price: missing.slice(0, 10).map(p => ({ id: p.prop_id, title: p.title, zone: p.zone, operation: p.operation, link: p.link })),
    });
  } catch (err) {
    logger.error('Error in price-check debug route:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Conversation list now comes from the database (messages table), not
// server memory — this is what survives a restart/redeploy.
router.get('/api/conversations', async (req, res) => {
  try {
    const list = await messagesDb.getConversationsSummary();
    res.json({ success: true, data: list });
  } catch (err) {
    logger.error('Error loading conversations:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/conversations/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const [messages, lead] = await Promise.all([
      messagesDb.getMessages(phone),
      leadsDb.getLeadByPhone(phone),
    ]);
    // mode stays in-memory (hydrated from DB at boot, kept live during the
    // process) — property is also in-memory only (a short-lived cache of
    // "which property is this conversation currently about", not something
    // that needs its own DB table).
    const mode = conversationState.getMode(phone);
    res.json({ success: true, data: { messages, lead, mode } });
  } catch (err) {
    logger.error('Error loading conversation:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/conversations/:phone/mode', async (req, res) => {
  try {
    conversationState.setMode(req.params.phone, req.body.mode);

    // An agent clicking "Take Control" is itself a real pipeline event —
    // move the lead to CONTACTADO (if it isn't already further along) so
    // the pipeline board reflects it without the agent also having to
    // remember to drag the card there manually.
    if (req.body.mode === 'human') {
      await leadsDb.bumpStageTo(req.params.phone, 'CONTACTADO').catch(err => {
        logger.error(`Failed to auto-advance stage to CONTACTADO for ${req.params.phone}:`, err.message);
      });
    }

    // Handing a conversation back to the AI (human -> ai) is treated as the
    // start of a fresh inquiry cycle for THIS phone number — e.g. an agent
    // wrapped up one deal and the same customer is now asking about
    // something else. Without this, propertiesSuggested/visitScheduled
    // (both "only ever fire once per conversation" flags) would stay stuck
    // true forever from the first deal and silently block a genuinely new
    // property suggestion or visit alert for the second one (bug found
    // 2026-09-19: a same-number second inquiry got no property suggestion
    // at all because the flag was already set from an earlier inquiry).
    if (req.body.mode === 'ai') {
      conversationState.setPropertiesSuggested(req.params.phone, false);
      conversationState.setVisitScheduled(req.params.phone, false);
      logger.info(`${req.params.phone} handed back to AI — reset properties-suggested/visit-scheduled flags for a fresh inquiry`);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/api/conversations/:phone/reply', async (req, res) => {
  try {
    await sendTextMessage(req.params.phone, req.body.text);
    conversationState.addMessage(req.params.phone, "agent", req.body.text);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error sending agent reply:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/stats', async (req, res) => {
  try {
    const [conversations, leads] = await Promise.all([
      messagesDb.getConversationsSummary(),
      leadsDb.getAllLeads(),
    ]);
    res.json({
      success: true,
      data: {
        total: conversations.length,
        hot: leads.filter(l => l.temperature === 'Caliente').length,
        new: leads.filter(l => l.stage === 'NUEVO').length,
      },
    });
  } catch (err) {
    logger.error('Error loading stats:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin's own WhatsApp number for HOT-lead / visit-scheduled alerts —
// editable from the dashboard (client's request, 2026-09-19) instead of
// being hardcoded in .env, so it can be changed without a redeploy.
router.get('/api/settings/admin-phone', async (req, res) => {
  try {
    const phone = await adminNotify.getAdminPhone();
    res.json({ success: true, phone });
  } catch (err) {
    logger.error('Error loading admin phone setting:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/settings/admin-phone', async (req, res) => {
  try {
    await adminNotify.setAdminPhone((req.body.phone || '').trim());
    res.json({ success: true });
  } catch (err) {
    logger.error('Error saving admin phone setting:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
