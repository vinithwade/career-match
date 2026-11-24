import { runAgent } from "./agent.js";
import { ensureIndex, semanticSearch } from "./jobs.js";

const retrievalCases = [
  {
    query: "tool calling LLM agent with memory and structured outputs",
    expected: ["elip-career-agent", "folio-agent", "payload-agents"],
  },
  {
    query: "RAG pipelines and evaluation of LLM answer quality",
    expected: ["northstar-rag", "cognition-evals", "kindred-rag-intern"],
  },
  {
    query: "semantic search over a jobs index using embeddings and ranking",
    expected: ["vectorly-search", "lantern-search", "stepstone-intern"],
  },
];

await ensureIndex();

let hitsAt3 = 0;
let reciprocalRank = 0;

for (const testCase of retrievalCases) {
  const results = await semanticSearch(testCase.query, { limit: 3 });
  const ids = results.map((job) => job.id);
  const rank = ids.findIndex((id) => testCase.expected.includes(id));
  if (rank >= 0) {
    hitsAt3++;
    reciprocalRank += 1 / (rank + 1);
  }
  console.log(`${testCase.query}\n  top3=${ids.join(", ")} expected=${testCase.expected.join(", ")}`);
}

console.log({
  retrievalCases: retrievalCases.length,
  hitAt3: Number((hitsAt3 / retrievalCases.length).toFixed(3)),
  mrr: Number((reciprocalRank / retrievalCases.length).toFixed(3)),
});

if (process.argv.includes("--llm")) {
  const toolCases = [
    {
      prompt:
        "Remember that I am a Python engineer with skills in LLMs, SQL, embeddings and semantic search, based in Bengaluru.",
      expected: "save_profile",
    },
    {
      prompt: "Which jobs fit the profile you saved for me?",
      expected: "match_jobs",
    },
    {
      prompt: "Search for remote internships involving RAG pipelines.",
      expected: "search_jobs",
    },
  ];

  let toolPasses = 0;
  for (const testCase of toolCases) {
    try {
      const result = await runAgent(testCase.prompt, "eval-tools");
      const used = result.trace.some((item) => item.name === testCase.expected);
      if (used) toolPasses++;
      console.log(
        `${testCase.prompt}\n  expected=${testCase.expected} used=${result.trace.map((item) => item.name).join(", ") || "none"}`,
      );
    } catch (error) {
      console.log(`${testCase.prompt}\n  FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log({ toolCases: toolCases.length, toolSelectionAccuracy: Number((toolPasses / toolCases.length).toFixed(3)) });
}
