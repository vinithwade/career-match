import { GoogleGenAI } from "@google/genai";
import { EMBEDDING_MODEL, getApiKey } from "./config.js";

let client: GoogleGenAI | undefined;

const getClient = (): GoogleGenAI => {
  client ??= new GoogleGenAI({ apiKey: getApiKey() });
  return client;
};

export const embedText = async (text: string, taskType = "RETRIEVAL_QUERY"): Promise<number[]> => {
  const response = await getClient().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: 768 },
  });
  const values = response.embeddings?.[0]?.values;
  if (!values?.length) throw new Error("Embedding model returned no vector");
  return values;
};

export const embedMany = async (texts: string[], taskType = "RETRIEVAL_DOCUMENT"): Promise<number[][]> => {
  if (texts.length === 0) return [];
  const response = await getClient().models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType, outputDimensionality: 768 },
  });
  const vectors = response.embeddings?.map((embedding) => embedding.values ?? []);
  if (!vectors || vectors.length !== texts.length || vectors.some((vector) => vector.length === 0)) {
    throw new Error("Embedding model returned an unexpected number of vectors");
  }
  return vectors;
};

export const cosineSimilarity = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
