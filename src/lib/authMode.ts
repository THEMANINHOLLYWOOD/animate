// Accounts are on when Clerk keys exist. Without them, local development runs
// as a single owner, and any deployed build is view-only (no generation, no
// storage) so the shared API key can't be spent anonymously.
export const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const LOCAL_MODE = !CLERK_ENABLED && process.env.NODE_ENV === "development";
export const LOCAL_USER = "local";
