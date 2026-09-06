/*
 * Where the Auth.js routes live.
 *
 * The obvious home is /api/auth, and it was, until Google Safe Browsing listed
 * "agenticchess.online/api/auth/callback/github" as phishing on 2026-09-05. The
 * callback carries a `code` that looks like a credential and, since RFC 9207,
 * an `iss` holding a full github.com URL inside the query of another host: the
 * shape of a phishing kit, written by GitHub itself. Nothing here is wrong, so
 * there is nothing to correct — but Safe Browsing matches path prefixes, and
 * the listing took the return leg of every sign-in down with it.
 *
 * Moving off that prefix is a bridge, not a cure: the cure is the review
 * request. Renaming the provider would have moved the callback too, and would
 * have orphaned every row in `accounts`, whose primary key is the provider.
 */

/** The Auth.js base path. Next mounts the handler from `src/app` + this. */
export const AUTH_BASE_PATH = "/api/account";

/** The address the GitHub OAuth app must be configured to call back. */
export const GITHUB_CALLBACK_PATH = `${AUTH_BASE_PATH}/callback/github`;
