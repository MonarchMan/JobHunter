import type { CliIo } from './io.js';
import type { CliErrorBody, CommandResult } from './model.js';
export interface CliRenderer {
  success(result: CommandResult): void;
  failure(error: CliErrorBody): void;
}
export class JsonRenderer implements CliRenderer {
  readonly #io: CliIo;
  public constructor(io: CliIo) {
    this.#io = io;
  }
  public success(result: CommandResult): void {
    this.#io.stdout.write(`${JSON.stringify({ ok: true, data: result.data })}\n`);
  }
  public failure(error: CliErrorBody): void {
    this.#io.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  }
}
export class HumanRenderer implements CliRenderer {
  readonly #io: CliIo;
  public constructor(io: CliIo) {
    this.#io = io;
  }
  public success(result: CommandResult): void {
    this.#io.stdout.write(`${result.human.trimEnd()}\n`);
  }
  public failure(error: CliErrorBody): void {
    this.#io.stderr.write(`错误 [${error.code}]：${error.message}\n`);
  }
}
