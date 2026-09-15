const express = require('express');
const router = express.Router();
const conversationState = require('../services/conversationState');
const { sendTextMessage } = require('../utils/whatsappAPI');
const logger = require('../utils/logger');

router.get('/api/conversations', (req, res) => {
  res.json({ success: true, data: conversationState.getAll() });
});

router.get('/api/conversations/:phone', (req, res) => {
  res.json({ success: true, data: conversationState.getConversation(req.params.phone) });
});

router.post('/api/conversations/:phone/mode', (req, res) => {
  try {
    conversationState.setMode(req.params.phone, req.body.mode);
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

module.exports = router;
