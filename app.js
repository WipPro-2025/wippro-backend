const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// =====================
// Config / Env Vars
// =====================
const SITE_KEY = process.env.SITE_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://wip-pro.netlify.app"; // change to your Netlify domain

// IMPORTANT: Only create OpenAI client if key exists
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

// =====================
// Middleware
// =====================
app.use(express.json({ limit: "1mb" }));

app.use(
  cors({
    origin: ALLOWED_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-wippro-site-key"]
  })
);

app.options("*", cors());

// =====================
// Health / Debug routes
// =====================
app.get("/", (req, res) => {
  res.status(200).send("WIPpro backend live ✅");
});

// DO NOT leave this public forever if you don’t want to.
// But for now it’s perfect to prove variables are working.
app.get("/debug", (req, res) => {
  res.json({
    has_OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    has_SITE_KEY: !!process.env.SITE_KEY,
    allowed_origin: ALLOWED_ORIGIN,
    node_env: process.env.NODE_ENV || "unknown"
  });
});

// =====================
// Tiny “Library” (fast answers)
// =====================
// This is your starter glossary. Add to it over time.
// If an item matches here, we’ll use it immediately without AI.
const LIBRARY = [
  {
    keys: ["spring link", "drop link", "anti roll bar link", "arb link"],
    name: "Anti-roll bar link (drop link / spring link)",
    does: "Connects the anti-roll bar to the suspension so the car stays stable and level in corners.",
    whyReplace:
      "When worn it can knock/clunk, reduce stability, and allow excess movement, especially over bumps and when turning.",
    benefit:
      "Quieter ride, better handling, improved stability, and reduces strain on other suspension parts."
  },
  {
    keys: ["coil spring", "road spring", "spring snapped", "broken spring"],
    name: "Road spring (coil spring)",
    does: "Supports the vehicle’s weight and helps keep the tyre in firm contact with the road.",
    whyReplace:
      "A snapped spring can affect steering/handling, cause uneven ride height, damage the tyre, and is an MOT/safety issue.",
    benefit:
      "Restores safe ride height, handling and braking stability; reduces tyre wear and prevents further damage."
  },
  {
    keys: ["nox sensor", "engine light", "eml", "adblue", "scr"],
    name: "NOx sensor (emissions sensor)",
    does: "Measures exhaust emissions so the engine can control fuel/air and the emissions system can work correctly.",
    whyReplace:
      "If faulty it can trigger the engine light, reduce performance, increase fuel use, and can cause emissions/MOT issues.",
    benefit:
      "Fixes warning lights, helps the car run properly, improves fuel/emissions control, and prevents knock-on faults."
  },
  {
    keys: ["battery", "battery replacement", "12v battery"],
    name: "12V Battery",
    does: "Powers starting and all electrics (locks, lights, infotainment, control modules).",
    whyReplace:
      "A weak battery causes non-starts, warning lights, stop/start issues, and random electrical faults.",
    benefit:
      "Reliable starting, fewer electrical glitches, protects sensitive modules, and avoids breakdowns."
  }
];

// Find matching library entry (simple keyword match)
function findLibraryMatch(line) {
  const text = line.toLowerCase();
  for (const item of LIBRARY) {
    if (item.keys.some((k) => text.includes(k))) return item;
  }
  return null;
}

// Split workshop notes into items (each line = item)
// also supports commas/bullets lightly
function splitNotes(notes) {
  return String(notes || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function authOrReject(req, res) {
  const incoming = req.get("x-wippro-site-key");
  if (!SITE_KEY || !incoming || incoming !== SITE_KEY) {
    return res.status(401).json({
      error: "Unauthorized (missing or wrong site key)"
    });
  }
  return null;
}

// =====================
// AI Prompt Builder
// =====================
function buildPrompt({ line, tone, format, customerType, outputType }) {
  // Motor-trade professional language, but non-technical for the customer.
  // “Explain to an idiot” style without being rude.
  return `
You are a UK motor trade service advisor.
Convert the workshop note into a customer-friendly explanation.

WORKSHOP NOTE:
"${line}"

OUTPUT REQUIREMENTS:
- Language: motor trade professional, non-technical customer-friendly
- Tone: ${tone}
- Format: ${format}
- Customer type: ${customerType}
- Output type: ${outputType}

Write:
1) What it is (one simple sentence)
2) What it does (1–2 sentences)
3) What happens if it’s left (1–2 sentences)
4) Benefit of doing it now (1–2 sentences)
5) Confidence note: if the note sounds vague/odd, say "If you’d like, we can confirm with a quick visual check" (do NOT accuse anyone)

Do NOT include any customer personal data.
Keep it concise, clear, and practical.
`.trim();
}

// =====================
// Main generate route
// =====================
app.post("/generate", async (req, res) => {
  // Auth check
  const rejected = authOrReject(req, res);
  if (rejected) return;

  try {
    if (!openai) {
      return res.status(500).json({
        error: "OPENAI_API_KEY missing on server"
      });
    }

    const { notes, tone, format, customerType, outputType } = req.body || {};

    if (!notes || !String(notes).trim()) {
      return res.status(400).json({ error: "No workshop notes provided" });
    }

    const items = splitNotes(notes);

    // Suggestion if multiple items:
    const multiSuggestion =
      items.length > 1
        ? `You’ve got ${items.length} items listed. I’ll explain each one separately so it’s easy to read.`
        : null;

    // Build output sections
    const sections = [];

    if (multiSuggestion) {
      sections.push(`✅ ${multiSuggestion}\n`);
    }

    // Process each item
    for (let i = 0; i < items.length; i++) {
      const line = items[i];

      // 1) Try library first (fast + consistent)
      const match = findLibraryMatch(line);
      if (match) {
        sections.push(
          `# Item ${i + 1}: ${line}\n` +
            `**What it is:** ${match.name}\n` +
            `**What it does:** ${match.does}\n` +
            `**Why it needs replacing:** ${match.whyReplace}\n` +
            `**Benefit to you:** ${match.benefit}\n` +
            `**If unsure:** If you’d like, we can confirm with a quick visual check.\n`
        );
        continue;
      }

      // 2) Use AI for unknown items
      const prompt = buildPrompt({
        line,
        tone: tone || "Calm & professional",
        format: format || "Email",
        customerType: customerType || "Neutral",
        outputType: outputType || "Plain-English explanation"
      });

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: "You write clear, practical customer explanations for car repairs." },
          { role: "user", content: prompt }
        ]
      });

      const text = completion.choices?.[0]?.message?.content?.trim() || "";

      sections.push(`# Item ${i + 1}: ${line}\n${text}\n`);
    }

    // Final combined output
    const finalText = sections.join("\n");

    return res.json({
      ok: true,
      output: finalText
    });
  } catch (err) {
    console.error("GENERATION_ERROR:", err?.message || err);

    return res.status(500).json({
      ok: false,
      error: "AI_GENERATION_FAILED"
    });
  }
});

// =====================
// Start server
// =====================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
