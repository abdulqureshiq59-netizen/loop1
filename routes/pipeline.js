// routes/pipeline.js
const express = require('express');
const router = express.Router();
const leadsDb = require('../services/leadsDb');
const logger = require('../utils/logger');

const STAGES = ["NUEVO", "CALIFICANDO", "CALIENTE", "CONTACTADO", "VISITA", "NEGOCIACION", "CERRADO"];

router.get('/api/pipeline', async (req, res) => {
  try {
    const rawLeads = await leadsDb.getAllLeads();
    const leads = rawLeads.map(l => ({
      ...l,
      stage: STAGES.includes(l.stage) ? l.stage : "NUEVO",
    }));
    res.json({ success: true, stages: STAGES, data: leads });
  } catch (err) {
    logger.error('Error loading pipeline:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/api/pipeline/:phone/stage', async (req, res) => {
  try {
    const { stage } = req.body;
    if (!STAGES.includes(stage)) {
      return res.status(400).json({ success: false, error: `stage must be one of: ${STAGES.join(', ')}` });
    }
    await leadsDb.updateStage(req.params.phone, stage);
    res.json({ success: true });
  } catch (err) {
    logger.error('Error updating lead stage:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
