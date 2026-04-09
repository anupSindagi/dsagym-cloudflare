# DSAGym

DSAGym is a DSA practice tracker built around LeetCode ratings and NeetCode lists.
You can sign in, set your current rating, filter problems, mark solved questions, and track activity over time.

## Architecture (quick view)

- `src/` is the React frontend (single-page app).
- `worker/index.ts` is the Cloudflare Worker API layer (Hono routes under `/api/*`).
- `worker/auth.ts` uses Better Auth (Google + GitHub OAuth) backed by D1 via Drizzle.
- `worker/user-problems-do.ts` is a Durable Object that stores per-user progress/rating/activity and serves user-specific queries.
- `drizzle/` holds migrations for auth tables + LeetCode/NeetCode data.
- A scheduled Worker job syncs LeetCode rating data from an external dataset into D1.

## Tech stack

- Frontend: React 19, TypeScript, Vite
- API/runtime: Cloudflare Workers, Hono
- Auth: Better Auth (Google/GitHub OAuth)
- Data: Cloudflare D1 (SQLite) + Drizzle ORM/Drizzle Kit
- Stateful user logic: Cloudflare Durable Objects
- UI: Radix UI primitives + Tailwind tooling

## Local setup

1. Install deps:
   `npm install`
2. Create env file:
   `cp .env.example .env`
3. Run dev:
   `npm run dev`

For deployment:

`npm run deploy`
