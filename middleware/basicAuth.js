// middleware/basicAuth.js
// Simple HTTP Basic Auth gate for the dashboard/pipeline pages and their APIs.
// Set DASHBOARD_USER and DASHBOARD_PASS in .env / Render env vars.
// If either is unset, this middleware does nothing (fails open) — set both
// before handing the Render URL to the client.

function basicAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASS;

  if (!user || !pass) {
    return next(); // not configured — don't lock everyone out silently
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const sepIndex = decoded.indexOf(":");
    const reqUser = decoded.slice(0, sepIndex);
    const reqPass = decoded.slice(sepIndex + 1);
    if (reqUser === user && reqPass === pass) return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Loop Inmobiliaria"');
  return res.status(401).send("Authentication required");
}

module.exports = basicAuth;