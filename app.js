const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// ✅ NEW: Root route so Railway domain shows something (stops the Not Found page)
app.get("/", (req, res) => {
  res.status(200).send("Wippro backend live 🚀");
});

// (Optional) simple health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on port ${PORT}`);
});
