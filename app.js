const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

/**
 * CORS:
 * - Allow Netlify and local testing
 * - Keep it simple: allow any origin for now (security comes from SITE_KEY)
 */
app.use(cors({ origin: true }));
app.use(express.json({ limit: "1mb" }));

// ✅ Root route (so Railway shows something)
app.get("/", (req, res) => {
  res.status(200).send("Wippro backend live 🚀");
});

// ✅ Health check
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

/**
 * ✅ Generate endpoint
 * Requires header: x-wippro-site-key === process.env.SITE_KEY
 * Body: { notes, tone, format, customerType, outputType }
 */
app.post("/generate", (req, res) => {
  const siteKey = req.get("x-wippro-site-key");
  const expected = process.env.SITE_KEY;

  if (!expected) {
    return res.status(500).json({ error: "SERVER_MISSING_SITE_KEY (set SITE_KEY in Railway Variables)" });
  }

  if (!siteKey || siteKey !== expected) {
    return res.status(401).json({ error: "Unauthorized (missing or wrong site key)" });
  }

  const { notes, tone, format, customerType, outputType } = req.body || {};

  if (!notes || String(notes).trim().length === 0) {
    return res.status(400).json({ error: "No notes provided" });
  }

  const cleanNotes = String(notes).trim();

  // Helpers
  const toneMap = {
    calm: "Calm & professional",
    brief: "Brief",
    detailed: "More detailed",
  };

  const customerMap = {
    neutral: "Neutral",
    price_sensitive: "Price-sensitive",
    busy: "Busy",
    anxious: "Anxious",
  };

  const formatMap = {
    email: "Email",
    sms: "SMS (short)",
    verbal: "Verbal talk-track",
  };

  const outputMap = {
    plain_vhc: "Plain-English VHC explanation",
    customer_email: "Customer email / message",
    objection_handling: "Objection handling guidance",
  };

  // Generate a “good enough” output without OpenAI (so it works immediately)
  const header = `WIPpro Output\nTone: ${toneMap[tone] || "Calm & professional"}\nFormat: ${formatMap[format] || "Email"}\nCustomer: ${customerMap[customerType] || "Neutral"}\nType: ${outputMap[outputType] || "Customer email / message"}\n\n`;

  let body = "";

  if (outputType === "plain_vhc") {
    body =
      `Plain-English explanation:\n` +
      `• What we found: ${cleanNotes}\n` +
      `• Why it matters: This can affect safety/reliability and may worsen if left.\n` +
      `• Recommendation: We advise addressing it now to avoid further damage/cost.\n`;
  } else if (outputType === "objection_handling") {
    body =
      `Objection handling guidance:\n` +
      `1) Acknowledge: “I understand you want to keep costs sensible.”\n` +
      `2) Explain risk: “If left, this can lead to further damage and higher cost.”\n` +
      `3) Offer options: “We can prioritise safety items first, and phase the rest.”\n` +
      `4) Confirm: “Would you like me to price both the essential and the recommended?”\n\n` +
      `Based on notes: ${cleanNotes}\n`;
  } else {
    // customer_email default
    const isSMS = format === "sms";
    const isVerbal = format === "verbal";
    const isBrief = tone === "brief";
    const isDetailed = tone === "detailed";

    if (isSMS) {
      body =
        `SMS draft:\n` +
        `Hi, update from Mercedes-Benz. We found: ${cleanNotes}. ` +
        `We recommend repair to avoid worsening/safety issues. Reply YES for a quote.\n`;
    } else if (isVerbal) {
      body =
        `Verbal talk-track:\n` +
        `“Just an update on your vehicle. We’ve found: ${cleanNotes}. ` +
        `The reason we recommend addressing it is to prevent further wear and keep things safe. ` +
        `Would you like me to run through the options and costs?”\n`;
    } else {
      // Email
      body =
        `Customer email/message:\n` +
        `Hello,\n\n` +
        `We’ve completed the workshop checks and found the following:\n` +
        `• ${cleanNotes}\n\n` +
        (isBrief
          ? `We recommend addressing this now to avoid further issues.`
          : isDetailed
          ? `This is important because leaving it can cause additional wear, reduced performance, or safety concerns. Addressing it now can help prevent further damage and potentially higher costs later.`
          : `We recommend addressing this now to prevent it worsening and to maintain safety/reliability.`) +
        `\n\n` +
        `If you’d like us to proceed, please confirm and we’ll arrange the next steps.\n\n` +
        `Kind regards,\n` +
        `Mercedes-Benz Service Team\n`;
    }
  }

  // Adjust for customer type (simple tuning)
  if (customerType === "price_sensitive") {
    body += `\n(Price-sensitive tip: Offer a “safety first” option + a full recommended option.)\n`;
  }
  if (customerType === "busy") {
    body += `\n(Busy tip: Ask for a quick YES/NO decision and offer a single recommended option.)\n`;
  }
  if (customerType === "anxious") {
    body += `\n(Anxious tip: Reassure, explain clearly, and confirm the vehicle is safe/unsafe to drive if relevant.)\n`;
  }

  return res.status(200).json({
    ok: true,
    result: header + body,
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
