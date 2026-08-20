import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OfflineDoctorCheck } from './doctor-service.js';

export function nodeRuntimeCheck(version = process.versions.node): OfflineDoctorCheck {
  return {
    key: 'runtime.node',
    severity: 'required',
    run: () => {
      const major = Number(version.split('.')[0]);
      const supported = major === 24;
      return {
        status: supported ? 'healthy' : 'failed',
        summary: supported ? `Node ${version} 受支持。` : `Node ${version} 不受支持。`,
        recommendation: supported ? null : '请使用 Node.js 24.x 运行本项目。',
        details: { version, requiredRange: '>=24 <25' },
      };
    },
  };
}

export function dataRootCheck(dataRoot: string): OfflineDoctorCheck {
  const path = resolve(dataRoot);
  return {
    key: 'filesystem.data-root',
    severity: 'required',
    async run() {
      const metadata = await stat(path);
      if (!metadata.isDirectory()) {
        return {
          status: 'failed',
          summary: '数据路径不是目录。',
          recommendation: '将 dataRoot 修改为可读写目录。',
          details: { path },
        };
      }
      await access(path, constants.R_OK | constants.W_OK);
      return {
        status: 'healthy',
        summary: '数据目录可读写。',
        recommendation: null,
        details: { path },
      };
    },
  };
}

export function adapterRegistryCheck(input: {
  readonly registeredKeys: readonly string[];
  readonly configuredKeys: readonly string[];
}): OfflineDoctorCheck {
  return {
    key: 'sources.adapter-registry',
    severity: 'required',
    run: () => {
      const registered = new Set(input.registeredKeys);
      const missing = [...new Set(input.configuredKeys)]
        .filter((key) => !registered.has(key))
        .toSorted();
      return {
        status: missing.length === 0 ? 'healthy' : 'failed',
        summary:
          missing.length === 0 ? '所有已配置来源都有已注册适配器。' : '部分已配置来源缺少适配器。',
        recommendation: missing.length === 0 ? null : '禁用缺失来源或安装并注册对应适配器。',
        details: {
          registeredCount: registered.size,
          configuredCount: new Set(input.configuredKeys).size,
          missing,
        },
      };
    },
  };
}

export function localStateHealthCheck(input: {
  readonly sources: {
    readonly enabled: number;
    readonly degraded: number;
    readonly unhealthy: number;
  };
  readonly tasks: { readonly pending: number; readonly running: number; readonly failed: number };
  readonly files: { readonly referenced: number; readonly missing: number };
}): OfflineDoctorCheck {
  return {
    key: 'state.local-health',
    severity: 'optional',
    run: () => {
      const degraded =
        input.sources.degraded > 0 ||
        input.sources.unhealthy > 0 ||
        input.tasks.failed > 0 ||
        input.files.missing > 0;
      return {
        status: degraded ? 'degraded' : 'healthy',
        summary: degraded ? '本地状态存在需要处理的项目。' : '来源、任务和文件状态正常。',
        recommendation: degraded ? '查看来源健康、失败任务和缺失文件详情后分别处理。' : null,
        details: input,
      };
    },
  };
}
