// routes/pipeline.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const logger = require('../utils/logger');

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

const STAGES = ["NUEVO", "CALIFICANDO", "CALIENTE", "CONTACTADO", "VISITA", "NEGOCIACION", "CERRADO"];

router.get('/api/pipeline', async (req, res) => {
  try {
    const r = await axios.get(`${APPS_SCRIPT_URL}?action=getLeads`);
    const body = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (!body.success) return res.status(500).json({ success: false, error: body.error });

    // Normalize stage to one of the known columns so a typo'd or blank
    // sheet value doesn't just vanish off the board
    const leads = body.data.map(l => ({
      ...l,
      stage: STAGES.includes(l.stage) ? l.stage : "NUEVO",
    }));

    res.json({ success: true, stages: STAGES, data: leads });
  } catch (err) {
    logger.error('Error loading pipeline:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/pipeline/:phone/stage', async (req, res) => {
  try {
    const { stage } = req.body;
    if (!STAGES.includes(stage)) {
      return res.status(400).json({ success: false, error: `stage must be one of: ${STAGES.join(', ')}` });
    }
    const r = await axios.post(`${APPS_SCRIPT_URL}?action=updateStage`, { phone: req.params.phone, stage });
    const body = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    res.json(body);
  } catch (err) {
    logger.error('Error updating lead stage:', err.response?.data || err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
