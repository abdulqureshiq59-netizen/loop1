const express = require('express');
const router = express.Router();
const conversationState = require('../services/conversationState');
const messagesDb = require('../services/messagesDb');
const leadsDb = require('../services/leadsDb');
const { sendTextMessage } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

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

module.exports = router;
