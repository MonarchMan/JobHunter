export type DoctorSeverity = 'required' | 'optional' | 'informational';
export type DoctorCheckStatus = 'healthy' | 'degraded' | 'failed';

export interface DoctorCheckResult {
  readonly key: string;
  readonly status: DoctorCheckStatus;
  readonly severity: DoctorSeverity;
  readonly summary: string;
  readonly recommendation: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface OfflineDoctorCheck {
  readonly key: string;
  readonly severity: DoctorSeverity;
  run():
    | Promise<Omit<DoctorCheckResult, 'key' | 'severity'>>
    | Omit<DoctorCheckResult, 'key' | 'severity'>;
}

export interface DoctorReport {
  readonly status: DoctorCheckStatus;
  readonly checkedAt: number;
  readonly checks: readonly DoctorCheckResult[];
  readonly versions: Readonly<Record<string, string>>;
}

export class OfflineDoctorService {
  readonly #checks: readonly OfflineDoctorCheck[];
  readonly #versions: Readonly<Record<string, string>>;
  readonly #now: () => number;

  public constructor(input: {
    readonly checks: readonly OfflineDoctorCheck[];
    readonly versions: Readonly<Record<string, string>>;
    readonly now?: () => number;
  }) {
    if (new Set(input.checks.map((check) => check.key)).size !== input.checks.length) {
      throw new TypeError('Doctor check keys must be unique.');
    }
    this.#checks = input.checks;
    this.#versions = Object.freeze({ ...input.versions });
    this.#now = input.now ?? Date.now;
  }

  public async run(): Promise<DoctorReport> {
    const checks: DoctorCheckResult[] = [];
    for (const check of this.#checks) {
      try {
        const result = await check.run();
        checks.push({ key: check.key, severity: check.severity, ...result });
      } catch {
        checks.push({
          key: check.key,
          severity: check.severity,
          status: check.severity === 'required' ? 'failed' : 'degraded',
          summary: '检查执行失败。',
          recommendation: '查看安全日志中的对应检查事件并修复配置。',
          details: {},
        });
      }
    }
    const status = checks.some(
      (check) => check.severity === 'required' && check.status === 'failed',
    )
      ? 'failed'
      : checks.some((check) => check.status !== 'healthy')
        ? 'degraded'
        : 'healthy';
    return { status, checkedAt: this.#now(), checks, versions: this.#versions };
  }
}

export function modelConfigurationCheck(configured: boolean): OfflineDoctorCheck {
  return {
    key: 'model.configuration',
    severity: 'optional',
    run: () => ({
      status: configured ? 'healthy' : 'degraded',
      summary: configured ? '可选模型配置已提供。' : '未配置可选模型，确定性能力仍可运行。',
      recommendation: configured ? null : '需要 Agent 能力时再配置模型 Provider 和密钥。',
      details: { configured },
    }),
  };
}
