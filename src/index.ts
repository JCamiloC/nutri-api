import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { uploadsRoot } from "./lib/uploads.js";
import { router } from "./routes/index.js";
import fs from "node:fs";

const app = express();

fs.mkdirSync(uploadsRoot(), { recursive: true });

/** CORS_ORIGIN puede ser un origen o varios separados por coma. */
const corsOrigins = env.corsOrigin
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Requests sin Origin (curl, health checks, same-origin server tools)
      if (!origin) return callback(null, true);
      if (corsOrigins.includes("*") || corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      console.warn(`[cors] blocked origin: ${origin}`);
      return callback(null, false);
    },
  }),
);
app.use(express.json({ limit: "3mb" }));
app.use("/uploads", express.static(uploadsRoot()));
app.use(router);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(env.port, () => {
  console.log(`[nutri-api] listening on http://0.0.0.0:${env.port}`);
  console.log(`[nutri-api] CORS origins: ${corsOrigins.join(" | ")}`);
  if (!env.databaseUrl) {
    console.warn("[nutri-api] DATABASE_URL vacía — /health reportará degraded");
  }
});
