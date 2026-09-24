import { env } from "cloudflare:workers";
import type { Db, MongoClient } from "mongodb";

const DEFAULT_DB_NAME = "makersmap";

type EnvName = "MONGODB_URI" | "MONGODB_DB" | "X_BEARER_TOKEN" | "TWITTERAPI_IO_KEY" | "ANTHROPIC_API_KEY" | "OPENROUTER_API_KEY" | "OPENROUTER_MODEL" | "ADMIN_SECRET" | "SESSION_SECRET" | "X_CLIENT_ID" | "X_CLIENT_SECRET" | "SITE_URL" | "PLAUSIBLE_DOMAIN" | "DATAFAST_WEBSITE_ID" | "POSTHOG_KEY" | "POSTHOG_HOST" | "RESEND_API_KEY" | "EMAIL_FROM";

export function readEnv(name: EnvName): string | undefined {
  const fromCloudflare = env[name];
  if (typeof fromCloudflare === "string" && fromCloudflare.length > 0) {
    return fromCloudflare;
  }

  if (typeof process !== "undefined") {
    const fromProcess = process.env[name];
    if (fromProcess) return fromProcess;
  }

  return undefined;
}

export function isMongoConfigured(): boolean {
  return Boolean(readEnv("MONGODB_URI"));
}

export function getXBearerToken(): string | undefined {
  const raw = readEnv("X_BEARER_TOKEN");
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function getAnthropicKey(): string | undefined {
  return readEnv("ANTHROPIC_API_KEY");
}

export function isXConfigured(): boolean {
  return Boolean(getXBearerToken());
}

function getMongoUri(): string {
  const uri = readEnv("MONGODB_URI");
  if (!uri) {
    throw new Error(
      "MongoDB is not configured. Set MONGODB_URI in a local .env file or your hosting secrets."
    );
  }
  return uri;
}

export function getMongoDbName(): string {
  return readEnv("MONGODB_DB") ?? DEFAULT_DB_NAME;
}

// Workers cancel a socket when the request that opened it finishes, so a
// client cached at module level works for the first request and then hangs
// for every request after it. Open a client per operation and close it.
export async function getMongoClient(): Promise<MongoClient> {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(getMongoUri(), {
    maxPoolSize: 1,
    serverSelectionTimeoutMS: 8000,
  });
  await client.connect();
  return client;
}

export async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const client = await getMongoClient();
  try {
    return await work(client.db(getMongoDbName()));
  } finally {
    await client.close().catch(() => undefined);
  }
}
