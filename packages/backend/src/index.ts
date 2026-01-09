import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { testRouter } from "./routes/test.js";
import { wsHandler } from "./websocket/handler.js";
import { initializeQueue } from "./queue/queue.js";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/test", testRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// WebSocket connection handler
wss.on("connection", wsHandler);

// Initialize queue
await initializeQueue();

server.listen(PORT, () => {
  console.log(`🚀 QualityPilot Backend running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
});
