const express = require("express");
const https = require("https");
const fs = require("fs");
const path = require("path");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const passport = require("./config/passportConfig");
const app = express();
const routes = require("./routes/routes");
const internshipRoutes = require("./routes/internshipRoutes");
const chatRoutes = require("./routes/chatRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const { createChatWebSocketServer } = require("./chatSocketServer");
const {uploadDir} = require("./middleware/uploadProfilePhoto");
require("dotenv").config();

// SSL
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, "../server.key")),
  cert: fs.readFileSync(path.join(__dirname, "../server.crt")),
};

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ limit: "20mb", extended: true }));

app.use(cookieParser());
app.use(
  cors({
    origin: process.env.REACT_BASE_URL || "https://localhost:5173",
    credentials: true,
  })
);
app.use("/uploads", express.static("uploads"));
app.use("/uploads/profile_photos", express.static(uploadDir));


// Add this middleware before passport.initialize()
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.use(passport.initialize());
app.use("/api/auth", routes);
app.use("/api/internships", internshipRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payments", paymentRoutes);

const PORT = process.env.PORT || 4000;
const server = https.createServer(sslOptions, app);

app.get("/", (req, res) => {
  res.send("Backend is running!");
});

// Async function to set up the server and WebSocket
const startServer = async () => {
  try {
    await createChatWebSocketServer(server);

    // Start the server
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`WebSocket server available at wss://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
};

// Start the server
startServer();
