// routes/dashboard.js
// Dashboard API endpoints

const express = require('express');
const router = express.Router();
const leadService = require('../services/leadService');
const logger = require('../utils/logger');

// Get all leads
router.get('/api/leads', async (req, res) => {
  try {
    const leads = await leadService.getLeads();
    res.json({ success: true, data: leads });
  } catch (err) {
    logger.error('Error fetching leads:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get lead by phone
router.get('/api/leads/:phone', async (req, res) => {
  try {
    const lead = await leadService.getLeadByPhone(req.params.phone);
    if (lead) {
      res.json({ success: true, data: lead });
    } else {
      res.status(404).json({ success: false, error: 'Lead not found' });
    }
  } catch (err) {
    logger.error('Error fetching lead:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create lead
router.post('/api/leads', async (req, res) => {
  try {
    const newLead = await leadService.createLead(req.body);
    res.json({ success: true, data: newLead });
  } catch (err) {
    logger.error('Error creating lead:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update lead
router.put('/api/leads/:phone', async (req, res) => {
  try {
    const updated = await leadService.updateLead(req.params.phone, req.body);
    res.json({ success: true, data: updated });
  } catch (err) {
    logger.error('Error updating lead:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get dashboard stats
router.get('/api/stats', async (req, res) => {
  try {
    const leads = await leadService.getLeads();
    const stats = {
      total: leads.length,
      hot: leads.filter(l => l.status === 'Caliente').length,
      warm: leads.filter(l => l.status === 'Tibio').length,
      cold: leads.filter(l => l.status === 'Frío').length,
      new: leads.filter(l => l.status === 'Nuevo').length,
    };
    res.json({ success: true, data: stats });
  } catch (err) {
    logger.error('Error fetching stats:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
