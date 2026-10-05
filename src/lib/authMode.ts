// Accounts are on when Clerk keys exist. Without them (local development before
// Clerk is connected) the app runs in single-owner local mode.
export const CLERK_ENABLED = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
export const LOCAL_USER = "local";
