import { Hono } from "hono";
import { auth } from "./auth";
export { UserProblemsDO } from "./user-problems-do";

const LEETCODE_DATA_URL =
  "https://zerotrac.github.io/leetcode_problem_rating/data.json";

// D1 allows max 100 bound parameters per query; 9 columns × 11 rows = 99
const BATCH_ROWS = 11;

interface LeetcodeRow {
  Rating: number;
  ID: number;
  Title: string;
  TitleZH?: string;
  TitleSlug: string;
  ContestSlug?: string;
  ProblemIndex?: string;
  ContestID_en?: string;
  ContestID_zh?: string;
}

interface Env {
  DB: D1Database;
  USER_PROBLEMS: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const parseOptionalFiniteNumber = (value: string | undefined): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.get("/api/hello", (c) => c.text("Hello World!"));

app.get("/api/leetcode/problems", async (c) => {
  const tab = c.req.query("tab") === "fundamentals" ? "fundamentals" : "contest";
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = Math.min(parsePositiveInt(c.req.query("pageSize"), 20), 100);
  const maxRating = c.req.query("maxRating");
  const sortBy = c.req.query("sortBy");
  const sortDir = c.req.query("sortDir");

  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    if (tab !== "contest") {
      return c.json({
        tab,
        page,
        pageSize,
        total: 0,
        solved: 0,
        rows: [],
      });
    }

    const maxRatingNumber = parseOptionalFiniteNumber(maxRating);
    const whereClauses: string[] = ["rating IS NOT NULL"];
    const whereBinds: unknown[] = [];
    if (maxRatingNumber != null) {
      whereClauses.push("CAST(ROUND(rating) AS INTEGER) <= ?");
      whereBinds.push(maxRatingNumber);
    }
    const whereSql = `WHERE ${whereClauses.join(" AND ")}`;

    const totalRow = await c.env.DB
      .prepare(`SELECT COUNT(*) as total FROM leetcode ${whereSql}`)
      .bind(...whereBinds)
      .first<{ total: number }>();
    const total = Number(totalRow?.total ?? 0);
    const offset = (page - 1) * pageSize;

    const sortColumn =
      sortBy === "problem" ? "id" : sortBy === "solved" ? "id" : "CAST(ROUND(rating) AS INTEGER)";
    const direction = sortDir === "desc" ? "DESC" : "ASC";
    const orderSql = `${sortColumn} ${direction}, id ${direction}`;

    const rowsResult = await c.env.DB
      .prepare(
        `SELECT id, title, title_slug, CAST(ROUND(rating) AS INTEGER) as rating, 0 as solved
         FROM leetcode
         ${whereSql}
         ORDER BY ${orderSql}
         LIMIT ? OFFSET ?`,
      )
      .bind(...whereBinds, pageSize, offset)
      .all<{ id: number; title: string; title_slug: string; rating: number; solved: number }>();

    return c.json({
      tab: "contest",
      page,
      pageSize,
      total,
      solved: 0,
      rows: rowsResult.results ?? [],
    });
  }

  const email = session.user.email.trim().toLowerCase();
  const id = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(id);
  const doPath =
    tab === "fundamentals" ? "/problems/fundamentals" : "/problems/contest";
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (maxRating) {
    query.set("maxRating", maxRating);
  }
  if (sortBy) {
    query.set("sortBy", sortBy);
  }
  if (sortDir) {
    query.set("sortDir", sortDir);
  }
  const doRes = await stub.fetch(`https://user-problems.internal${doPath}?${query.toString()}`);
  if (!doRes.ok) {
    return c.json({ error: "Failed to fetch problems" }, 500);
  }
  return new Response(doRes.body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

app.get("/api/leetcode/rating", async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const email = session.user.email.trim().toLowerCase();
  const id = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(id);
  const doRes = await stub.fetch("https://user-problems.internal/settings/rating");
  if (!doRes.ok) {
    return c.json({ error: "Failed to fetch rating" }, 500);
  }
  return new Response(doRes.body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

app.post("/api/leetcode/rating", async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const rating = (body as { rating?: unknown })?.rating;
  if (typeof rating !== "number" || !Number.isFinite(rating)) {
    return c.json({ error: "rating must be a finite number" }, 400);
  }

  const email = session.user.email.trim().toLowerCase();
  const id = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(id);
  const doRes = await stub.fetch("https://user-problems.internal/settings/rating", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ rating }),
  });
  if (!doRes.ok) {
    return c.json({ error: "Failed to save rating" }, 500);
  }
  return new Response(doRes.body, {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});

app.post("/api/leetcode/contest/solved", async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const id = (body as { id?: unknown })?.id;
  const delta = (body as { delta?: unknown })?.delta;
  if (!Number.isInteger(id) || (delta !== 1 && delta !== -1)) {
    return c.json({ error: "id must be integer and delta must be 1 or -1" }, 400);
  }

  const email = session.user.email.trim().toLowerCase();
  const doId = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(doId);
  const doRes = await stub.fetch("https://user-problems.internal/problems/contest/solved", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, delta }),
  });

  const payload = await doRes.json<unknown>();
  return c.json(payload as object, doRes.status as 200 | 400 | 401 | 404 | 500);
});

app.post("/api/leetcode/contest/solved/set", async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const id = (body as { id?: unknown })?.id;
  const solved = (body as { solved?: unknown })?.solved;
  if (!Number.isInteger(id) || (solved !== 0 && solved !== 1)) {
    return c.json({ error: "id must be integer and solved must be 0 or 1" }, 400);
  }

  const email = session.user.email.trim().toLowerCase();
  const doId = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(doId);
  const doRes = await stub.fetch("https://user-problems.internal/problems/contest/solved/set", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ id, solved }),
  });

  const payload = await doRes.json<unknown>();
  return c.json(payload as object, doRes.status as 200 | 400 | 401 | 404 | 500);
});

app.get("/api/leetcode/contest/histogram", async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    const rowsResult = await c.env.DB
      .prepare(
        `SELECT CAST(ROUND(rating) AS INTEGER) as rating
         FROM leetcode
         WHERE rating IS NOT NULL
           AND CAST(ROUND(rating) AS INTEGER) BETWEEN 1001 AND 4000`,
      )
      .all<{ rating: number }>();

    const buckets = Array.from({ length: 30 }, (_, index) => ({
      start: 1001 + index * 100,
      end: 1100 + index * 100,
      total: 0,
      solved: 0,
    }));
    for (const row of rowsResult.results ?? []) {
      const rating = Number(row.rating);
      if (!Number.isFinite(rating) || rating < 1001 || rating > 4000) continue;
      const bucketIndex = Math.floor((rating - 1001) / 100);
      if (bucketIndex >= 0 && bucketIndex < buckets.length) {
        buckets[bucketIndex].total += 1;
      }
    }
    return c.json({ buckets }, 200);
  }

  const email = session.user.email.trim().toLowerCase();
  const doId = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(doId);
  const doRes = await stub.fetch("https://user-problems.internal/problems/contest/histogram");
  if (!doRes.ok) {
    return c.json({ error: "Failed to fetch histogram" }, 500);
  }

  const payload = await doRes.json<unknown>();
  return c.json(payload as object, 200);
});

app.get("/api/leetcode/activity", async (c) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
    asResponse: false,
  });
  if (!session?.user?.email) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const days = c.req.query("days") ?? "180";
  const endDate = c.req.query("endDate");
  const email = session.user.email.trim().toLowerCase();
  const doId = c.env.USER_PROBLEMS.idFromName(email);
  const stub = c.env.USER_PROBLEMS.get(doId);
  const query = new URLSearchParams({ days });
  if (endDate) {
    query.set("endDate", endDate);
  }
  const doRes = await stub.fetch(`https://user-problems.internal/activity?${query.toString()}`);
  if (!doRes.ok) {
    return c.json({ error: "Failed to fetch activity" }, 500);
  }

  const payload = await doRes.json<unknown>();
  return c.json(payload as object, 200);
});

async function syncLeetcodeData(db: D1Database): Promise<void> {
  const res = await fetch(LEETCODE_DATA_URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const data = (await res.json()) as LeetcodeRow[];
  const rowPlaceholder = "(?, ?, ?, ?, ?, ?, ?, ?, ?)";
  for (let i = 0; i < data.length; i += BATCH_ROWS) {
    const chunk = data.slice(i, i + BATCH_ROWS);
    const placeholders = Array(chunk.length).fill(rowPlaceholder).join(", ");
    const sql = `INSERT INTO leetcode (id, rating, title, title_zh, title_slug, contest_slug, problem_index, contest_id_en, contest_id_zh)
VALUES ${placeholders}
ON CONFLICT(id) DO UPDATE SET
  rating = excluded.rating,
  title = excluded.title,
  title_zh = excluded.title_zh,
  title_slug = excluded.title_slug,
  contest_slug = excluded.contest_slug,
  problem_index = excluded.problem_index,
  contest_id_en = excluded.contest_id_en,
  contest_id_zh = excluded.contest_id_zh`;
    const params = chunk.flatMap((r) => [
      r.ID,
      r.Rating,
      r.Title,
      r.TitleZH ?? null,
      r.TitleSlug,
      r.ContestSlug ?? null,
      r.ProblemIndex ?? null,
      r.ContestID_en ?? null,
      r.ContestID_zh ?? null,
    ]);
    await db.prepare(sql).bind(...params).run();
  }
}

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await syncLeetcodeData(env.DB);
  },
};
