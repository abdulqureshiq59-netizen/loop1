// index.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { verifyWebhook, handleWebhookPost } = require("./handlers/webhookHandler");
const dashboardRoutes = require("./routes/dashboard");
const pipelineRoutes = require("./routes/pipeline");
const basicAuth = require("./middleware/basicAuth");
const logger = require("./utils/logger");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================
// UNPROTECTED ROUTES (Meta needs these open)
// ============================================

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Loop Inmobiliaria AI Agent is running",
    dashboard: "http://localhost:3000/dashboard",
    pipeline: "http://localhost:3000/pipeline",
    timestamp: new Date().toISOString(),
  });
});

// WhatsApp webhook (Meta calls this directly — must stay open, no basic auth)
app.get("/webhook", verifyWebhook);
app.post("/webhook", handleWebhookPost);

// ============================================
// EVERYTHING BELOW THIS LINE REQUIRES LOGIN
// (set DASHBOARD_USER / DASHBOARD_PASS in .env — see middleware/basicAuth.js)
// ============================================

app.use(basicAuth);

app.use(express.static(path.join(__dirname, 'public')));

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get("/pipeline", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pipeline.html'));
});

app.use(dashboardRoutes);
app.use(pipelineRoutes);

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, req, res, next) => {
  logger.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  logger.info(`✅ Server running on port ${PORT}`);
logger.info(`📱 Webhook URL: https://loop1-qao5.onrender.com/webhook`);
  logger.info(`📊 Dashboard URL: https://your-render-url.onrender.com/dashboard`);
  logger.info(`📋 Pipeline URL: https://your-render-url.onrender.com/pipeline`);
  logger.info(`🔧 Environment: ${process.env.NODE_ENV || "development"}`);
  if (!process.env.DASHBOARD_USER || !process.env.DASHBOARD_PASS) {
    logger.warn("⚠️  DASHBOARD_USER/DASHBOARD_PASS not set — dashboard & pipeline are UNPROTECTED");
  }
});
