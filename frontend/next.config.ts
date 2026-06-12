import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Docker standalone output
  output: "standalone",
  
  // Allow CORS requests from localhost during development
  allowedDevOrigins: ['127.0.0.1', 'localhost'],

  // Allow large file uploads via Server Actions
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },

  // Proxy /api/* to FastAPI backend (used in development)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
