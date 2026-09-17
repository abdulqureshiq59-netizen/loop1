// middleware/sessionAuth.js
// Cookie-based login for /dashboard and /pipeline, replacing the browser's
// basic-auth popup with a real login page (public/login.html).
// Sessions are kept in memory — fine for a single Render instance, but
// everyone gets logged out on a restart/redeploy (same limitation the old
// basicAuth had, and the same one conversationState already has).
const crypto = require("crypto");

const sessions = new Set();
const COOKIE_NAME = "loop_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function login(req, res) {
  const { username, password } = req.body || {};
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASS;

  if (!user || !pass) {
    return res.status(500).json({ success: false, error: "DASHBOARD_USER/DASHBOARD_PASS not set on the server" });
  }
  if (username !== user || password !== pass) {
    return res.status(401).json({ success: false, error: "Usuario o contraseña incorrectos" });
  }

  const token = crypto.randomBytes(24).toString("hex");
  sessions.add(token);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`
  );
  res.json({ success: true });
}

function logout(req, res) {
  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME]) sessions.delete(cookies[COOKIE_NAME]);
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ success: true });
}

function requireLogin(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASS;
  if (!user || !pass) return next(); // not configured — fail open, same as before

  const cookies = parseCookies(req);
  if (cookies[COOKIE_NAME] && sessions.has(cookies[COOKIE_NAME])) return next();

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ success: false, error: "No autenticado" });
  }
  return res.redirect("/login.html");
}

module.exports = { login, logout, requireLogin };
