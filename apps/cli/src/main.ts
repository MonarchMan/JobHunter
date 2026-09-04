#!/usr/bin/env node

import { processCliIo } from './io.js';
import { runLocalCli } from './local-runner.js';

// 1、加载本地环境变量；2、转交 CLI 运行器；3、将结果写入进程退出码。
try {
  process.loadEnvFile();
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
}
process.exitCode = await runLocalCli({
  argv: process.argv.slice(2),
  io: processCliIo,
});
