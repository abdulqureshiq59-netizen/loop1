const express = require('express');
const router = express.Router();
const conversationState = require('../services/conversationState');
const messagesDb = require('../services/messagesDb');
const leadsDb = require('../services/leadsDb');
const { sendTextMessage } = require('../utils/whatsappAPI');
const adminNotify = require('../services/adminNotify');
const { getLanguage, setLanguage, clearConversationHistory } = require('../handlers/aiReply');
const aiConfig = require('../services/aiConfig');
const { getAllProperties, getAllProjects } = require('../services/propertyLookup');
const logger = require('../utils/logger');

// Conversation list now comes from the database (messages table), not
// server memory — this is what survives a restart/redeploy. Enriched
// (2026-09-30) with each lead's name / temperature / mode so the sidebar
// can show "Khan" instead of a bare phone number, a hot/warm/cold dot, and
// which chats a human agent currently controls.
router.get('/api/conversations', async (req, res) => {
  try {
    const [list, leads] = await Promise.all([
      messagesDb.getConversationsSummary(),
      leadsDb.getAllLeads(),
    ]);
    const byPhone = {};
    leads.forEach(l => { byPhone[l.phone] = l; });
    const data = list.map(c => {
      const l = byPhone[c.phone] || {};
      return {
        ...c,
        name: l.name || '',
        temperature: l.temperature || '',
        stage: l.stage || 'NUEVO',
        mode: l.mode || 'ai',
        agent_name: l.agent_name || '',
        channel: l.channel || 'WhatsApp',
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    logger.error('Error loading conversations:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/api/conversations/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const [messages, lead, total, mode] = await Promise.all([
      messagesDb.getMessages(phone),
      leadsDb.getLeadByPhone(phone),
      messagesDb.countMessages(phone),
      // Read from the DB (same source the webhook trusts), not only the
      // in-memory cache, so the AI/Human buttons can't show a stale state.
      leadsDb.getMode(phone),
    ]);
    res.json({ success: true, data: { messages, lead, mode, total } });
  } catch (err) {
    logger.error('Error loading conversation:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin "delete chat" (client request 2026-09-30): wipes the transcript,
// the lead/pipeline row, and everything the process remembers about this
// number (AI context, cached property, once-per-chat flags). Irreversible —
// the dashboard asks for confirmation before calling this.
router.delete('/api/conversations/:phone', async (req, res) => {
  try {
    const phone = req.params.phone;
    const [deletedMessages] = await Promise.all([
      messagesDb.deleteConversation(phone),
      leadsDb.deleteLead(phone),
    ]);
    conversationState.clearConversation(phone);
    clearConversationHistory(phone);
    logger.info(`ADMIN deleted conversation ${phone} (${deletedMessages} messages + lead row)`);
    res.json({ success: true, deletedMessages });
  } catch (err) {
    logger.error('Error deleting conversation:', err.message);
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
      conversationState.setHotAlerted(req.params.phone, false);
      conversationState.resetPropertyAlerts(req.params.phone);
      logger.info(`${req.params.phone} handed back to AI — reset properties-suggested/visit-scheduled/hot-alerted flags for a fresh inquiry`);
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

// Bot reply language toggle (client's request, 2026-09-20) — used to only be
// switchable via the BOT_LANGUAGE env var, which needed a redeploy. Now
// editable live from the dashboard, persisted in app_settings so it
// survives a restart (see handlers/aiReply.js).
router.get('/api/settings/bot-language', async (req, res) => {
  try {
    res.json({ success: true, language: getLanguage() });
  } catch (err) {
    logger.error('Error loading bot language setting:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/settings/bot-language', async (req, res) => {
  try {
    await setLanguage(req.body.language);
    res.json({ success: true, language: getLanguage() });
  } catch (err) {
    logger.error('Error saving bot language setting:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ---- "Entrenar IA" page (client request 2026-10-01) ----

// Knowledge entries the client adds for the bot to use.
router.get('/api/training', async (req, res) => {
  try {
    res.json({ success: true, entries: await aiConfig.getTraining() });
  } catch (err) {
    logger.error('Error loading training:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/training', async (req, res) => {
  try {
    const entries = await aiConfig.setTraining(req.body.entries || []);
    logger.info(`Training updated from the dashboard (${entries.length} entries)`);
    res.json({ success: true, entries });
  } catch (err) {
    logger.error('Error saving training:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// Responsible agents found in the live property catalog + the WhatsApp
// number used for their alerts (saved one > code > NAI's own).
router.get('/api/agents', async (req, res) => {
  try {
    const [properties, projects, saved] = await Promise.all([
      getAllProperties().catch(() => []),
      getAllProjects().catch(() => []),
      aiConfig.getSavedAgentPhones(),
    ]);
    const byName = {};
    [...properties, ...projects].forEach(p => {
      const name = String(p.agent_name || '').trim();
      if (!name) return;
      if (!byName[name]) byName[name] = { name, properties: 0, naiPhone: '' };
      byName[name].properties += 1;
      if (!byName[name].naiPhone && p.agent_phone) byName[name].naiPhone = aiConfig.normalizePhone(p.agent_phone);
    });
    Object.keys(saved).forEach(n => { if (!byName[n]) byName[n] = { name: n, properties: 0, naiPhone: '' }; });
    const agents = await Promise.all(Object.values(byName).map(async a => ({
      ...a,
      phone: saved[a.name] || '',
      effectivePhone: await aiConfig.getAgentPhone(a.name, a.naiPhone),
    })));
    agents.sort((x, y) => x.name.localeCompare(y.name));
    res.json({ success: true, agents });
  } catch (err) {
    logger.error('Error loading agents:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/agents', async (req, res) => {
  try {
    const map = {};
    (req.body.agents || []).forEach(a => { if (a && a.name) map[a.name] = a.phone || ''; });
    const saved = await aiConfig.setSavedAgentPhones(map);
    logger.info(`Agent numbers updated from the dashboard (${Object.keys(saved).length} saved)`);
    res.json({ success: true, saved });
  } catch (err) {
    logger.error('Error saving agents:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
