import { env } from "cloudflare:workers";

interface DurableObjectEnv {
  DB: D1Database;
}

interface LeetcodeRow {
  id: number;
  rating: number;
  title: string;
  title_zh: string | null;
  title_slug: string;
  contest_slug: string | null;
  problem_index: string | null;
  contest_id_en: string | null;
  contest_id_zh: string | null;
}

interface NeetcodeRow {
  id: number;
  leetcode_question_link: string;
  neetcode_question_link: string;
  difficulty: string;
  tag: string;
  blind_75: number;
  neetcode_150: number;
  neetcode_250: number;
}

interface ContestProblemRow {
  id: number;
  title: string;
  title_slug: string;
  rating: number;
  solved: number;
}

interface FundamentalsProblemRow {
  id: number;
  leetcode_question_link: string;
  neetcode_question_link: string;
  difficulty: string;
  tag: string;
  solved: number;
}

interface ContestHistogramRow {
  start: number;
  end: number;
  total: number;
  solved: number;
}

const LEETCODE_BATCH_SIZE = 200;
const NEETCODE_BATCH_SIZE = 200;

export class UserProblemsDO {
  private readonly sql: SqlStorage;
  private readonly env: DurableObjectEnv;
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState, env: DurableObjectEnv) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/settings/rating") {
      return this.getRating();
    }

    if (request.method === "GET" && url.pathname === "/problems/contest") {
      return this.listContestProblems(url);
    }

    if (request.method === "GET" && url.pathname === "/problems/contest/histogram") {
      return this.getContestHistogram();
    }

    if (request.method === "GET" && url.pathname === "/activity") {
      return this.getActivity(url);
    }

    if (request.method === "GET" && url.pathname === "/problems/fundamentals") {
      return this.listFundamentalsProblems(url);
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (url.pathname === "/init") {
      await this.state.blockConcurrencyWhile(async () => {
        this.ensureTables();
        const existingRating = await this.state.storage.get<number>("lc_rating");
        if (typeof existingRating !== "number") {
          await this.state.storage.put("lc_rating", 0);
        }
        await this.syncLeetcodeFromMainTable();
        await this.syncNeetcodeFromMainTable();
      });
      return Response.json({ ok: true });
    }

    if (url.pathname === "/sync-leetcode") {
      await this.state.blockConcurrencyWhile(async () => {
        this.ensureTables();
        const neetcodeCount = this.sql
          .exec<{ total: number }>("SELECT COUNT(*) AS total FROM neetcode")
          .one().total;
        if (neetcodeCount === 0) {
          await this.syncNeetcodeFromMainTable();
        }
        await this.syncLeetcodeFromMainTable();
      });
      return Response.json({ ok: true });
    }

    if (url.pathname === "/problems/contest/solved") {
      return this.updateContestSolved(request);
    }

    if (url.pathname === "/problems/contest/solved/set") {
      return this.setContestSolved(request);
    }

    if (url.pathname === "/settings/rating") {
      return this.setRating(request);
    }

    return new Response("Not Found", { status: 404 });
  }

  private async getRating(): Promise<Response> {
    const rating = await this.state.storage.get<number>("lc_rating");
    return Response.json({
      rating: typeof rating === "number" ? rating : null,
    });
  }

  private async setRating(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const value = (body as { rating?: unknown })?.rating;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return Response.json({ error: "rating must be a finite number" }, { status: 400 });
    }

    await this.state.storage.put("lc_rating", value);
    return Response.json({ ok: true, rating: value });
  }

  private async updateContestSolved(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const id = (body as { id?: unknown })?.id;
    const delta = (body as { delta?: unknown })?.delta;
    if (!Number.isInteger(id) || (delta !== 1 && delta !== -1)) {
      return Response.json({ error: "id must be integer and delta must be 1 or -1" }, { status: 400 });
    }

    this.ensureTables();
    const result = this.sql
      .exec<{ solved: number }>(
        `UPDATE leetcode
         SET solved = CASE
           WHEN solved + ? < 0 THEN 0
           ELSE solved + ?
         END
         WHERE id = ?
         RETURNING solved`,
        delta,
        delta,
        id,
      )
      .toArray();

    if (result.length === 0) {
      return Response.json({ error: "Problem not found" }, { status: 404 });
    }

    if (delta === 1) {
      const utcDate = new Date().toISOString().slice(0, 10);
      this.sql.exec(
        `INSERT INTO activity (utc_date, count)
         VALUES (?, 1)
         ON CONFLICT(utc_date) DO UPDATE SET
           count = count + 1`,
        utcDate,
      );
    }

    return Response.json({
      ok: true,
      id,
      solved: result[0].solved,
    });
  }

  private async setContestSolved(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const id = (body as { id?: unknown })?.id;
    const solved = (body as { solved?: unknown })?.solved;
    if (!Number.isInteger(id) || (solved !== 0 && solved !== 1)) {
      return Response.json({ error: "id must be integer and solved must be 0 or 1" }, { status: 400 });
    }

    this.ensureTables();

    const existing = this.sql
      .exec<{ solved: number }>("SELECT solved FROM leetcode WHERE id = ?", id)
      .toArray();
    if (existing.length === 0) {
      return Response.json({ error: "Problem not found" }, { status: 404 });
    }

    this.sql.exec(
      `UPDATE leetcode
       SET solved = ?
       WHERE id = ?`,
      solved,
      id,
    );

    if (existing[0].solved <= 0 && solved === 1) {
      const utcDate = new Date().toISOString().slice(0, 10);
      this.sql.exec(
        `INSERT INTO activity (utc_date, count)
         VALUES (?, 1)
         ON CONFLICT(utc_date) DO UPDATE SET
           count = count + 1`,
        utcDate,
      );
    }

    return Response.json({
      ok: true,
      id,
      solved,
    });
  }

  private listContestProblems(url: URL): Response {
    this.ensureTables();
    const { page, pageSize, offset } = this.getPaging(url);
    const maxRatingRaw = url.searchParams.get("maxRating");
    const maxRating =
      maxRatingRaw != null && Number.isFinite(Number(maxRatingRaw))
        ? Number(maxRatingRaw)
        : null;
    const hasRatingFilter = maxRating != null;
    const sortByParam = url.searchParams.get("sortBy");
    const sortDirParam = url.searchParams.get("sortDir");
    const sortBy =
      sortByParam === "problem" || sortByParam === "rating" || sortByParam === "solved"
        ? sortByParam
        : "rating";
    const sortDir = sortDirParam === "desc" ? "desc" : "asc";
    const orderClause =
      sortBy === "problem"
        ? sortDir === "asc"
          ? "id ASC, title ASC"
          : "id DESC, title DESC"
        : sortBy === "solved"
          ? sortDir === "asc"
            ? "solved ASC, rating ASC, id ASC"
            : "solved DESC, rating DESC, id DESC"
          : sortDir === "asc"
            ? "rating ASC, id ASC"
            : "rating DESC, id DESC";

    const total = hasRatingFilter
      ? this.sql
          .exec<{ total: number }>(
            `SELECT COUNT(*) AS total
             FROM (
               SELECT CAST(ROUND(rating) AS INTEGER) AS rating_int
               FROM leetcode
             )
             WHERE rating_int >= 0 AND rating_int <= ?`,
            maxRating,
          )
          .one().total
      : this.sql.exec<{ total: number }>("SELECT COUNT(*) AS total FROM leetcode").one()
          .total;
    const solved = hasRatingFilter
      ? this.sql
          .exec<{ solved: number }>(
            `SELECT COUNT(*) AS solved
             FROM (
               SELECT CAST(ROUND(rating) AS INTEGER) AS rating_int, solved
               FROM leetcode
             )
             WHERE solved > 0 AND rating_int >= 0 AND rating_int <= ?`,
            maxRating,
          )
          .one().solved
      : this.sql
          .exec<{ solved: number }>(
            "SELECT COUNT(*) AS solved FROM leetcode WHERE solved > 0",
          )
          .one().solved;

    const rows = this.sql
      .exec(
        hasRatingFilter
          ? `SELECT id, title, title_slug, rating, solved
             FROM (
               SELECT
                 id,
                 title,
                 title_slug,
                 CAST(ROUND(rating) AS INTEGER) AS rating,
                 solved
               FROM leetcode
             )
             WHERE rating >= 0 AND rating <= ?
             ORDER BY rating DESC, id DESC
             LIMIT ? OFFSET ?`
          : `SELECT id, title, title_slug, rating, solved
             FROM (
               SELECT
                 id,
                 title,
                 title_slug,
                 CAST(ROUND(rating) AS INTEGER) AS rating,
                 solved
               FROM leetcode
             )
             ORDER BY ${orderClause}
             LIMIT ? OFFSET ?`,
        ...(hasRatingFilter ? [maxRating, pageSize, offset] : [pageSize, offset]),
      )
      .toArray() as unknown as ContestProblemRow[];

    return Response.json({
      tab: "contest",
      page,
      pageSize,
      total,
      solved,
      rows,
    });
  }

  private listFundamentalsProblems(url: URL): Response {
    this.ensureTables();
    const { page, pageSize, offset } = this.getPaging(url);
    const total = this.sql
      .exec<{ total: number }>(
        "SELECT COUNT(*) AS total FROM neetcode WHERE neetcode_150 = 1",
      )
      .one().total;
    const solved = this.sql
      .exec<{ solved: number }>(
        "SELECT COUNT(*) AS solved FROM neetcode WHERE neetcode_150 = 1 AND solved = 1",
      )
      .one().solved;

    const rows = this.sql
      .exec(
        `SELECT id, leetcode_question_link, neetcode_question_link, difficulty, tag, solved
         FROM neetcode
         WHERE neetcode_150 = 1
         ORDER BY id
         LIMIT ? OFFSET ?`,
        pageSize,
        offset,
      )
      .toArray() as unknown as FundamentalsProblemRow[];

    return Response.json({
      tab: "fundamentals",
      page,
      pageSize,
      total,
      solved,
      rows,
    });
  }

  private getContestHistogram(): Response {
    this.ensureTables();
    const data = this.sql
      .exec<{
        bucket: number;
        total: number;
        solved: number;
      }>(
        `SELECT
           CAST((rating_int - 1001) / 100 AS INTEGER) AS bucket,
           COUNT(*) AS total,
           SUM(CASE WHEN solved > 0 THEN 1 ELSE 0 END) AS solved
         FROM (
           SELECT CAST(ROUND(rating) AS INTEGER) AS rating_int, solved
           FROM leetcode
         )
         WHERE rating_int >= 1001 AND rating_int <= 4000
         GROUP BY bucket
         ORDER BY bucket ASC`,
      )
      .toArray();

    const byBucket = new Map<number, { total: number; solved: number }>();
    for (const row of data) {
      byBucket.set(row.bucket, { total: row.total, solved: row.solved ?? 0 });
    }

    const buckets: ContestHistogramRow[] = [];
    for (let bucket = 0; bucket < 30; bucket += 1) {
      const start = 1001 + bucket * 100;
      const end = start + 99;
      const existing = byBucket.get(bucket);
      buckets.push({
        start,
        end,
        total: existing?.total ?? 0,
        solved: existing?.solved ?? 0,
      });
    }

    return Response.json({ buckets });
  }

  private getActivity(url: URL): Response {
    this.ensureTables();
    const daysRaw = Number(url.searchParams.get("days") ?? "180");
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 366) : 180;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const endDateParam = url.searchParams.get("endDate");
    const end = this.parseUtcDate(endDateParam) ?? new Date(today);
    if (end > today) {
      end.setTime(today.getTime());
    }
    end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);

    const activity = this.sql
      .exec<{ utc_date: string; count: number }>(
        `SELECT utc_date, count
         FROM activity
         WHERE utc_date >= ? AND utc_date <= ?
         ORDER BY utc_date ASC`,
        startDate,
        endDate,
      )
      .toArray();

    return Response.json({
      days,
      startDate,
      endDate,
      activity,
    });
  }

  private parseUtcDate(input: string | null): Date | null {
    if (!input) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
    const parsed = new Date(`${input}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private getPaging(url: URL): { page: number; pageSize: number; offset: number } {
    const pageRaw = Number(url.searchParams.get("page") ?? "1");
    const sizeRaw = Number(url.searchParams.get("pageSize") ?? "20");
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const pageSize =
      Number.isFinite(sizeRaw) && sizeRaw > 0
        ? Math.min(Math.floor(sizeRaw), 100)
        : 20;
    return { page, pageSize, offset: (page - 1) * pageSize };
  }

  private ensureTables(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS leetcode (
        id INTEGER PRIMARY KEY NOT NULL,
        rating REAL NOT NULL,
        title TEXT NOT NULL,
        title_zh TEXT,
        title_slug TEXT NOT NULL,
        contest_slug TEXT,
        problem_index TEXT,
        contest_id_en TEXT,
        contest_id_zh TEXT,
        solved INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS neetcode (
        id INTEGER PRIMARY KEY NOT NULL,
        leetcode_question_link TEXT NOT NULL UNIQUE,
        neetcode_question_link TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        tag TEXT NOT NULL,
        blind_75 INTEGER NOT NULL,
        neetcode_150 INTEGER NOT NULL,
        neetcode_250 INTEGER NOT NULL,
        solved INTEGER NOT NULL DEFAULT 0
      )
    `);

    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        utc_date TEXT PRIMARY KEY NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  private async syncLeetcodeFromMainTable(): Promise<void> {
    let lastId = 0;
    while (true) {
      const batch = await this.env.DB.prepare(
        `SELECT id, rating, title, title_zh, title_slug, contest_slug, problem_index, contest_id_en, contest_id_zh
         FROM leetcode
         WHERE id > ?
         ORDER BY id
         LIMIT ?`,
      )
        .bind(lastId, LEETCODE_BATCH_SIZE)
        .all<LeetcodeRow>();

      const rows = batch.results ?? [];
      if (rows.length === 0) break;

      for (const row of rows) {
        this.sql.exec(
          `INSERT INTO leetcode (
             id, rating, title, title_zh, title_slug, contest_slug, problem_index, contest_id_en, contest_id_zh, solved
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET
             rating = excluded.rating,
             title = excluded.title,
             title_zh = excluded.title_zh,
             title_slug = excluded.title_slug,
             contest_slug = excluded.contest_slug,
             problem_index = excluded.problem_index,
             contest_id_en = excluded.contest_id_en,
             contest_id_zh = excluded.contest_id_zh`,
          row.id,
          row.rating,
          row.title,
          row.title_zh,
          row.title_slug,
          row.contest_slug,
          row.problem_index,
          row.contest_id_en,
          row.contest_id_zh,
        );
      }

      lastId = rows[rows.length - 1].id;
    }
  }

  private async syncNeetcodeFromMainTable(): Promise<void> {
    let lastId = 0;
    while (true) {
      const batch = await this.env.DB.prepare(
        `SELECT id, leetcode_question_link, neetcode_question_link, difficulty, tag, blind_75, neetcode_150, neetcode_250
         FROM neetcode
         WHERE id > ?
         ORDER BY id
         LIMIT ?`,
      )
        .bind(lastId, NEETCODE_BATCH_SIZE)
        .all<NeetcodeRow>();

      const rows = batch.results ?? [];
      if (rows.length === 0) break;

      for (const row of rows) {
        this.sql.exec(
          `INSERT INTO neetcode (
             id, leetcode_question_link, neetcode_question_link, difficulty, tag, blind_75, neetcode_150, neetcode_250, solved
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
           ON CONFLICT(id) DO UPDATE SET
             leetcode_question_link = excluded.leetcode_question_link,
             neetcode_question_link = excluded.neetcode_question_link,
             difficulty = excluded.difficulty,
             tag = excluded.tag,
             blind_75 = excluded.blind_75,
             neetcode_150 = excluded.neetcode_150,
             neetcode_250 = excluded.neetcode_250`,
          row.id,
          row.leetcode_question_link,
          row.neetcode_question_link,
          row.difficulty,
          row.tag,
          row.blind_75,
          row.neetcode_150,
          row.neetcode_250,
        );
      }

      lastId = rows[rows.length - 1].id;
    }
  }
}

interface UserProblemsBinding {
  USER_PROBLEMS: DurableObjectNamespace;
}

export async function initializeUserProblemTables(userEmail: string): Promise<void> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const bindings = env as typeof env & UserProblemsBinding;
  const id = bindings.USER_PROBLEMS.idFromName(normalizedEmail);
  const stub = bindings.USER_PROBLEMS.get(id);
  const res = await stub.fetch("https://user-problems.internal/init", { method: "POST" });
  if (!res.ok) throw new Error(`DO init failed for ${normalizedEmail} with status ${res.status}`);
}

export async function refreshUserLeetcodeTable(userEmail: string): Promise<void> {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const bindings = env as typeof env & UserProblemsBinding;
  const id = bindings.USER_PROBLEMS.idFromName(normalizedEmail);
  const stub = bindings.USER_PROBLEMS.get(id);
  const res = await stub.fetch("https://user-problems.internal/sync-leetcode", {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(
      `DO leetcode sync failed for ${normalizedEmail} with status ${res.status}`,
    );
  }
}
