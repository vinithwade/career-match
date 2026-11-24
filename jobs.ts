import { allJobs, getJob, jobCount, setEmbedding, upsertJob, type Job, type Profile } from "./db.js";
import { cosineSimilarity, embedMany, embedText } from "./embeddings.js";
import { SEED_JOBS } from "./seed.js";

export interface ScoredJob extends Job {
  semanticScore: number;
}

export interface RankedJob extends ScoredJob {
  matchScore: number;
  skillOverlap: number;
  matchedSkills: string[];
  missingSkills: string[];
}

export interface SearchOptions {
  limit?: number;
  mode?: Job["mode"];
  location?: string;
}

const jobText = (job: Job): string =>
  [
    job.title,
    job.company,
    job.location,
    job.mode,
    job.employmentType,
    job.skills.join(", "),
    job.description,
  ].join(" | ");

const publicJob = <T extends Job>(job: T): Omit<T, "embedding"> => {
  const { embedding: _embedding, ...rest } = job;
  return rest;
};

export const publicResult = <T extends Job>(job: T) => publicJob(job);

export const seedJobs = (): number => {
  for (const job of SEED_JOBS) upsertJob(job);
  return jobCount();
};

export const ensureIndex = async (): Promise<void> => {
  seedJobs();
  const missing = allJobs().filter((job) => !job.embedding?.length);
  if (missing.length === 0) return;

  for (let offset = 0; offset < missing.length; offset += 16) {
    const batch = missing.slice(offset, offset + 16);
    const vectors = await embedMany(batch.map(jobText), "RETRIEVAL_DOCUMENT");
    batch.forEach((job, index) => setEmbedding(job.id, vectors[index]));
  }
};

const matchesFilters = (job: Job, options: SearchOptions): boolean => {
  if (options.mode && job.mode !== options.mode) return false;
  if (options.location) {
    const location = options.location.toLowerCase();
    if (job.mode !== "remote" && !job.location.toLowerCase().includes(location)) return false;
  }
  return true;
};

export const semanticSearch = async (query: string, options: SearchOptions = {}): Promise<ScoredJob[]> => {
  await ensureIndex();
  const queryVector = await embedText(query, "RETRIEVAL_QUERY");
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 25);

  return allJobs()
    .filter((job) => matchesFilters(job, options))
    .map((job) => ({
      ...publicJob(job),
      semanticScore: cosineSimilarity(queryVector, job.embedding ?? []),
    }))
    .sort((a, b) => b.semanticScore - a.semanticScore)
    .slice(0, limit);
};

const normalise = (value: string): string => value.toLowerCase().replace(/[^a-z0-9+#.]/g, "");

const skillMatches = (profileSkill: string, jobSkill: string): boolean => {
  const a = normalise(profileSkill);
  const b = normalise(jobSkill);
  return a.length > 0 && (a === b || a.includes(b) || b.includes(a));
};

export const rankForProfile = async (profile: Profile, limit = 5): Promise<RankedJob[]> => {
  const query = [profile.targetRole, profile.summary, profile.skills.join(" ")].filter(Boolean).join(" ");
  if (!query.trim()) throw new Error("Profile needs a targetRole, summary or skills before matching");

  const candidates = await semanticSearch(query, {
    limit: 25,
    mode: profile.remoteOnly ? "remote" : undefined,
    location: profile.location,
  });

  return candidates
    .map((job) => {
      const matchedSkills = job.skills.filter((skill) =>
        profile.skills.some((profileSkill) => skillMatches(profileSkill, skill)),
      );
      const missingSkills = job.skills.filter((skill) => !matchedSkills.includes(skill));
      const skillOverlap = job.skills.length ? matchedSkills.length / job.skills.length : 0;

      return {
        ...job,
        matchScore: 0.7 * job.semanticScore + 0.3 * skillOverlap,
        skillOverlap,
        matchedSkills,
        missingSkills,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, Math.min(Math.max(limit, 1), 10));
};

export const getJobDetails = (id: string): Omit<Job, "embedding"> | undefined => {
  const job = getJob(id);
  return job ? publicJob(job) : undefined;
};
