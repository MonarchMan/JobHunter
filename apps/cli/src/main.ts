#!/usr/bin/env node

import { processCliIo } from './io.js';
import { runLocalCli } from './local-runner.js';
try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
process.exitCode = await runLocalCli({
  argv: process.argv.slice(2),
  io: processCliIo,
});
