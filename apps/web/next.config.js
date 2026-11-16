import process from "node:process";

// Where the NestJS API listens. In production Nginx routes /api itself and this proxy is unused.
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3001";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serve the API under the same origin as the page, so the session cookie is first-party
  // and no CORS setup is needed.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
