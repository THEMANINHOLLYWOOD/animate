import type { NextConfig } from "next";

// Site-wide security headers, kept conservative: no script/style policy (Clerk,
// next/font and blob:/data: media all keep working), just no MIME sniffing, no
// full-URL referrers to other sites, and no framing by other origins.
// API routes that relay outside bytes send their own sandboxing policy, so the
// page CSP here skips /api to avoid two policies on one response.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/:path((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
    ];
  },
};

export default nextConfig;
