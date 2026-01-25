const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

// ✅ Allow your Netlify site to call the backend
// Add your Netlify URL here (and keep localhost for testing)
const ALLOWED_ORIGINS = [
  "https://wippro-c8f660.netlify.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow server-to-server or curl requests with no origin
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked: " + origin));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-wippro-site-key"],
  })
);

app.use(express.json({ limit: "1mb" }));

// ---- Basic routes
app.get("/", (req, res) => res.status(200).send("WIPpro backend live ✅"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// ---- Helper: split notes into “items”
function splitIntoItems(notes) {
  return String(notes)
    .split(/\n|•|- /) // new lines, bullets, hyphens
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---- Helper: build a strict prompt with consistent output format
function buildPrompt(items, format, tone, customerType) {
  return `
You are a motor-trade service advisor assistant.

Goal: Turn workshop notes into customer-friendly explanations with a consistent structure.

Rules:
- Write for a non-technical customer (no jargon).
- Motor trade professional tone (not Mercedes specific).
- No scare tactics, no pressure selling.
- Keep it clear and practical.
- If there are multiple items, explain each item separately.

Output MUST follow this exact structure for EACH item:

ITEM: <name in plain English>
What it does: <1 sentence>
Why it needs attention: <1 sentence>
Benefit to the customer: <1 sentence>

No extra headings. No intro paragraph. No numbering. No markdown.

Context settings:
- Preferred format: ${format}
- Tone: ${tone}
- Customer type: ${customerType}

Workshop items:
${items.map((x) => `- ${x}`).join("\n")}
`;
}

// ---- MAIN route used by Netlify
app.post("/generate", async (req, res) => {
  try {
    // ✅ Auth: site key must match
    const siteKey = req.get("x-wippro-site-key");
    const expectedSiteKey = process.env.SITE_KEY;

    if (!expectedSiteKey) {
      return res.status(500).json({ error: "SERVER_MISSING_SITE_KEY (set SITE_KEY in Railway Variables)" });
    }

    if (!siteKey || siteKey !== expectedSiteKey) {
      return res.status(401).json({ error: "Unauthorized (missing or wrong site key)" });
    }

    // ✅ Must have OpenAI key on server
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "SERVER_MISSING_OPENAI_API_KEY (set OPENAI_API_KEY in Railway Variables)" });
    }

    const { notes, format = "email", tone = "calm", customerType = "neutral" } = req.body || {};

    if (!notes || String(notes).trim() === "") {
      return res.status(400).json({ error: "No notes provided" });
    }

    const items = splitIntoItems(notes);

    // ✅ Build strict prompt
    const prompt = buildPrompt(items, format, tone, customerType);

    // ✅ OpenAI client (server-side only)
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // ✅ Use a broadly available model
    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    // ✅ Safely extract text
    const text = response.output_text?.trim();

    if (!text) {
      console.error("OpenAI returned empty output:", JSON.stringify(response, null, 2));
      return res.status(500).json({ error: "AI returned no text" });
    }

    return res.status(200).json({ ok: true, result: text });
  } catch (err) {
    console.error("AI_GENERATION_FAILED:", err);
    return res.status(500).json({ error: "AI_GENERATION_FAILED" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
