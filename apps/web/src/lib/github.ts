export interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/** GitHub hides the address unless the token carries `user:email`, and only verified ones count. */
export function pickPrimaryEmail(entries: GitHubEmail[]): string | null {
  const verified = entries.filter((entry) => entry.verified);
  return verified.find((entry) => entry.primary)?.email ?? verified[0]?.email ?? null;
}

export async function fetchPrimaryEmail(accessToken: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!Array.isArray(body)) return null;
  const entries = body.flatMap((entry): GitHubEmail[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    return typeof record["email"] === "string"
      ? [{ email: record["email"], primary: record["primary"] === true, verified: record["verified"] === true }]
      : [];
  });
  return pickPrimaryEmail(entries);
}
