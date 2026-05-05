import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_s: Math.round(process.uptime()),
  })
);
