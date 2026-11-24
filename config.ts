import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("./local.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const getApiKey = (): string => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing from the environment");
  return key;
};

const preferredChatModel = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
const fallbackChatModels = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"];
export const CHAT_MODELS = [...new Set([preferredChatModel, ...fallbackChatModels])];
export const CHAT_MODEL = CHAT_MODELS[0];
export const EMBEDDING_MODEL = process.env.GEMINI_EMBED_MODEL ?? "gemini-embedding-001";
const localDbPath = fileURLToPath(new URL("./career-agent.db", import.meta.url));
export const DB_PATH = process.env.CAREER_DB_PATH ?? (process.env.VERCEL ? "/tmp/career-agent.db" : localDbPath);
