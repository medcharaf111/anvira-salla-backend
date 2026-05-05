import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { runMigrations } from "./db/migrate.js";
import { health } from "./routes/health.js";
import { salla } from "./routes/salla.js";
import { whatsapp } from "./routes/whatsapp.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = [
        process.env.FRONTEND_URL ?? "http://localhost:3000",
        "https://salla.sa",
      ];
      if (!origin) return allowed[0];
      return allowed.find((o) => origin.startsWith(o)) ?? allowed[0];
    },
    credentials: true,
  })
);

app.route("/health", health);
app.route("/salla", salla);
app.route("/whatsapp", whatsapp);

app.get("/", (c) => c.json({ name: "anvira-salla-backend", version: "0.1.0" }));

const port = Number(process.env.PORT ?? 8080);

async function bootstrap() {
  await runMigrations();
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`anvira-salla-backend listening on :${info.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
