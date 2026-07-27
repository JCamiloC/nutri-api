import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { router } from "./routes/index.js";

const app = express();

app.use(
  cors({
    origin: env.corsOrigin,
  }),
);
app.use(express.json({ limit: "2mb" }));
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
