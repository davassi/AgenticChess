import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // These reach Postgres through node APIs; keep them out of the bundler.
  serverExternalPackages: ["postgres", "@aichess/db", "@aichess/runtime"],
};

export default config;
