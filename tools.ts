import { Type, type FunctionDeclaration } from "@google/genai";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { loadProfile, saveProfile, type Profile } from "./db.js";
import { getJobDetails, publicResult, rankForProfile, semanticSearch } from "./jobs.js";

const execAsync = promisify(exec);

export interface ToolContext {
  sessionId: string;
}

interface Tool {
  declaration: FunctionDeclaration;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<unknown>;
}

interface Place {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
}

interface CurrentWeather {
  time: string;
  temperature_2m: number;
  relative_humidity_2m: number;
  weather_code: number;
  wind_speed_10m: number;
}

const weatherConditions: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

const truncate = (value: string, limit = 8000): string =>
  value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value;

const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const geocode = async (location: string): Promise<Place> => {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoding failed (${response.status})`);

  const data = (await response.json()) as { results?: Place[] };
  const place = data.results?.[0];
  if (!place) throw new Error(`Could not find location: ${location}`);
  return place;
};

const getWeather = async (args: Record<string, unknown>): Promise<unknown> => {
  const location = String(args.location ?? "").trim();
  if (!location) throw new Error("location is required");

  const units = args.units === "fahrenheit" ? "fahrenheit" : "celsius";
  const place = await geocode(location);

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(place.latitude));
  url.searchParams.set("longitude", String(place.longitude));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m");
  url.searchParams.set("temperature_unit", units);

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Weather lookup failed (${response.status})`);

  const data = (await response.json()) as { current: CurrentWeather };
  const current = data.current;

  return {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    time: current.time,
    temperature: current.temperature_2m,
    temperatureUnit: units === "celsius" ? "°C" : "°F",
    conditions: weatherConditions[current.weather_code] ?? `Weather code ${current.weather_code}`,
    humidityPercent: current.relative_humidity_2m,
    windSpeed: current.wind_speed_10m,
    windSpeedUnit: units === "celsius" ? "km/h" : "mph",
  };
};

const runBash = async (args: Record<string, unknown>): Promise<unknown> => {
  const command = String(args.command ?? "").trim();
  if (!command) throw new Error("command is required");

  const timeout = Math.min(Math.max(Number(args.timeoutMs ?? 10000), 100), 60000);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return { command, stdout: truncate(stdout.trim()), stderr: truncate(stderr.trim()) };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message?: string; code?: number };
    return {
      command,
      stdout: truncate((failure.stdout ?? "").trim()),
      stderr: truncate((failure.stderr ?? failure.message ?? "").trim()),
      exitCode: failure.code ?? 1,
    };
  }
};

const searchJobs = async (args: Record<string, unknown>): Promise<unknown> => {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query is required");

  const mode = ["remote", "onsite", "hybrid"].includes(String(args.mode))
    ? (String(args.mode) as "remote" | "onsite" | "hybrid")
    : undefined;

  const results = await semanticSearch(query, {
    limit: Number(args.limit ?? 5),
    mode,
    location: args.location ? String(args.location) : undefined,
  });

  return { count: results.length, results: results.map(publicResult) };
};

const matchJobs = async (args: Record<string, unknown>, context: ToolContext): Promise<unknown> => {
  const profile = loadProfile(context.sessionId);
  if (!profile) throw new Error("No profile saved for this session. Use save_profile first.");

  const matches = await rankForProfile(profile, Number(args.limit ?? 5));
  return { profile, matches: matches.map(publicResult) };
};

const saveUserProfile = async (args: Record<string, unknown>, context: ToolContext): Promise<unknown> => {
  const existing = loadProfile(context.sessionId) ?? { skills: [] };
  const skills = asStringArray(args.skills ?? existing.skills);
  if (skills.length === 0) throw new Error("skills must contain at least one skill");

  const years = Number(args.experienceYears ?? existing.experienceYears ?? 0);
  const profile: Profile = {
    targetRole: args.targetRole ? String(args.targetRole) : existing.targetRole,
    skills,
    location: args.location ? String(args.location) : existing.location,
    remoteOnly: args.remoteOnly === undefined ? existing.remoteOnly : Boolean(args.remoteOnly),
    summary: args.summary ? String(args.summary) : existing.summary,
    experienceYears: Number.isFinite(years) ? years : 0,
  };

  saveProfile(context.sessionId, profile);
  return { saved: true, profile };
};

export const tools: Record<string, Tool> = {
  save_profile: {
    declaration: {
      name: "save_profile",
      description:
        "Save or update a job seeker's profile in durable memory. Call this when the user shares their target role, skills, location or preferences.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          targetRole: { type: Type.STRING, description: "Role the user is targeting, e.g. 'AI engineer'." },
          skills: {
            type: Type.ARRAY,
            description: "Skills and technologies the user has.",
            items: { type: Type.STRING },
          },
          location: { type: Type.STRING, description: "Preferred city, e.g. 'Bengaluru'." },
          remoteOnly: { type: Type.BOOLEAN, description: "Whether the user only wants remote roles." },
          summary: { type: Type.STRING, description: "Short background summary." },
          experienceYears: { type: Type.INTEGER, description: "Years of relevant experience." },
        },
        required: ["skills"],
      },
    },
    execute: saveUserProfile,
  },
  get_profile: {
    declaration: {
      name: "get_profile",
      description: "Read the saved profile for this conversation.",
      parameters: {
        type: Type.OBJECT,
        properties: {},
        required: [],
      },
    },
    execute: async (_args, context) => loadProfile(context.sessionId) ?? { saved: false },
  },
  search_jobs: {
    declaration: {
      name: "search_jobs",
      description:
        "Semantically search the jobs index by intent, skill or role. Use for exploratory questions that are not tied to a saved profile.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: { type: Type.STRING, description: "Natural language search query." },
          limit: { type: Type.INTEGER, description: "Number of results, 1-25 (default 5)." },
          mode: {
            type: Type.STRING,
            description: "Optional work mode filter.",
            enum: ["remote", "onsite", "hybrid"],
          },
          location: { type: Type.STRING, description: "Optional location filter." },
        },
        required: ["query"],
      },
    },
    execute: searchJobs,
  },
  match_jobs: {
    declaration: {
      name: "match_jobs",
      description:
        "Rank jobs for the saved profile using semantic similarity plus skill overlap. Use for 'recommend jobs for me' requests.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          limit: { type: Type.INTEGER, description: "Number of matches, 1-10 (default 5)." },
        },
        required: [],
      },
    },
    execute: matchJobs,
  },
  get_job: {
    declaration: {
      name: "get_job",
      description: "Get full details for a job id returned by search_jobs or match_jobs.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING, description: "Job id, e.g. 'elip-career-agent'." },
        },
        required: ["id"],
      },
    },
    execute: async (args) => {
      const job = getJobDetails(String(args.id ?? ""));
      if (!job) throw new Error(`No job found with id ${String(args.id)}`);
      return job;
    },
  },
  get_weather: {
    declaration: {
      name: "get_weather",
      description: "Get the current weather for a location by city name.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          location: {
            type: Type.STRING,
            description: "City name, optionally with region or country, e.g. 'London, UK'.",
          },
          units: {
            type: Type.STRING,
            description: "Temperature units: 'celsius' (default) or 'fahrenheit'.",
            enum: ["celsius", "fahrenheit"],
          },
        },
        required: ["location"],
      },
    },
    execute: getWeather,
  },
  bash: {
    declaration: {
      name: "bash",
      description: "Run a shell command in the project directory and return its output.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          command: { type: Type.STRING, description: "The shell command to run." },
          timeoutMs: {
            type: Type.INTEGER,
            description: "Timeout in milliseconds (default 10000, maximum 60000).",
          },
        },
        required: ["command"],
      },
    },
    execute: runBash,
  },
};

export const toolDeclarations = Object.values(tools).map((tool) => tool.declaration);

export const executeTool = async (
  name: string,
  args: Record<string, unknown>,
  sessionId = "default",
): Promise<unknown> => {
  const tool = tools[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.execute(args, { sessionId });
};
