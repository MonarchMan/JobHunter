import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { resolveWebServerConfig } from './host.js';

const config = resolveWebServerConfig({
  ...process.env,
  ...(process.argv.includes('--production') ? { NODE_ENV: 'production' } : {}),
});
const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const child = spawn(
  process.execPath,
  [
    nextBin,
    config.development ? 'dev' : 'start',
    '--hostname',
    config.host,
    '--port',
    String(config.port),
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      JOBHUNTER_WORKSPACE_ROOT: path.resolve(import.meta.dirname, '../../../..'),
    },
  },
);

child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

const forward = (signal: NodeJS.Signals): void => {
  if (!child.killed) child.kill(signal);
};
process.once('SIGINT', () => {
  forward('SIGINT');
});
process.once('SIGTERM', () => {
  forward('SIGTERM');
});
