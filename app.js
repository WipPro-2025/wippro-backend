// ===============================
// WIPPRO BACKEND - app.js
// ===============================

const express = require("express");
const cors = require("cors");

const app = express();

// ===============================
// CONFIG
// ===============================
const PORT = process.env.PORT || 3000;

// Site keys allowed (must match frontend)
const VALID_SITE_KEYS = ["wippro123"];

// ===============================
// MIDDLEWARE
// ===============================
app.use(cors({
  origin: [
    "https://wip-pro.netlify.app",
    "http://localhost:3000"
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-wippro-site-key"]
}));

app.options("*", cors());
app.use(express.json());

// ===============================
// HEALTH CHECK
// ===============================
app.get("/", (req, res) => {
  res.json({ status: "WIPPRO backend running" });
});

// ===============================
// AUTH MIDDLEWARE
// ===============================
function checkSiteKey(req, res, next) {
  const siteKey = req.headers["x-wippro-site-key"];

  if (!siteKey || !VALID_SITE_KEYS.includes(siteKey)) {
    return res.status(401).json({
      error: "Unauthorized: invalid or missing site key"
    });
  }

  next();
}

// ===============================
// GENERATE ENDPOINT
// ===============================
app.post("/generate", checkSiteKey, async (req, res) => {
  try {
    const {
      site_id,
      notes,
      mode,
      tone,
      channel,
      customer_type
    } = req.body;

    if (!notes) {
      return res.status(400).json({
        error: "Notes are required"
      });
    }

    // 🔧 TEMP RESPONSE (proves backend works)
    const result = `
Summary (${mode}):
The inspection identified an issue with the braking system.
This may affect vehicle safety and should be addressed promptly.
`;

    res.json({ result });

  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Internal server error"
    });
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`WIPPRO backend listening on port ${PORT}`);
});
