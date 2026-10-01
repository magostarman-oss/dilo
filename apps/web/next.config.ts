import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// One .env for the whole repo, at its root (ANTHROPIC_API_KEY, DILO_MODEL, ...).
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const config: NextConfig = {
  // The shared packages are TypeScript sources, compiled by Next.
  transpilePackages: ["@dilo/core", "@dilo/memory", "@dilo/client", "@dilo/nlu", "@dilo/actions"],
  // The Anthropic SDK only ever runs on the server.
  serverExternalPackages: ["@anthropic-ai/sdk"],
};

export default config;
