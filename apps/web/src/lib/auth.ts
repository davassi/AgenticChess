import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { accounts, sessions, users, verificationTokens } from "@aichess/db";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { serverEnv } from "@/env";
import { getDb } from "@/lib/db";
import { fetchPrimaryEmail } from "@/lib/github";
import { roleForEmail, type UserRole } from "@/lib/roles";

function readRole(value: unknown): UserRole {
  return value === "admin" ? "admin" : "user";
}

function roleOf(user: unknown): UserRole {
  return readRole((user as Record<string, unknown>)["role"]);
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = serverEnv();
  const db = getDb();
  return {
    adapter: DrizzleAdapter(db, {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    }),
    session: { strategy: "database" },
    secret: env.authSecret,
    trustHost: true,
    pages: { signIn: "/signin" },
    providers: [
      GitHub({
        clientId: env.githubId,
        clientSecret: env.githubSecret,
        authorization: { params: { scope: "read:user user:email" } },
        async profile(profile, tokens) {
          // GitHub returns a null name for accounts without a display name, and
          // hides the address unless it is verified and the scope was granted.
          const token = tokens.access_token;
          const email =
            typeof profile.email === "string" && profile.email !== ""
              ? profile.email
              : token === undefined
                ? null
                : await fetchPrimaryEmail(token);
          if (email === null) {
            throw new Error("GitHub did not return a verified email address for this account");
          }
          return {
            id: String(profile.id),
            name: profile.name ?? profile.login,
            email,
            image: profile.avatar_url,
          };
        },
      }),
    ],
    callbacks: {
      session({ session, user }) {
        session.user.id = user.id;
        session.user.role = roleOf(user);
        return session;
      },
    },
    events: {
      // Adding an address to ADMIN_EMAILS promotes it at the next sign-in, and
      // the write only happens when the role actually changes.
      async signIn({ user }) {
        if (typeof user.email !== "string" || typeof user.id !== "string") return;
        const role = roleForEmail(user.email, env.adminEmails);
        if (role === roleOf(user)) return;
        await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, user.id));
      },
    },
    cookies: {
      sessionToken: {
        name: "aichess.session",
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
        },
      },
    },
  };
});
