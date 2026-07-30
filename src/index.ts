import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { uploadsRoot } from "./lib/uploads.js";
import { router } from "./routes/index.js";
import fs from "node:fs";

const app = express();

fs.mkdirSync(uploadsRoot(), { recursive: true });

app.use(
  cors({
    origin: env.corsOrigin,
  }),
);
app.use(express.json({ limit: "3mb" }));
app.use("/uploads", express.static(uploadsRoot()));
app.use(router);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.listen(env.port, () => {
  console.log(`[nutri-api] listening on http://localhost:${env.port}`);
  console.log(`[nutri-api] CORS origin: ${env.corsOrigin}`);
  if (!env.databaseUrl) {
    console.warn("[nutri-api] DATABASE_URL vacía — /health reportará degraded");
  }
});
