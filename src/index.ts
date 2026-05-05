import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, isMockMode } from "./config.js";
import { db } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { abandonedCarts } from "./routes/abandoned-carts.js";
import { activity } from "./routes/activity.js";
import { conversations } from "./routes/conversations.js";
import { customers } from "./routes/customers.js";
import { dev } from "./routes/dev.js";
import { health } from "./routes/health.js";
import { insights } from "./routes/insights.js";
import { orders } from "./routes/orders.js";
import { salla } from "./routes/salla.js";
import { tasks } from "./routes/tasks.js";
import { teamChat } from "./routes/team-chat.js";
import { users } from "./routes/users.js";
import { whatsapp } from "./routes/whatsapp.js";
import { workflows } from "./routes/workflows.js";
import { ensureDemoSeed } from "./seed/demo-seed.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowed = [
        config.frontendUrl,
        "http://localhost:3000",
        "https://salla.sa",
      ];
      if (!origin) return allowed[0];
      return allowed.find((o) => origin.startsWith(o)) ?? allowed[0];
    },
    credentials: true,
    allowHeaders: ["Content-Type", "X-Merchant-Id", "X-User-Id"],
  })
);

app.route("/health", health);
app.route("/salla", salla);
app.route("/whatsapp", whatsapp);
app.route("/conversations", conversations);
app.route("/abandoned-carts", abandonedCarts);
app.route("/users", users);
app.route("/orders", orders);
app.route("/customers", customers);
app.route("/tasks", tasks);
app.route("/insights", insights);
app.route("/activity", activity);
app.route("/team", teamChat);
app.route("/workflows", workflows);
app.route("/dev", dev);

app.get("/", (c) =>
  c.json({
    name: "anvira-salla-backend",
    version: "0.1.0",
    mockMode: isMockMode(),
  })
);

async function bootstrap() {
  await runMigrations();
  if (isMockMode() && db) {
    try {
      await ensureDemoSeed();
    } catch (err) {
      console.warn("[seed] failed (non-fatal):", err);
    }
  }
  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(
      `anvira-salla-backend listening on :${info.port} (mockMode=${isMockMode()})`
    );
  });
}

bootstrap().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
