import type { NextConfig } from "next";

if (process.env.VERCEL_ENV === "production") {
  const required = {
    NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  };
  for (const [name, value] of Object.entries(required)) {
    if (!value?.trim() || /replace|example|changeme/i.test(value)) throw new Error(`${name} is required for a production Cooket Vercel build.`);
  }
  if (required.NEXT_PUBLIC_APP_URL !== "https://testnet.cooket.fun") throw new Error("Production Cooket Vercel builds require NEXT_PUBLIC_APP_URL=https://testnet.cooket.fun.");
  if (required.NEXT_PUBLIC_API_URL !== "https://api.testnet.cooket.fun") throw new Error("Production Cooket Vercel builds require NEXT_PUBLIC_API_URL=https://api.testnet.cooket.fun.");
}

const nextConfig: NextConfig = {
  transpilePackages: ["@cooket/contracts-sdk", "@cooket/types"],
};

export default nextConfig;
