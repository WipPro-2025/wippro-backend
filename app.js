const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
  origin: ["https://wippro-c8f660.netlify.app"],
  methods: ["POST", "GET"],
  allowedHeaders: ["Content-Type", "x-wippro-site-key"]
}));

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("WIPpro backend live ✅");
});

// --- helper: split workshop notes into items ---
function splitItems(notes) {
  return String(notes)
    .split(/\n|•|- /)
    .map(s => s.trim())
    .filter(Boolean);
}

// --- helper: safely extract AI text ---
function extractText(response) {
  try {
    if (response.output_text) return response.output_text.trim();

    const blocks = response.output?.[0]?.content || [];
    const textBlock = blocks.find(b => b.type === "output_text" || b.text);
    if (textBlock?.text) return textBlock.text.trim();

    return null;
  } catch {
    return null;
  }
}

app.post("/generate", async (req, res) => {
  try {
    // --- auth ---
    const siteKey = req.get("x-wippro-site-key");
    if (!siteKey || siteKey !== process.env.SITE_KEY) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY missing" });
    }

    const { notes, tone, format, customerType } = req.body || {};
    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: "No workshop notes" });
    }

    const items = splitItems(notes);

    const prompt = `
You are a professional motor trade service advisor.

Explain each workshop item to a non-technical customer.

STRICT RULES:
- Motor trade professional language
- Plain English
- No jargon
- No scare tactics
- Explain WHAT the part does and WHY replacing it benefits the customer
- If multiple items exist, explain EACH separately
- Use the EXACT structure below for every item

FORMAT (repeat for each item):

ITEM: <name>
What it does:
Why it needs attention:
Benefit to the customer:

Workshop items:
${items.map(i => `- ${i}`).join("\n")}
`;

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt
    });

    const text = extractText(response);

    if (!text) {
      console.error("RAW OPENAI RESPONSE:", JSON.stringify(response, null, 2));
      return res.status(500).json({ error: "AI returned no readable text" });
    }

    res.json({ ok: true, result: text });

  } catch (err) {
    console.error("AI_GENERATION_FAILED:", err);
    res.status(500).json({ error: "AI_GENERATION_FAILED" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
