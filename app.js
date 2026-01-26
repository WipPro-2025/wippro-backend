/**
 * app.js — Railway backend (Node/Express)
 *
 * Endpoints:
 * - POST /generate   -> takes workshop notes / part names and returns simple explanations
 * - GET  /           -> health check
 * - GET  /debug      -> shows whether env vars are present (safe: does NOT print secrets)
 *
 * Railway Environment Variables (set in Railway → Variables):
 * - OPENAI_API_KEY      = your OpenAI key
 * - SITE_KEY            = your shared secret (must match frontend header x-wippro-site-key)
 * - ALLOWED_ORIGIN      = your Netlify URL e.g. https://wip-pro.netlify.app
 * - PORT                = Railway sets automatically (don’t manually set unless needed)
 */

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// =========================
// Config / Env Vars
// =========================
const SITE_KEY = process.env.SITE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://wip-pro.netlify.app";

// Create OpenAI client only if key exists
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// =========================
// Middleware
// =========================
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-wippro-site-key"],
  })
);

app.options("*", cors());

// =========================
// Health / Debug
// =========================
app.get("/", (req, res) => {
  res.status(200).send("WipPro backend live ✅");
});

// Optional debug endpoint (remove later if you want)
app.get("/debug", (req, res) => {
  res.json({
    has_OPENAI_API_KEY: !!OPENAI_API_KEY,
    has_SITE_KEY: !!SITE_KEY,
    allowed_origin: ALLOWED_ORIGIN,
    node_env: process.env.NODE_ENV || "unknown",
  });
});

// =========================
// Security: header auth
// =========================
function authOrReject(req, res) {
  const incoming = req.get("x-wippro-site-key");
  if (!SITE_KEY || !incoming || incoming !== SITE_KEY) {
    res.status(401).json({ error: "Unauthorized (missing or wrong site key)" });
    return true;
  }
  return false;
}

// =========================
// Helpers
// =========================
function splitNotes(notes) {
  return String(notes || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

// =========================
// Tiny library (fast + consistent)
// Add to this over time
// =========================
const LIBRARY = [
  {
    keys: ["spring link", "drop link", "anti roll bar link", "arb link"],
    name: "Anti-roll bar link (drop link)",
    does: "It links the anti-roll bar to the suspension to help keep the car stable in corners.",
    ifLeft:
      "If it wears out you may hear knocking over bumps and the car can feel less steady when turning.",
    benefit:
      "Replacing it stops the knocking, improves stability, and reduces extra strain on other suspension parts.",
  },
  {
    keys: ["coil spring", "road spring", "spring snapped", "broken spring"],
    name: "Road spring (coil spring)",
    does: "It supports the car’s weight and helps keep the tyres firmly on the road.",
    ifLeft:
      "A broken spring can affect ride height and handling, may damage the tyre, and can be an MOT safety issue.",
    benefit:
      "Replacing it restores safe ride height and handling, and helps prevent further damage.",
  },
  {
    keys: ["nox sensor", "engine light", "emi", "adblue", "scr"],
    name: "NOx sensor (emissions sensor)",
    does: "It measures exhaust emissions so the engine and emissions system can work properly.",
    ifLeft:
      "If it fails it can bring on warning lights, reduce performance, increase fuel use, and cause emissions issues.",
    benefit:
      "Replacing it helps clear warnings, improves emissions control, and prevents knock-on faults.",
  },
  {
    keys: ["battery", "battery replacement", "12v battery", "aux battery"],
    name: "12V battery",
    does: "It powers starting and the car’s electrical systems (locks, lights, infotainment, control modules).",
    ifLeft:
      "A weak battery can cause non-starts, stop/start problems, warning lights, and random electrical glitches.",
    benefit:
      "A new battery gives reliable starting and helps prevent electrical faults and breakdowns.",
  },
];

function findLibraryMatch(line) {
  const text = String(line || "").toLowerCase();
  for (const item of LIBRARY) {
    if (item.keys.some((k) => text.includes(String(k).toLowerCase()))) return item;
  }
  return null;
}

// =========================
// Prompt Builder (user content)
// =========================
function buildPrompt({ line, tone, format, customerType, outputType }) {
  return `
Explain the following in simple customer-friendly terms.

INPUT:
"${line}"

OUTPUT REQUIREMENTS:
- Tone: ${tone}
- Format: ${format}
- Customer type: ${customerType}
- Output type: ${outputType}

Write:
1) What it is (1 simple sentence)
2) What it does (1–2 sentences)
3) What happens if it fails or wears out (1–2 sentences)
4) Benefit of fixing or replacing it (1–2 sentences)

Do NOT include any customer personal data.
Do NOT suggest uncertainty, inspection, confirmation checks, or "visual checks".
Keep it concise, clear, and practical.
`.trim();
}

// =========================
// System prompt (NEW RULE CHANGE APPLIED)
// =========================
const SYSTEM_PROMPT = `
You are a UK motor trade service advisor.

Your job is to explain vehicle parts and workshop notes in clear, calm, customer-friendly language.
Assume the customer has no technical knowledge.

Rules:
- Always explain parts in simple, everyday terms
- Use professional but plain language (no heavy jargon)
- Never blame or accuse anyone
- Do not suggest uncertainty, inspection, or confirmation checks
- Do not include customer personal data
- Keep explanations concise, clear, and practical

Structure every response as:
1) What it is (1 simple sentence)
2) What it does (1–2 sentences)
3) What happens if it fails or wears out (1–2 sentences)
4) Benefit of fixing or replacing it (1–2 sentences)
`.trim();

// =========================
// Main generate route
// =========================
app.post("/generate", async (req, res) => {
  if (authOrReject(req, res)) return;

  try {
    if (!openai) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing on server" });
    }

    const { notes, tone, format, customerType, outputType } = req.body || {};

    if (!notes || !String(notes).trim()) {
      return res.status(400).json({ error: "No workshop notes provided" });
    }

    const items = splitNotes(notes);

    // Intro line if multiple items
    const sections = [];
    if (items.length > 1) {
      sections.push(
        `✅ You’ve got ${items.length} items listed. I’ll explain each one separately so it’s easy to read.\n`
      );
    }

    for (let i = 0; i < items.length; i++) {
      const line = items[i];

      // 1) Library first
      const match = findLibraryMatch(line);
      if (match) {
        sections.push(
          `# Item ${i + 1}: ${line}\n` +
            `**What it is:** ${match.name}\n` +
            `**What it does:** ${match.does}\n` +
            `**What happens if it fails or wears out:** ${match.ifLeft}\n` +
            `**Benefit of fixing or replacing it:** ${match.benefit}\n`
        );
        continue;
      }

      // 2) AI for everything else (part names / notes)
      const prompt = buildPrompt({
        line,
        tone: tone || "Calm & professional",
        format: format || "Email",
        customerType: customerType || "Neutral",
        outputType: outputType || "Plain-English explanation",
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
      });

      const text = completion.choices?.[0]?.message?.content?.trim() || "";
      sections.push(`# Item ${i + 1}: ${line}\n${text}\n`);
    }

    return res.json({
      ok: true,
      output: sections.join("\n"),
    });
  } catch (err) {
    console.error("GENERATION_ERROR:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: "AI_GENERATION_FAILED",
    });
  }
});

// =========================
// Start server
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
