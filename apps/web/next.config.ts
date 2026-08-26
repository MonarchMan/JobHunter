import type { NextConfig } from 'next';

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
