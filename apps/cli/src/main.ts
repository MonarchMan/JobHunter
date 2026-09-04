#!/usr/bin/env node

import { processCliIo } from './io.js';
import { runLocalCli } from './local-runner.js';
import path from 'node:path';

// 1、固定工作区根目录；2、由公共加载器读取配置；3、执行命令并写入退出码。
const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
process.exitCode = await runLocalCli({
  argv: process.argv.slice(2),
  io: processCliIo,
  cwd: workspaceRoot,
  workspaceRoot,
});
