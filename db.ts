import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./config.js";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  mode: "remote" | "onsite" | "hybrid";
  employmentType: "internship" | "full-time";
  pay: string;
  skills: string[];
  description: string;
  postedAt: string;
  applyUrl?: string;
  embedding?: number[];
}

export interface Profile {
  targetRole?: string;
  skills: string[];
  location?: string;
  remoteOnly?: boolean;
  summary?: string;
  experienceYears?: number;
}

export interface StoredMessage {
  role: "user" | "model";
  content: string;
}

interface JobRow {
  id: string;
  title: string;
  company: string;
  location: string;
  mode: Job["mode"];
  employment_type: Job["employmentType"];
  pay: string;
  skills: string;
  description: string;
  posted_at: string;
  apply_url: string | null;
  embedding: string | null;
}

interface ProfileRow {
  profile_json: string;
}

interface MessageRow {
  role: StoredMessage["role"];
  content: string;
}

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    mode TEXT NOT NULL,
    employment_type TEXT NOT NULL,
    pay TEXT NOT NULL,
    skills TEXT NOT NULL,
    description TEXT NOT NULL,
    posted_at TEXT NOT NULL,
    apply_url TEXT,
    embedding TEXT
  );
  CREATE TABLE IF NOT EXISTS profiles (
    session_id TEXT PRIMARY KEY,
    profile_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, id);
`);

const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
if (!jobColumns.some((column) => column.name === "apply_url")) {
  db.exec("ALTER TABLE jobs ADD COLUMN apply_url TEXT");
}

const toJob = (row: JobRow): Job => ({
  id: row.id,
  title: row.title,
  company: row.company,
  location: row.location,
  mode: row.mode,
  employmentType: row.employment_type,
  pay: row.pay,
  skills: JSON.parse(row.skills) as string[],
  description: row.description,
  postedAt: row.posted_at,
  applyUrl: row.apply_url ?? undefined,
  embedding: row.embedding ? (JSON.parse(row.embedding) as number[]) : undefined,
});

export const upsertJob = (job: Job): void => {
  db.prepare(`
    INSERT INTO jobs (id, title, company, location, mode, employment_type, pay, skills, description, posted_at, apply_url, embedding)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      company = excluded.company,
      location = excluded.location,
      mode = excluded.mode,
      employment_type = excluded.employment_type,
      pay = excluded.pay,
      skills = excluded.skills,
      description = excluded.description,
      posted_at = excluded.posted_at,
      apply_url = excluded.apply_url
  `).run(
    job.id,
    job.title,
    job.company,
    job.location,
    job.mode,
    job.employmentType,
    job.pay,
    JSON.stringify(job.skills),
    job.description,
    job.postedAt,
    job.applyUrl ?? null,
    job.embedding ? JSON.stringify(job.embedding) : null,
  );
};

export const getJob = (id: string): Job | undefined => {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  return row ? toJob(row) : undefined;
};

export const allJobs = (): Job[] =>
  (db.prepare("SELECT * FROM jobs ORDER BY posted_at DESC").all() as unknown as JobRow[]).map(toJob);

export const jobCount = (): number =>
  (db.prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;

export const setEmbedding = (id: string, vector: number[]): void => {
  db.prepare("UPDATE jobs SET embedding = ? WHERE id = ?").run(JSON.stringify(vector), id);
};

export const saveProfile = (sessionId: string, profile: Profile): void => {
  db.prepare(`
    INSERT INTO profiles (session_id, profile_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `).run(sessionId, JSON.stringify(profile), new Date().toISOString());
};

export const loadProfile = (sessionId: string): Profile | undefined => {
  const row = db.prepare("SELECT profile_json FROM profiles WHERE session_id = ?").get(sessionId) as
    | ProfileRow
    | undefined;
  return row ? (JSON.parse(row.profile_json) as Profile) : undefined;
};

export const appendMessage = (sessionId: string, role: StoredMessage["role"], content: string): void => {
  db.prepare("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(
    sessionId,
    role,
    content,
    new Date().toISOString(),
  );
};

export const loadMessages = (sessionId: string, limit = 20): StoredMessage[] => {
  const rows = db.prepare(
    "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?",
  ).all(sessionId, limit) as unknown as MessageRow[];
  return rows.reverse().map((row) => ({ role: row.role, content: row.content }));
};

export const clearMessages = (sessionId: string): void => {
  db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
};
