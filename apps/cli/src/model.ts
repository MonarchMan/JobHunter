/** CLI 对外约定的进程退出码。 */
export const cliExitCode = {
  success: 0,
  internal: 1,
  usage: 2,
  notFound: 3,
  partial: 4,
  taskFailed: 5,
} as const;
/** 模块使用的类型约束。 */
export type CliExitCode = (typeof cliExitCode)[keyof typeof cliExitCode];
/** 模块数据结构或契约。 */
export interface CommandResult<TData = unknown> {
  readonly data: TData;
  readonly human: string;
  readonly exitCode?: CliExitCode;
}
/** 模块数据结构或契约。 */
export interface CliErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}
/** 可预期的命令错误，携带稳定错误码和退出码。 */
export class CliError extends Error {
  public readonly code: string;
  public readonly exitCode: CliExitCode;
  public readonly details: Readonly<Record<string, unknown>>;
  public constructor(input: {
    readonly code: string;
    readonly message: string;
    readonly exitCode: CliExitCode;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = 'CliError';
    this.code = input.code;
    this.exitCode = input.exitCode;
    this.details = input.details ?? {};
  }
  /** 将异常转换为稳定的 CLI 错误载荷。 */
  public body(): CliErrorBody {
    return { code: this.code, message: this.message, details: this.details };
  }
}
