import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.js";
import {
  clearMessages,
  jobCount,
  loadMessages,
  loadProfile,
  saveProfile,
  type Profile,
} from "./db.js";
import { ensureIndex, getJobDetails, semanticSearch } from "./jobs.js";

const moduleDir = fileURLToPath(new URL(".", import.meta.url));
const localPublicDir = join(moduleDir, "public");
const bundledPublicDir = join(moduleDir, "..", "public");
const PUBLIC_DIR = existsSync(join(localPublicDir, "index.html")) ? localPublicDir : bundledPublicDir;

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body));
};

const serveStatic = async (res: ServerResponse, pathname: string): Promise<void> => {
  const asset = STATIC_FILES[pathname];
  try {
    const data = await readFile(join(PUBLIC_DIR, asset.file));
    res.writeHead(200, { "content-type": asset.type, "cache-control": "no-cache" });
    res.end(data);
  } catch {
    send(res, 404, { error: "Not found" });
  }
};

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  let raw = "";
  for await (const chunk of req) {
    raw += String(chunk);
    if (raw.length > 1_000_000) throw new Error("Request body too large");
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
};

export const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*" });
      res.end();
      return;
    }

    if (req.method === "GET" && STATIC_FILES[url.pathname]) {
      await serveStatic(res, url.pathname);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true, jobs: jobCount() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/jobs") {
      const mode = url.searchParams.get("mode");
      const results = await semanticSearch(url.searchParams.get("q") ?? "", {
        limit: Number(url.searchParams.get("limit") ?? 5),
        mode: ["remote", "onsite", "hybrid"].includes(mode ?? "")
          ? (mode as "remote" | "onsite" | "hybrid")
          : undefined,
        location: url.searchParams.get("location") ?? undefined,
      });
      send(res, 200, { count: results.length, results });
      return;
    }

    if (req.method === "GET" && url.pathname === "/job") {
      const job = getJobDetails(url.searchParams.get("id") ?? "");
      send(res, job ? 200 : 404, job ?? { error: "Job not found" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/history") {
      const sessionId = url.searchParams.get("sessionId") ?? "web";
      send(res, 200, { sessionId, messages: loadMessages(sessionId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/session/clear") {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? "web");
      clearMessages(sessionId);
      send(res, 200, { cleared: true, sessionId });
      return;
    }

    if (req.method === "GET" && url.pathname === "/profile") {
      const sessionId = url.searchParams.get("sessionId") ?? "default";
      send(res, 200, { sessionId, profile: loadProfile(sessionId) ?? null });
      return;
    }

    if (req.method === "POST" && url.pathname === "/profile") {
      const body = await readBody(req);
      const sessionId = String(body.sessionId ?? "default");
      saveProfile(sessionId, body.profile as Profile);
      send(res, 200, { sessionId, profile: loadProfile(sessionId) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/agent") {
      const body = await readBody(req);
      const prompt = String(body.prompt ?? "").trim();
      if (!prompt) {
        send(res, 400, { error: "prompt is required" });
        return;
      }
      const result = await runAgent(prompt, String(body.sessionId ?? "default"));
      send(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/index") {
      await ensureIndex();
      send(res, 200, { indexed: jobCount() });
      return;
    }

    send(res, 404, { error: "Not found" });
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
};
