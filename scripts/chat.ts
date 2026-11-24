import { runAgent } from "../agent.js";

const prompt =
  process.argv.slice(2).join(" ").trim() ||
  "Recommend jobs for a Python engineer with LLM, search and embedding experience.";

try {
  const result = await runAgent(prompt, process.env.SESSION_ID ?? "default");
  console.log(result.answer);
  console.log(`\n[tools: ${result.trace.map((item) => item.name).join(", ") || "none"} | turns: ${result.turns}]`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
