# Anvira — Backend

Hono + TypeScript backend for **Anvira**, a unified operations platform for
Salla merchants. Handles Salla OAuth, webhook ingestion, WhatsApp Cloud API,
and the AI layer. Designed to deploy on Railway with Postgres.

**Pairs with**: [`anvira-salla-frontend`](https://github.com/medcharaf111/anvira-salla-frontend) (Next.js on Vercel).

## Stack

- Hono (web framework, fast + tiny)
- TypeScript (strict)
- Drizzle ORM + Postgres
- Zod (validation)
- Designed for Node 20+

## Quick start

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL, SALLA_*, WHATSAPP_*, OPENAI_API_KEY
npm run db:generate    # generate migrations from schema
npm run db:migrate     # apply migrations to DB
npm run dev            # http://localhost:8080
```

Health check:

```bash
curl http://localhost:8080/health
# { "status": "ok", "timestamp": "...", "uptime_s": 0 }
```

## Routes

| Method + Path | Purpose | Status |
|---|---|---|
| `GET /` | Service banner | ✓ |
| `GET /health` | Healthcheck (Railway probes here) | ✓ |
| `GET /salla/install` | Build Salla OAuth install URL | ✓ stub |
| `POST /salla/oauth/exchange` | Exchange OAuth code for access token | ⚠️ stub |
| `POST /salla/webhook` | Receive Salla merchant events | ⚠️ stub |
| `GET /whatsapp/webhook` | Meta verification handshake | ✓ |
| `POST /whatsapp/webhook` | Inbound WhatsApp messages | ⚠️ stub |
| `POST /whatsapp/send` | Outbound WhatsApp dispatch | ⚠️ stub |

## Database schema (v1, lean)

`src/db/schema.ts` defines the Drizzle schema. Tables:

- `merchants` — Salla store + token storage
- `users` — agents inside a merchant (with `whatsapp_display_name` for per-user identity)
- `conversations` — WhatsApp threads, with assignment + status
- `messages` — inbound/outbound messages, with AI generation flag
- `salla_orders` — mirrored Salla orders for context
- `abandoned_carts` — cart events for recovery flow

Excluded from v1: tasks, team_chats, workflows, app_center.

## Deployment (Railway)

1. Create a new Railway project, connect this GitHub repo.
2. Add a **Postgres** plugin — Railway auto-injects `DATABASE_URL`.
3. Set the rest of the env vars from `.env.example` in the Railway dashboard.
4. Deploy. The `railway.json` configures the start command + healthcheck.

## Architecture

```
[anvira-salla-frontend (Vercel)]
          ↓ REST
[anvira-salla-backend (Railway, Hono)]   ← this repo
          ↓
    ┌─────┴─────┐
[Salla API]   [WhatsApp Cloud API]   [OpenAI / Anthropic]   [Postgres]
```

## Roadmap

**v1 (90 days):** Salla OAuth + sync + abandoned cart recovery + WhatsApp shared
inbox + Khaleeji AI smart replies + basic RBAC.

**v2/v3 (deferred):** Visual workflow builder, App Center, Team Chats, Tasks,
sentiment analysis, performance scoring.
