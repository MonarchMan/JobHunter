export const cliExitCode = {
  success: 0,
  internal: 1,
  usage: 2,
  notFound: 3,
  partial: 4,
  taskFailed: 5,
} as const;
export type CliExitCode = (typeof cliExitCode)[keyof typeof cliExitCode];
export interface CommandResult<TData = unknown> {
  readonly data: TData;
  readonly human: string;
  readonly exitCode?: CliExitCode;
}
export interface CliErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}
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
  public body(): CliErrorBody {
    return { code: this.code, message: this.message, details: this.details };
  }
}
