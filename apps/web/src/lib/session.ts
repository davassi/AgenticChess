import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import type { UserRole } from "@/lib/roles";

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: UserRole;
}

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  const user = session?.user;
  if (user === undefined || typeof user.email !== "string") return null;
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email,
    image: user.image ?? null,
    role: user.role,
  };
}

export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await currentUser();
  if (user === null) redirect(`/signin?next=${encodeURIComponent(nextPath)}`);
  return user;
}
