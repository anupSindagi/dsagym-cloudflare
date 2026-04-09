Code is pretty much AI slop, but it works well. I use this website personally every day to practice LeetCode. 

The best thing about this is that it is on Cloudflare Workers, and each user has their own Durable Object. So it means, i dont have to worry about scaling, it scales for millions of users out of the box.  

The overall stack is,
Frontend - React, vite etc on CF worker
Backend main app - Hono on CF worker, with D1 as the main db for auth with better-auth  and leetcode problems list
Backend for users' data -  it is a durable object per user 

Below is AI slop readme, 

# DSAGym

DSAGym is a DSA practice tracker built around LeetCode ratings and NeetCode lists (not yet implemented).
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
