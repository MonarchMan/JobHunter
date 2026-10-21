import { isIP } from 'node:net';
import { z } from 'zod';

const webServerEnvironmentSchema = z.looseObject({
  HOST: z.string().optional(),
  PORT: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
});

/** 模块数据结构或契约。 */
export interface WebServerConfig {
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly development: boolean;
}

const developmentCondition = '--conditions=development';

/** 为 Web 与 Worker 子进程保留既有环境，并在开发模式启用 workspace 源码导出。 */
export function resolveWebChildEnvironment(
  environment: NodeJS.ProcessEnv,
  development: boolean,
): NodeJS.ProcessEnv {
  // 1、生产模式原样复制环境；2、开发模式仅在尚未声明时追加 development 条件。
  if (!development) return { ...environment };
  const nodeOptions = environment.NODE_OPTIONS?.trim() ?? '';
  if (nodeOptions.split(/\s+/u).includes(developmentCondition)) return { ...environment };
  return {
    ...environment,
    NODE_OPTIONS: [nodeOptions, developmentCondition].filter(Boolean).join(' '),
  };
}

/** Refuse every wildcard, LAN and public address; v1 is intentionally local-only. */
/** 将任意本机主机名规范化为受支持的监听地址。 */
export function normalizeLoopbackHost(value: string | undefined): WebServerConfig['host'] {
  const host = (value ?? '127.0.0.1').trim().toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return '127.0.0.1';
  if (host === '::1' || host === '[::1]') return '::1';
  const description = isIP(host) === 0 ? `主机名 ${host}` : `地址 ${host}`;
  throw new Error(`拒绝绑定 ${description}：个人版 Web 管理台只能监听 loopback。`);
}

/** 从环境变量和默认值解析 Web 服务配置。 */
export function resolveWebServerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WebServerConfig {
  const parsed = webServerEnvironmentSchema.parse(environment);
  const port = parsed.PORT === undefined ? 3210 : Number(parsed.PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error('PORT 必须是 1 到 65535 的整数。');
  return {
    host: normalizeLoopbackHost(parsed.HOST),
    port,
    development: parsed.NODE_ENV !== 'production',
  };
}
