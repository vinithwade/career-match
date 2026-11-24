import {
  GoogleGenAI,
  type Content,
  type FunctionCall,
  type FunctionResponse,
  type GenerateContentConfig,
} from "@google/genai";
import { CHAT_MODELS, getApiKey } from "./config.js";
import { appendMessage, loadMessages } from "./db.js";
import { executeTool, toolDeclarations } from "./tools.js";

const MAX_TURNS = 20;

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

export interface ApplyLink {
  id: string;
  title: string;
  company: string;
  applyUrl: string;
  matchScore?: number;
}

export interface AgentResult {
  answer: string;
  trace: ToolTrace[];
  turns: number;
  applyLinks: ApplyLink[];
}

const config: GenerateContentConfig = {
  systemInstruction:
    "You are a career agent. Use save_profile when the user shares their background or preferences. " +
    "When the user asks which jobs fit them or asks for recommendations, always call match_jobs; do not answer from get_profile alone. " +
    "Use search_jobs for exploratory queries that are not tied to a saved profile, and get_profile only when asked about the profile itself. " +
    "Use get_job for details, and get_weather or bash only when explicitly relevant. " +
    "Ground every recommendation in tool results: never invent jobs, salaries or skills. " +
    "Give concise answers with job titles, companies, match scores and the reasoning behind the top picks. " +
    "The UI adds apply buttons for every role automatically, so do not print raw URLs in your answer.",
  tools: [{ functionDeclarations: toolDeclarations }],
};

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const errorStatus = (error: unknown): number | undefined =>
  (error as { status?: number } | null)?.status;

const isRetryable = (error: unknown): boolean => {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_STATUSES.has(status ?? 0) || /aborted|timeout|timed out/i.test(message);
};

const describeError = (error: unknown): string => {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return status ? `${status}: ${message}` : message;
};

const generateWithFallback = async (ai: GoogleGenAI, contents: Content[]) => {
  let lastError: unknown;

  for (const [index, model] of CHAT_MODELS.entries()) {
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config: { ...config, abortSignal: AbortSignal.timeout(60_000) },
      });
    } catch (error) {
      lastError = error;
      const nextModel = CHAT_MODELS[index + 1];
      if (nextModel && isRetryable(error)) {
        console.error(`[agent] ${model} unavailable (${errorStatus(error)}); trying ${nextModel}`);
        continue;
      }
      throw new Error(`Gemini request failed: ${describeError(error)}`);
    }
  }

  throw new Error(`Gemini request failed: ${describeError(lastError)}`);
};

const collectApplyLinks = (output: unknown): ApplyLink[] => {
  const candidates: unknown[] = [];

  if (Array.isArray(output)) {
    candidates.push(...output);
  } else if (output && typeof output === "object") {
    const record = output as Record<string, unknown>;
    if (Array.isArray(record.results)) candidates.push(...record.results);
    if (Array.isArray(record.matches)) candidates.push(...record.matches);
    if (record.applyUrl) candidates.push(record);
  }

  return candidates.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const job = item as Record<string, unknown>;
    if (typeof job.applyUrl !== "string" || typeof job.title !== "string") return [];
    return [
      {
        id: typeof job.id === "string" ? job.id : job.title,
        title: job.title,
        company: typeof job.company === "string" ? job.company : "",
        applyUrl: job.applyUrl,
        matchScore: typeof job.matchScore === "number" ? job.matchScore : undefined,
      },
    ];
  });
};

const dedupeApplyLinks = (links: ApplyLink[]): ApplyLink[] => {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (seen.has(link.applyUrl)) return false;
    seen.add(link.applyUrl);
    return true;
  });
};

const runCalls = async (
  calls: FunctionCall[],
  sessionId: string,
): Promise<{ responses: FunctionResponse[]; trace: ToolTrace[]; applyLinks: ApplyLink[] }> => {
  const settled = await Promise.all(
    calls.map(async (call) => {
      const name = call.name ?? "";
      const args = call.args ?? {};
      try {
        const output = await executeTool(name, args, sessionId);
        return {
          response: { id: call.id, name, response: { output } },
          trace: { name, args, ok: true } satisfies ToolTrace,
          applyLinks: collectApplyLinks(output),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          response: { id: call.id, name, response: { error: message } },
          trace: { name, args, ok: false, error: message } satisfies ToolTrace,
          applyLinks: [] as ApplyLink[],
        };
      }
    }),
  );

  return {
    responses: settled.map((item) => item.response),
    trace: settled.map((item) => item.trace),
    applyLinks: dedupeApplyLinks(settled.flatMap((item) => item.applyLinks)),
  };
};

export const runAgent = async (prompt: string, sessionId = "default"): Promise<AgentResult> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const contents: Content[] = [
    ...loadMessages(sessionId).map((message) => ({
      role: message.role,
      parts: [{ text: message.content }],
    })),
    { role: "user", parts: [{ text: prompt }] },
  ];

  const trace: ToolTrace[] = [];
  const applyLinks: ApplyLink[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await generateWithFallback(ai, contents);
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent?.parts?.length) contents.push({ ...modelContent, role: "model" });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      const answer = response.text?.trim();
      if (!answer) throw new Error("Agent stopped without an answer");

      appendMessage(sessionId, "user", prompt);
      appendMessage(sessionId, "model", answer);
      return { answer, trace, turns: turn + 1, applyLinks: dedupeApplyLinks(applyLinks).slice(0, 5) };
    }

    const result = await runCalls(calls, sessionId);
    trace.push(...result.trace);
    applyLinks.push(...result.applyLinks);
    contents.push({
      role: "user",
      parts: result.responses.map((functionResponse) => ({ functionResponse })),
    });
  }

  throw new Error(`Agent exceeded ${MAX_TURNS} tool turns`);
};
