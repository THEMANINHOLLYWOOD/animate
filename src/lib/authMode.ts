// Accounts are on when Clerk keys exist. Accounts only add cloud storage:
// anyone can create films without signing in (guests keep them in the browser).
// Without Clerk, local development runs as a single owner with cloud storage.
export const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const LOCAL_MODE = !CLERK_ENABLED && process.env.NODE_ENV === "development";
export const LOCAL_USER = "local";
