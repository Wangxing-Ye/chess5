import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isDev = process.env.NODE_ENV === "development";

/**
 * Nothing is loaded cross-origin: fonts are self-hosted by `next/font`, sounds
 * come from `public/media`, and provider APIs are reached through our own
 * proxy — so every fetch destination can be locked to `'self'`. That closes the
 * channels a stolen key would have to leave through, which matters because the
 * keys live in `localStorage`.
 *
 * `script-src` still needs `'unsafe-inline'` for the payload Next.js inlines
 * during hydration. Removing it requires either nonces, which force every page
 * into dynamic rendering, or experimental subresource integrity.
 * `'unsafe-eval'` is only for React's dev-time error reconstruction.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * HSTS and `upgrade-insecure-requests` are deliberately absent until the
 * deployment is known to be HTTPS-only: both hard-break a plain-HTTP origin,
 * and neither buys much here since every resource is already same-origin.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
