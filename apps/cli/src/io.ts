/** 模块数据结构或契约。 */
export interface CliIo {
  readonly stdout: { write(value: string): void };
  readonly stderr: { write(value: string): void };
}
export const processCliIo: CliIo = {
  stdout: {
    write: (value) => {
      process.stdout.write(value);
    },
  },
  stderr: {
    write: (value) => {
      process.stderr.write(value);
    },
  },
};
