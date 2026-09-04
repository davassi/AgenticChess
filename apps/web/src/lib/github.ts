/** The fields of GitHub's `/user` payload that a sign-in reads. */
export interface GitHubIdentity {
  id: number | string;
  login: string;
  name?: string | null;
  avatar_url?: string;
  /** Whatever the account chose to show, verified or not: never stored. */
  email?: string | null;
}

export interface GitHubUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

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

/**
 * The account behind a GitHub sign-in.
 *
 * The address always comes from `/user/emails`, which says whether GitHub has
 * verified it, and never from the public profile field: that one is whatever
 * the account chose to show, and ADMIN_EMAILS is matched on whatever is stored
 * here. An account is refused rather than stored with an address nobody proved
 * belongs to it.
 */
export async function githubUser(profile: GitHubIdentity, accessToken: string | undefined): Promise<GitHubUser> {
  const email = accessToken === undefined ? null : await fetchPrimaryEmail(accessToken);
  if (email === null) {
    throw new Error("GitHub did not return a verified email address for this account");
  }
  return {
    id: String(profile.id),
    // GitHub returns a null name for accounts without a display name.
    name: profile.name ?? profile.login,
    email,
    image: profile.avatar_url ?? null,
  };
}
