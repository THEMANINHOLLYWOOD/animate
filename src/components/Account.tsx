"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { createContext, useContext, type ReactNode } from "react";
import { CLERK_ENABLED, LOCAL_MODE, LOCAL_USER } from "@/lib/authMode";

type Account = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  local: boolean;
};

const Ctx = createContext<Account>({
  isLoaded: true,
  isSignedIn: LOCAL_MODE,
  userId: LOCAL_MODE ? LOCAL_USER : null,
  local: LOCAL_MODE,
});

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
  if (CLERK_ENABLED) return <SignInButton mode="modal">{children}</SignInButton>;
  return (
    <span title="Accounts are being set up" style={{ opacity: 0.5, pointerEvents: "none", display: "contents" }}>
      {children}
    </span>
  );
}

export function AccountButton() {
  if (CLERK_ENABLED) return <UserButton />;
  return LOCAL_MODE ? <span className="pill ghost">Local mode</span> : null;
}
