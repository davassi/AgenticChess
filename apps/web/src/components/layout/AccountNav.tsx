import Link from "next/link";
import type { ReactElement } from "react";
import { signOut } from "@/lib/auth";

export interface AccountNavProps {
  account: { name: string | null; email: string } | null;
}

export function AccountNav({ account }: AccountNavProps): ReactElement {
  if (account === null) {
    return <Link href="/signin">Sign in</Link>;
  }

  async function endSession(): Promise<void> {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <form className="topnav-account" action={endSession}>
      <span className="topnav-user">{account.name ?? account.email}</span>
      <button type="submit" className="topnav-signout">
        Sign out
      </button>
    </form>
  );
}
