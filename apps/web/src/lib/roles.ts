export type UserRole = "user" | "admin";

/** The addresses in ADMIN_EMAILS become admins; comparison ignores case and spacing. */
export function roleForEmail(email: string, adminEmails: string): UserRole {
  const wanted = email.trim().toLowerCase();
  if (wanted === "") return "user";
  const allowed = adminEmails
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  return allowed.includes(wanted) ? "admin" : "user";
}
