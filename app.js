import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();

// ====== CONFIG ======
const AI_ENABLED = true; // 🔒 safety switch
const PORT = process.env.PORT || 8080;

// ====== MIDDLEWARE ======
app.use(cors());
app.use(express.json());

// ====== HEALTH CHECK ======
app.get("/", (req, res) => {
  res.send("WipPro backend running ✅");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ====== OPENAI CLIENT ======
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ====== MAIN GENERATE ROUTE ======
app.post("/generate", async (req, res) => {
  try {
    const { notes, format, tone, customerType } = req.body || {};

    if (!notes || !notes.trim()) {
      return res.status(400).json({
        error: "No workshop notes provided"
      });
    }

    // 🔒 FALLBACK (NO AI)
    if (!AI_ENABLED) {
      return res.json({
        result: `Customer explanation (${format}, ${tone}):\n\n${notes}`
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY on server"
      });
    }

    const systemPrompt = `
You are an aftersales advisor assistant.

Your task is to rewrite workshop or VHC notes into clear, customer-friendly explanations.

Rules:
- Do NOT include names, VRN, VIN, phone numbers, or email addresses
- Do NOT promise timeframes or costs
- Explain what the issue means and why it matters
- Use calm, neutral, professional language
- Adapt wording to the requested format (verbal, email, or SMS)
- Keep explanations accurate and easy to understand
`;

    const userPrompt = `
FORMAT: ${format || "verbal"}
TONE: ${tone || "calm"}
CUSTOMER TYPE: ${customerType || "neutral"}

WORKSHOP NOTES:
${notes}
`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.4
    });

    const aiText =
      completion.choices?.[0]?.message?.content?.trim() ||
      "No response generated.";

    res.json({ result: aiText });

  } catch (err) {
    console.error("Generate error:", err);
    res.status(500).json({
      error: "AI generation failed"
    });
  }
});

// ====== START SERVER ======
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
