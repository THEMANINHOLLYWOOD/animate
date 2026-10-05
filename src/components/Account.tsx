"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { createContext, useContext, type ReactNode } from "react";
import { CLERK_ENABLED, LOCAL_USER } from "@/lib/authMode";

type Account = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  local: boolean;
};

const Ctx = createContext<Account>({ isLoaded: true, isSignedIn: true, userId: LOCAL_USER, local: true });

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  return <Ctx.Provider value={{ isLoaded, isSignedIn: !!isSignedIn, userId: userId ?? null, local: false }}>{children}</Ctx.Provider>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  // Without Clerk, the default context value (local owner) applies.
  return CLERK_ENABLED ? <ClerkBridge>{children}</ClerkBridge> : <>{children}</>;
}

export const useAccount = () => useContext(Ctx);

export function SignIn({ children }: { children: ReactNode }) {
  return CLERK_ENABLED ? <SignInButton mode="modal">{children}</SignInButton> : <>{children}</>;
}

export function AccountButton() {
  return CLERK_ENABLED ? <UserButton /> : <span className="pill ghost">Local mode</span>;
}
