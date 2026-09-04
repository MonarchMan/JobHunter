import type { CliIo } from './io.js';
import type { CliErrorBody, CommandResult } from './model.js';
/** 模块数据结构或契约。 */
export interface CliRenderer {
  success(result: CommandResult): void;
  failure(error: CliErrorBody): void;
}
/** 机器消费场景的 JSON 渲染器。 */
export class JsonRenderer implements CliRenderer {
  readonly #io: CliIo;
  public constructor(io: CliIo) {
    this.#io = io;
  }
  public success(result: CommandResult): void {
    this.#io.stdout.write(`${JSON.stringify({ ok: true, data: result.data })}\n`);
  }
  /** 执行模块组件对外暴露的操作。 */
  public failure(error: CliErrorBody): void {
    this.#io.stdout.write(`${JSON.stringify({ ok: false, error })}\n`);
  }
}
/** 终端交互场景的简洁文本渲染器。 */
export class HumanRenderer implements CliRenderer {
  readonly #io: CliIo;
  public constructor(io: CliIo) {
    this.#io = io;
  }
  public success(result: CommandResult): void {
    this.#io.stdout.write(`${result.human.trimEnd()}\n`);
  }
  /** 执行模块组件对外暴露的操作。 */
  public failure(error: CliErrorBody): void {
    this.#io.stderr.write(`错误 [${error.code}]：${error.message}\n`);
  }
}
