import { z } from "zod";

const EnvSchema = z.object({
  API_PUBLIC_URL: z.url(),
  API_INTERNAL_URL: z.url().optional(),
});

export interface WebEnv {
  /** The address the browser uses, handed to client components as a prop. */
  apiPublicUrl: string;
  /** The address server components use; inside Docker this is the service name. */
  apiInternalUrl: string;
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
  };
}

let cached: WebEnv | null = null;

/** Parsed once per server process, never at import time, so tests stay hermetic. */
export function serverEnv(): WebEnv {
  cached ??= loadEnv();
  return cached;
}
