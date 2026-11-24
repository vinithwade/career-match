import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dbPath = fileURLToPath(new URL("./.test-career-agent.db", import.meta.url));
rmSync(dbPath, { force: true });
process.env.CAREER_DB_PATH = dbPath;

const { allJobs, appendMessage, getJob, loadMessages, loadProfile, saveProfile } = await import("./db.js");
const { toolDeclarations, executeTool } = await import("./tools.js");
const { cosineSimilarity } = await import("./embeddings.js");
const { seedJobs } = await import("./jobs.js");

test("cosine similarity handles identical and orthogonal vectors", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.equal(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0);
});

test("seeding creates a queryable jobs index", () => {
  seedJobs();
  assert.ok(allJobs().length >= 10);
  assert.equal(getJob("elip-career-agent")?.company, "Elip");
  assert.equal(getJob("missing-job"), undefined);
});

test("profiles and messages persist per session", () => {
  saveProfile("session-a", { targetRole: "AI engineer", skills: ["LLMs", "SQL"] });
  appendMessage("session-a", "user", "Recommend jobs");
  appendMessage("session-a", "model", "Here are your matches");

  assert.deepEqual(loadProfile("session-a")?.skills, ["LLMs", "SQL"]);
  assert.equal(loadProfile("session-b"), undefined);
  assert.deepEqual(loadMessages("session-a"), [
    { role: "user", content: "Recommend jobs" },
    { role: "model", content: "Here are your matches" },
  ]);
});

test("tool declarations are valid and executable", async () => {
  const names = toolDeclarations.map((declaration) => declaration.name);
  assert.deepEqual(names, [
    "save_profile",
    "get_profile",
    "search_jobs",
    "match_jobs",
    "get_job",
    "get_weather",
    "bash",
  ]);

  const profile = await executeTool(
    "save_profile",
    { targetRole: "AI engineer", skills: ["LLMs", "embeddings"] },
    "session-b",
  );
  assert.match(JSON.stringify(profile), /AI engineer/);
  await assert.rejects(() => executeTool("does_not_exist", {}), /Unknown tool/);
});
