import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());

// ========== CONFIG (ENV VARS ON RAILWAY) ==========
// OPENAI_API_KEY = your OpenAI key
// GROUP_KEYS = comma list: GROUPNAME=secret
//   example: LSH_AUTO=groupsecret123,OTHERGROUP=groupsecret456
// SITE_KEYS = comma list: SITEID=secret
//   example: WHITEFIELD=sitekey111,STOCKPORT=sitekey222
// SITE_TO_GROUP = comma list: SITEID=GROUPNAME
//   example: WHITEFIELD=LSH_AUTO,STOCKPORT=LSH_AUTO
// ALLOWED_ORIGINS = optional, comma list of allowed front-end URLs
//   example: https://wippro-demo.netlify.app,https://wippro2.netlify.app
// SITE_NAME = optional: WIPpro Demo (Whitefield)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SITE_NAME = process.env.SITE_NAME || "WIPpro Demo";

const GROUP_KEYS = (process.env.GROUP_KEYS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const SITE_KEYS = (process.env.SITE_KEYS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const SITE_TO_GROUP = (process.env.SITE_TO_GROUP || "")
  .split(",").map(s => s.trim()).filter(Boolean);

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

// ========== CORS (ALLOWLIST IF SET, OTHERWISE OPEN FOR PILOT) ==========
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (ALLOWED_ORIGINS.length > 0) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Vary", "Origin");
  } else {
    // pilot only
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-wippro-site-key, x-wippro-group-key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ========== RATE LIMIT (COST PROTECTION) ==========
const hits = new Map(); // ip -> {count, resetAt}
function rateLimit(req, res, next) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const now = Date.now();
  const windowMs = 60_000; // 1 minute
  const max = 40;          // 40 requests/minute/IP (adjust later)

  const entry = hits.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  hits.set(ip, entry);

  if (entry.count > max) return res.status(429).json({ error: "Rate limit exceeded" });
  next();
}
app.use(rateLimit);

// ========== AUTH (GROUP + SITE KEYS) ==========
function parsePairs(pairs) {
  // pairs like ["NAME=secret", "NAME2=secret2"]
  const out = new Map();
  for (const p of pairs) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

const groupKeyMap = parsePairs(GROUP_KEYS);
const siteKeyMap = parsePairs(SITE_KEYS);
const siteToGroupMap = parsePairs(SITE_TO_GROUP);

// Request must include EITHER:
// - x-wippro-site-key (recommended) OR
// - x-wippro-group-key + site_id (so group key can cover multiple sites)
function authorize(req) {
  const siteKey = req.headers["x-wippro-site-key"];
  const groupKey = req.headers["x-wippro-group-key"];

  const site_id = (req.body?.site_id || "").toString().trim(); // passed from frontend
  // If site key is present, validate it and derive site
  if (siteKey) {
    for (const [site, key] of siteKeyMap.entries()) {
      if (key === siteKey) return { ok: true, site_id: site, group_id: siteToGroupMap.get(site) || "UNKNOWN" };
    }
    return { ok: false };
  }

  // If group key present, validate group and require site_id
  if (groupKey) {
    let group_id = null;
    for (const [g, key] of groupKeyMap.entries()) {
      if (key === groupKey) group_id = g;
    }
    if (!group_id) return { ok: false };
    if (!site_id) return { ok: false };

    const mappedGroup = siteToGroupMap.get(site_id);
    if (mappedGroup && mappedGroup !== group_id) return { ok: false };

    return { ok: true, site_id, group_id };
  }

  return { ok: false };
}

// ========== USAGE LOGGING (COUNTS ONLY) ==========
function logUsage({ group_id, site_id, mode }) {
  const ts = new Date().toISOString();
  console.log(`[USAGE] app="WIPpro" group="${group_id}" site="${site_id}" mode="${mode}" at=${ts}`);
}

// ========== PROMPT RULES (ADVISOR NOT TECHNICAL) ==========
function buildSystem({ mode, tone, channel, customer_type }) {
  const toneLine =
    tone === "brief" ? "Keep it concise." :
    tone === "detailed" ? "Be more detailed but still clear and professional." :
    "Use calm, professional main-dealer language that builds trust.";

  const channelLine =
    channel === "sms" ? "Format as SMS under 320 characters." :
    channel === "verbal" ? "Format as a natural verbal talk-track under 60 seconds spoken." :
    "Format as a customer email message.";

  const customerLine =
    customer_type === "price_sensitive" ? "Customer is price-sensitive: emphasise value, choice, and prioritisation." :
    customer_type === "busy" ? "Customer is busy: keep it short, clear, action-led." :
    customer_type === "anxious" ? "Customer is anxious: reassure, explain calmly, avoid alarming language." :
    "Customer type is neutral.";

  const advisorContext = `
Assume the service advisor is not technically trained.
Avoid workshop jargon, abbreviations, or engineering language.
Use everyday, plain-English explanations that an advisor can confidently repeat to a customer.
If a technical term must be used, explain it in simple words.
Focus on clarity and confidence.
`.trim();

  if (mode === "plain_vhc") {
    return `
You are a Mercedes-Benz Aftersales Advisor.

${advisorContext}

Create a Plain-English Vehicle Health Explanation suitable for a customer.

Rules:
- Plain English, no jargon
- Use bullet points and short sections
- Split into: Safety-Critical vs Preventative/Monitor
- Explain what each item is, why it matters, and what happens if left
- Give a simple priority order (1, 2, 3)
- Avoid scare tactics
${toneLine}
${channelLine}
${customerLine}
`.trim();
  }

  if (mode === "objection_handling") {
    return `
You are a Mercedes-Benz Aftersales Advisor coaching another advisor.

${advisorContext}

Output must include:
1) A one-sentence summary of the recommendation
2) 6 common objections
3) For each objection: a calm response + a soft next-step question
4) A 20-second verbal close that is not pushy
No scare tactics. No absolutes. Keep it main-dealer professional.
${toneLine}
${customerLine}
`.trim();
  }

  // customer_email
  return `
You are a Mercedes-Benz Aftersales Advisor writing to a customer.

${advisorContext}

Task: Turn the workshop/VHC notes into a clear customer message.

Rules:
- Split into Safety-Critical vs Preventative/Monitor
- Explain why each item is recommended in plain English
- Offer prioritisation options
- End with a polite next step (confirm pricing/availability or ask how they'd like to proceed)
No pressure. No scare tactics.
${toneLine}
${channelLine}
${customerLine}
`.trim();
}

app.post("/generate", async (req, res) => {
  try {
    const auth = authorize(req);
    if (!auth.ok) return res.status(401).json({ error: "Unauthorized" });

    const { notes, mode, tone, channel, customer_type } = req.body || {};
    if (!notes || typeof notes !== "string") return res.status(400).json({ error: "Missing notes" });

    logUsage({ group_id: auth.group_id, site_id: auth.site_id, mode: mode || "unknown" });

    const system = buildSystem({ mode, tone, channel, customer_type });
    const user = `Workshop / VHC notes:\n${notes}`;

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.3
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data?.error?.message || "AI request failed" });

    const text =
      data?.output?.[0]?.content?.find?.(c => c.type === "output_text")?.text
      || data?.output_text
      || "";

    return res.json({ result: text });
  } catch (e) {
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => console.log(`${SITE_NAME} backend running on port 3000`));
