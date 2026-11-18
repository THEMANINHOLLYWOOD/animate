// Where the site lives: share links, and the image and video a shared link shows, are built on it.
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://animate.inchipala.com").replace(/\/+$/, "");
