import { isIP } from 'node:net';
import { z } from 'zod';

const webServerEnvironmentSchema = z.looseObject({
  HOST: z.string().optional(),
  PORT: z.string().optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
});

export interface WebServerConfig {
  readonly host: '127.0.0.1' | '::1';
  readonly port: number;
  readonly development: boolean;
}

/** Refuse every wildcard, LAN and public address; v1 is intentionally local-only. */
export function normalizeLoopbackHost(value: string | undefined): WebServerConfig['host'] {
  const host = (value ?? '127.0.0.1').trim().toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') return '127.0.0.1';
  if (host === '::1' || host === '[::1]') return '::1';
  const description = isIP(host) === 0 ? `主机名 ${host}` : `地址 ${host}`;
  throw new Error(`拒绝绑定 ${description}：个人版 Web 管理台只能监听 loopback。`);
}

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
