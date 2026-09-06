import { z } from "zod";

const EnvSchema = z.object({
  API_PUBLIC_URL: z.url(),
  API_INTERNAL_URL: z.url().optional(),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  ADMIN_EMAILS: z.string().default(""),
  // Both optional: the visit counter is an accessory, and a missing secret
  // must never be a reason the arena refuses to start. Present but weak is a
  // different matter — a guessable salt is worse than no salt at all, because
  // it suggests an anonymity it does not provide.
  ANALYTICS_SALT: z.string().min(32).optional(),
  ANALYTICS_TOKEN: z.string().min(32).optional(),
});

export interface WebEnv {
  /** The address the browser uses, handed to client components as a prop. */
  apiPublicUrl: string;
  /** The address server components use; inside Docker this is the service name. */
  apiInternalUrl: string;
  databaseUrl: string;
  authSecret: string;
  githubId: string;
  githubSecret: string;
  /** Comma-separated addresses promoted to admin at sign-in. */
  adminEmails: string;
  /** Null switches page-view recording off entirely. */
  analyticsSalt: string | null;
  /** Null makes the statistics endpoint refuse to answer. */
  analyticsToken: string | null;
}

export type EnvSource = Record<string, string | undefined>;

export function loadEnv(source: EnvSource = process.env): WebEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    throw new Error(`Invalid web configuration:\n${lines.join("\n")}`);
  }
  const trim = (url: string): string => url.replace(/\/+$/, "");
  return {
    apiPublicUrl: trim(parsed.data.API_PUBLIC_URL),
    apiInternalUrl: trim(parsed.data.API_INTERNAL_URL ?? parsed.data.API_PUBLIC_URL),
    databaseUrl: parsed.data.DATABASE_URL,
    authSecret: parsed.data.AUTH_SECRET,
    githubId: parsed.data.AUTH_GITHUB_ID,
    githubSecret: parsed.data.AUTH_GITHUB_SECRET,
    adminEmails: parsed.data.ADMIN_EMAILS,
    analyticsSalt: parsed.data.ANALYTICS_SALT ?? null,
    analyticsToken: parsed.data.ANALYTICS_TOKEN ?? null,
  };
}

let cached: WebEnv | null = null;

/** Parsed once per server process, never at import time, so tests stay hermetic. */
export function serverEnv(): WebEnv {
  cached ??= loadEnv();
  return cached;
}
