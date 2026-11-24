import { runAgent } from "./agent.js";
import { loadProfile, saveProfile, type Profile } from "./db.js";
import { ensureIndex, publicResult, rankForProfile, semanticSearch } from "./jobs.js";

const profile: Profile = {
  targetRole: "Software Engineer, AI Career Agent",
  skills: ["LLMs", "agents", "tool use", "Python", "SQL", "APIs", "embeddings", "semantic search", "evals"],
  location: "Bengaluru",
  remoteOnly: false,
  summary: "Building tool-calling agents, semantic search and evaluation-driven LLM products.",
  experienceYears: 1,
};

await ensureIndex();
saveProfile("demo", profile);

console.log("PROFILE\n", loadProfile("demo"));

const exploratory = await semanticSearch("remote work with RAG pipelines and LLM evals", { limit: 3 });
console.log("\nSEMANTIC SEARCH\n", exploratory.map((job) => ({ ...publicResult(job), semanticScore: job.semanticScore })));

const matches = await rankForProfile(profile, 3);
console.log("\nPERSONALISED MATCHES\n", matches.map((job) => ({
  id: job.id,
  title: job.title,
  company: job.company,
  matchScore: Number(job.matchScore.toFixed(3)),
  matchedSkills: job.matchedSkills,
  missingSkills: job.missingSkills,
})));

const result = await runAgent("Recommend the best roles for me and explain why.", "demo");
console.log("\nAGENT ANSWER\n", result.answer);
console.log("\nTOOL TRACE\n", result.trace);
