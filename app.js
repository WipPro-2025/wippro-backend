/**
 * app.js — Railway backend (Node/Express) for WipPro
 * Supports formats: Email, SMS/Text (corporate), Verbal talk-track
 *
 * Railway ENV VARS (set these in Railway > Variables):
 * - OPENAI_API_KEY   = your OpenAI key
 * - SITE_KEY         = shared secret your frontend sends in header "x-wippro-site-key"
 * - ALLOWED_ORIGIN   = your Netlify URL, e.g. https://wip-pro.netlify.app
 * - PORT             = (Railway sets this automatically)
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

// Only create OpenAI client if key exists
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

// Optional — remove later if you don’t want it public
app.get("/debug", (req, res) => {
  res.json({
    has_OPENAI_API_KEY: !!OPENAI_API_KEY,
    has_SITE_KEY: !!SITE_KEY,
    allowed_origin: ALLOWED_ORIGIN,
    node_env: process.env.NODE_ENV || "unknown",
  });
});

// =========================
// Auth check (site key)
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
// Tiny "Library" (fast answers)
// Add to it over time
// =========================
const LIBRARY = [
  {
    keys: ["spring link", "drop link", "anti roll bar link", "arb link"],
    name: "Anti-roll bar link (drop link)",
    does: "Connects the anti-roll bar to the suspension so the car stays stable and level in corners.",
    whyReplace:
      "When worn it can knock/clunk, reduce stability, and allow excess movement over bumps and when turning.",
    benefit:
      "Quieter ride, better handling, improved stability, and reduced strain on other suspension parts.",
  },
  {
    keys: ["coil spring", "road spring", "spring snapped", "broken spring"],
    name: "Road spring (coil spring)",
    does: "Supports the vehicle’s weight and helps keep the tyre in firm contact with the road.",
    whyReplace:
      "A snapped spring can affect steering/handling, cause uneven ride height, damage the tyre, and is a safety/MOT issue.",
    benefit:
      "Restores safe ride height, handling and braking stability, reduces tyre wear and prevents further damage.",
  },
  {
    keys: ["nox sensor", "engine light", "emi", "adblue", "scr"],
    name: "NOx sensor (emissions sensor)",
    does: "Measures exhaust emissions so the engine and emissions system can work correctly.",
    whyReplace:
      "If faulty it can trigger the engine light, reduce performance, increase fuel use, and cause emissions/MOT issues.",
    benefit:
      "Fixes warning lights, helps the car run properly, improves emissions control, and prevents knock-on faults.",
  },
  {
    keys: ["battery", "battery replacement", "12v battery", "aux battery"],
    name: "12V battery",
    does: "Powers starting and all electrics (locks, lights, infotainment, control modules).",
    whyReplace:
      "A weak battery can cause non-starts, warning lights, stop/start issues, and random electrical faults.",
    benefit:
      "Reliable starting, fewer electrical glitches, protects sensitive modules, and avoids breakdowns.",
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
// PROMPT BUILDER (Email / SMS / Verbal)
// =========================
function buildPrompt({ line, tone, format, customerType, outputType }) {
  const fmt = String(format || "Email").toLowerCase();

  // Treat "sms", "text", "whatsapp" as the same format family
  const isText = fmt.includes("sms") || fmt.includes("text") || fmt.includes("whatsapp");
  const isVerbal = fmt.includes("verbal");

  let formatRules = "";

  if (isText) {
    formatRules = `
FORMAT RULES (SMS / TEXT - CORPORATE):
- Write a short corporate SMS/WhatsApp-style message
- Max 450 characters
- No greeting (no "Hi John") and no sign-off (no "Best regards")
- No placeholders (no "[Your Name]" / "[Your Position]")
- No numbering (no 1) 2) 3))
- 2–4 short, factual sentences
- Informational only: do NOT mention cost, time, or ask for approval/authorisation
`.trim();
  } else if (isVerbal) {
    formatRules = `
FORMAT RULES (VERBAL TALK-TRACK):
- Write a short script the advisor can say out loud
- Use 4 short chunks with headings:
  What we found:
  What it means:
  Risk if left:
  Recommended action:
- Calm, factual, customer-friendly (no jargon)
- Do NOT mention cost, time, or ask for approval/authorisation
`.trim();
  } else {
    formatRules = `
FORMAT RULES (EMAIL):
- Write a concise, professional customer email
- No fake signature placeholders
- Use this structure:
  1) What it is (1 sentence)
  2) What it does (1–2 sentences)
  3) What happens if left (1–2 sentences)
  4) Recommended action (1–2 sentences)
- Do NOT mention cost, time, or ask for approval/authorisation
`.trim();
  }

  return `
You are a UK motor trade service advisor.
Convert the workshop note into a customer-friendly explanation.

WORKSHOP NOTE:
"${line}"

OUTPUT SETTINGS:
- Tone: ${tone}
- Customer type: ${customerType}
- Output type: ${outputType}
- Format: ${format}

${formatRules}

UNIVERSAL RULES:
- Never blame or accuse anyone
- Do NOT include customer personal data (name/VRN/VIN/phone/email)
- Keep it concise, clear, and practical
- If the note is vague/uncertain, you MAY add:
  "If you'd like, we can confirm this with a quick visual check."
`.trim();
}

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

    const sections = [];

    for (let i = 0; i < items.length; i++) {
      const line = items[i];

      // 1) Library first (fast + consistent)
      const match = findLibraryMatch(line);
      if (match) {
        // Output also respects the chosen format (keep it simple and neutral)
        const fmt = String(format || "Email").toLowerCase();
        const isText = fmt.includes("sms") || fmt.includes("text") || fmt.includes("whatsapp");
        const isVerbal = fmt.includes("verbal");

        if (isText) {
          sections.push(
            `${match.name}: ${match.does} If left, it may worsen and lead to further issues. Recommended: inspection/rectification as advised by the workshop.`
          );
        } else if (isVerbal) {
          sections.push(
            `What we found: ${match.name}.\n` +
              `What it means: ${match.does}\n` +
              `Risk if left: ${match.whyReplace}\n` +
              `Recommended action: ${match.benefit}`
          );
        } else {
          sections.push(
            `# Item ${i + 1}: ${line}\n` +
              `**What it is:** ${match.name}\n` +
              `**What it does:** ${match.does}\n` +
              `**What happens if left:** ${match.whyReplace}\n` +
              `**Recommended action:** ${match.benefit}\n`
          );
        }

        continue;
      }

      // 2) AI for unknown items
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
          {
            role: "system",
            content:
              "You are a UK motor trade service advisor. Follow the user's FORMAT RULES exactly. Keep responses informational and neutral. Do not include personal data. Do not add signatures or placeholders unless explicitly asked.",
          },
          { role: "user", content: prompt },
        ],
      });

      const text = completion.choices?.[0]?.message?.content?.trim() || "";

      // For Email, keep item headers; for SMS/Verbal, just concatenate nicely
      const fmt = String(format || "Email").toLowerCase();
      const isText = fmt.includes("sms") || fmt.includes("text") || fmt.includes("whatsapp");
      const isVerbal = fmt.includes("verbal");

      if (isText) {
        sections.push(text.replace(/\n+/g, " ").trim());
      } else if (isVerbal) {
        sections.push(text.trim());
      } else {
        sections.push(`# Item ${i + 1}: ${line}\n${text}\n`);
      }
    }

    const finalText = sections.join(items.length > 1 ? "\n\n" : "\n");

    return res.json({
      ok: true,
      output: finalText,
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
