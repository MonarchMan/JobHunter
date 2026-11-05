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
    this.#io.stdout.write(
      `${JSON.stringify({ ok: true, data: result.data }, (_key, value: unknown) => {
        // 任务输入和执行凭证仅供运行时使用，公开诊断不输出 private_state 的内容。
        if (value && typeof value === 'object' && 'taskType' in value && 'attemptCount' in value) {
          return Object.fromEntries(
            Object.entries(value).filter(([key]) => !['payload', 'leaseOwner'].includes(key)),
          );
        }
        return value;
      })}\n`,
    );
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
