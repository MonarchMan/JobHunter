import type { NextConfig } from 'next';

/** Web 应用的 Next.js 构建与运行配置。 */
const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
