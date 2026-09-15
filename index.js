// index.js
require("dotenv").config();
const express = require("express");
const path = require("path");
const { verifyWebhook, handleWebhookPost } = require("./handlers/webhookHandler");
const dashboardRoutes = require("./routes/dashboard");
const logger = require("./utils/logger");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================
// STATIC FILES (Serve dashboard HTML)
// ============================================

app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// ROUTES
// ============================================

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Loop Inmobiliaria AI Agent is running",
    dashboard: "http://localhost:3000/dashboard.html",
    timestamp: new Date().toISOString(),
  });
});

// Dashboard HTML
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// WhatsApp webhook
app.get("/webhook", verifyWebhook);
app.post("/webhook", handleWebhookPost);

// Dashboard API routes
app.use(dashboardRoutes);

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
  logger.info(`📱 Webhook URL: https://your-render-url.onrender.com/webhook`);
  logger.info(`📊 Dashboard URL: https://your-render-url.onrender.com/dashboard`);
  logger.info(`🔧 Environment: ${process.env.NODE_ENV || "development"}`);
});
