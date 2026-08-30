import { spawn as nodeSpawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  ExternalResearchExecutor,
  ExternalResearchInput,
  ExternalResearchOutput,
} from '@jobhunter/application';
import { ExternalResearchExecutorError } from '@jobhunter/application';
import type { Readable, Writable } from 'node:stream';

export interface CodexResearchChildProcess {
  readonly pid?: number | undefined;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  once(event: 'error', listener: (error: Error) => void): this;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface CodexResearchSpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: false;
  readonly detached: boolean;
  readonly windowsHide: true;
  readonly stdio: readonly ['pipe', 'pipe', 'pipe'];
}

export type CodexResearchSpawn = (
  command: string,
  args: readonly string[],
  options: CodexResearchSpawnOptions,
) => CodexResearchChildProcess;

type ProcessStopReason = 'cancelled' | 'timeout' | 'stdout_limit' | 'stderr_limit' | 'stdin_error';

interface ProcessCompletion {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stopReason: ProcessStopReason | null;
  readonly stdout: BoundedCapture;
  readonly stderr: BoundedCapture;
}

export interface CodexLocalResearchExecutorOptions {
  readonly command?: string;
  readonly spawn?: CodexResearchSpawn;
  readonly temporaryRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly diagnosticLimitBytes?: number;
  readonly terminationGraceMs?: number;
  readonly signalProcess?: (child: CodexResearchChildProcess, signal: NodeJS.Signals) => void;
}

const maximumConfiguredOutputBytes = 16 * 1024 * 1024;
const maximumConfiguredTimeoutMs = 60 * 60_000;
const defaultDiagnosticLimitBytes = 64 * 1024;
const defaultTerminationGraceMs = 1_000;

const inheritedEnvironmentKeys = [
  'PATH',
  'HOME',
  'CODEX_HOME',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
] as const;

// The research subprocess only needs the native web-search tool. Disabling every local or
// extensible tool prevents untrusted page content from turning the user's machine into an input
// source; read-only alone limits writes but does not bound reads.
const disabledAgentFeatures = [
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode_host',
  'computer_use',
  'goals',
  'guardian_approval',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_chat',
  'in_app_dictation',
  'in_app_updates',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_plugin',
  'shell_snapshot',
  'shell_tool',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'unified_exec',
  'view_image',
  'workspace_dependencies',
] as const;

type ExecutionGateRelease = () => void;

interface ExecutionGateWaiter {
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
  readonly resolve: (release: ExecutionGateRelease) => void;
  readonly reject: (error: ExternalResearchExecutorError) => void;
}

class SingleExecutionGate {
  readonly #waiters: ExecutionGateWaiter[] = [];
  #active = false;

  public acquire(signal: AbortSignal): Promise<ExecutionGateRelease> {
    if (signal.aborted) return Promise.reject(this.#cancelled());
    if (!this.#active) {
      this.#active = true;
      return Promise.resolve(this.#releaseOnce());
    }
    return new Promise((resolve, reject) => {
      const waiter: ExecutionGateWaiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.#waiters.indexOf(waiter);
          if (index < 0) return;
          this.#waiters.splice(index, 1);
          reject(this.#cancelled());
        },
      };
      this.#waiters.push(waiter);
      signal.addEventListener('abort', waiter.onAbort, { once: true });
    });
  }

  #releaseOnce(): ExecutionGateRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#dispatch();
    };
  }

  #dispatch(): void {
    const next = this.#waiters.shift();
    if (!next) {
      this.#active = false;
      return;
    }
    next.signal.removeEventListener('abort', next.onAbort);
    if (next.signal.aborted) {
      next.reject(this.#cancelled());
      this.#dispatch();
      return;
    }
    next.resolve(this.#releaseOnce());
  }

  #cancelled(): ExternalResearchExecutorError {
    return new ExternalResearchExecutorError(
      'cancelled',
      'Codex research execution was cancelled.',
    );
  }
}

const codexExecutionGate = new SingleExecutionGate();

class BoundedCapture {
  readonly #limit: number;
  readonly #chunks: Buffer[] = [];
  #storedBytes = 0;
  #receivedBytes = 0;

  public constructor(limit: number) {
    this.#limit = limit;
  }

  public append(value: unknown): boolean {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    this.#receivedBytes += chunk.byteLength;
    const remaining = Math.max(0, this.#limit - this.#storedBytes);
    if (remaining > 0) {
      const stored = chunk.byteLength <= remaining ? chunk : chunk.subarray(0, remaining);
      this.#chunks.push(stored);
      this.#storedBytes += stored.byteLength;
    }
    return this.#receivedBytes <= this.#limit;
  }

  public get receivedBytes(): number {
    return this.#receivedBytes;
  }

  public text(): string {
    return Buffer.concat(this.#chunks, this.#storedBytes).toString('utf8');
  }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: CodexResearchSpawnOptions,
): CodexResearchChildProcess {
  return nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    shell: options.shell,
    detached: options.detached,
    windowsHide: options.windowsHide,
    stdio: [...options.stdio],
  });
}

function errorCode(error: unknown): string | null {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

function spawnError(error: unknown): ExternalResearchExecutorError {
  const code = errorCode(error);
  if (code === 'ENOENT') {
    return new ExternalResearchExecutorError(
      'missing',
      'Codex CLI is not installed or is not available on PATH.',
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new ExternalResearchExecutorError(
      'invalid_config',
      'Codex CLI cannot be executed with the current local permissions.',
    );
  }
  return new ExternalResearchExecutorError('temporary', 'Codex research process could not start.');
}

function validatePositiveInteger(value: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ExternalResearchExecutorError('invalid_config', `${name} is invalid.`);
  }
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ExternalResearchExecutorError('cancelled', 'Codex research execution was cancelled.');
  }
}

function minimalEnvironment(source: NodeJS.ProcessEnv, directory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of inheritedEnvironmentKeys) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  environment.TMPDIR = directory;
  environment.TMP = directory;
  environment.TEMP = directory;
  environment.NO_COLOR = '1';
  environment.TERM = 'dumb';
  return environment;
}

function defaultSignalProcess(
  child: CodexResearchChildProcess,
  signal: NodeJS.Signals,
  platform: NodeJS.Platform,
): void {
  if (platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process may have exited before the signal or may not own a process group.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Termination is best-effort; the exit/error event remains the source of truth.
  }
}

function classifyNonZeroExit(stderr: string): ExternalResearchExecutorError {
  if (
    /(?:unknown (?:feature|option)|unrecognized option|unexpected argument|invalid config|configuration error)/iu.test(
      stderr,
    )
  ) {
    return new ExternalResearchExecutorError(
      'invalid_config',
      'Codex CLI does not support the required restricted research configuration.',
    );
  }
  if (
    /(?:not logged in|login required|authentication|unauthorized|forbidden|\b401\b|\b403\b)/iu.test(
      stderr,
    )
  ) {
    return new ExternalResearchExecutorError(
      'invalid_config',
      'Codex CLI authentication or local configuration is unavailable.',
    );
  }
  if (
    /(?:operation not permitted|permission denied|attempt to write a readonly database|failed to (?:open|initialize) state)/iu.test(
      stderr,
    )
  ) {
    return new ExternalResearchExecutorError(
      'invalid_config',
      'Codex CLI cannot access its local authentication or state directory.',
    );
  }
  if (
    /(?:rate.?limit|temporar|timed?\s*out|network|connection|unavailable|\b429\b|\b5\d\d\b)/iu.test(
      stderr,
    )
  ) {
    return new ExternalResearchExecutorError(
      'temporary',
      'Codex research execution failed because a temporary dependency was unavailable.',
    );
  }
  return new ExternalResearchExecutorError(
    'permanent',
    'Codex research execution exited without producing a usable result.',
  );
}

async function readBoundedResult(filePath: string, maximumBytes: number): Promise<string> {
  let handle;
  try {
    handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research execution did not produce a result file.',
      );
    }
    throw new ExternalResearchExecutorError(
      'temporary',
      'Codex research result could not be opened safely.',
    );
  }
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research result is not a regular file.',
      );
    }
    if (metadata.size > maximumBytes) {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research result exceeded the configured size limit.',
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maximumBytes) {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research result exceeded the configured size limit.',
      );
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research result is not valid UTF-8.',
      );
    }
    if (!text.trim()) {
      throw new ExternalResearchExecutorError('permanent', 'Codex research result is empty.');
    }
    try {
      JSON.parse(text);
    } catch {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research result is not valid JSON.',
      );
    }
    return text;
  } finally {
    await handle.close();
  }
}

function waitForProcess(input: {
  readonly child: CodexResearchChildProcess;
  readonly prompt: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly stdoutLimitBytes: number;
  readonly stderrLimitBytes: number;
  readonly terminationGraceMs: number;
  readonly signalProcess: (child: CodexResearchChildProcess, signal: NodeJS.Signals) => void;
}): Promise<ProcessCompletion> {
  return new Promise((resolve, reject) => {
    const stdout = new BoundedCapture(input.stdoutLimitBytes);
    const stderr = new BoundedCapture(input.stderrLimitBytes);
    let settled = false;
    let stopReason: ProcessStopReason | null = null;
    let forceTimer: NodeJS.Timeout | null = null;

    const cleanup = (): void => {
      clearTimeout(timeoutTimer);
      if (forceTimer) clearTimeout(forceTimer);
      input.signal.removeEventListener('abort', onAbort);
    };
    const finish = (
      result:
        | {
            readonly kind: 'exit';
            readonly code: number | null;
            readonly signal: NodeJS.Signals | null;
          }
        | { readonly kind: 'error'; readonly error: Error },
    ): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (result.kind === 'error') {
        if (stopReason !== null && stopReason !== 'stdin_error') {
          resolve({ code: null, signal: null, stopReason, stdout, stderr });
        } else {
          reject(result.error);
        }
      } else resolve({ ...result, stopReason, stdout, stderr });
    };
    const stop = (reason: ProcessStopReason): void => {
      if (settled || stopReason !== null) return;
      stopReason = reason;
      forceTimer = setTimeout(() => {
        if (!settled) input.signalProcess(input.child, 'SIGKILL');
      }, input.terminationGraceMs);
      input.signalProcess(input.child, 'SIGTERM');
    };
    const onAbort = (): void => {
      stop('cancelled');
    };
    const timeoutTimer = setTimeout(() => {
      stop('timeout');
    }, input.timeoutMs);

    input.signal.addEventListener('abort', onAbort, { once: true });
    input.child.stdout.on('data', (chunk: unknown) => {
      if (!stdout.append(chunk)) stop('stdout_limit');
    });
    input.child.stderr.on('data', (chunk: unknown) => {
      if (!stderr.append(chunk)) stop('stderr_limit');
    });
    input.child.once('error', (error) => {
      finish({ kind: 'error', error });
    });
    input.child.once('exit', (code, signal) => {
      finish({ kind: 'exit', code, signal });
    });
    input.child.stdin.once('error', () => {
      stop('stdin_error');
    });
    if (input.signal.aborted) onAbort();
    try {
      input.child.stdin.end(input.prompt, 'utf8');
    } catch {
      stop('stdin_error');
    }
  });
}

export class CodexLocalResearchExecutor implements ExternalResearchExecutor {
  public readonly key = 'codex-local' as const;
  public readonly version = 'v1' as const;
  public readonly capabilitySummary = Object.freeze({
    liveWebSearch: true,
    sandbox: 'web-search-only-local-process' as const,
  });

  readonly #command: string;
  readonly #spawn: CodexResearchSpawn;
  readonly #temporaryRoot: string;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #platform: NodeJS.Platform;
  readonly #diagnosticLimitBytes: number;
  readonly #terminationGraceMs: number;
  readonly #signalProcess: (child: CodexResearchChildProcess, signal: NodeJS.Signals) => void;

  public constructor(options: CodexLocalResearchExecutorOptions = {}) {
    this.#command = options.command?.trim() ?? 'codex';
    if (!this.#command) {
      throw new ExternalResearchExecutorError('invalid_config', 'Codex command is empty.');
    }
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#temporaryRoot = path.resolve(options.temporaryRoot ?? tmpdir());
    this.#environment = options.environment ?? process.env;
    this.#platform = options.platform ?? process.platform;
    this.#diagnosticLimitBytes = options.diagnosticLimitBytes ?? defaultDiagnosticLimitBytes;
    this.#terminationGraceMs = options.terminationGraceMs ?? defaultTerminationGraceMs;
    validatePositiveInteger(
      this.#diagnosticLimitBytes,
      maximumConfiguredOutputBytes,
      'Codex diagnostic limit',
    );
    validatePositiveInteger(this.#terminationGraceMs, 60_000, 'Codex termination grace period');
    this.#signalProcess =
      options.signalProcess ??
      ((child, signal) => {
        defaultSignalProcess(child, signal, this.#platform);
      });
  }

  public async execute(
    input: ExternalResearchInput,
    signal: AbortSignal,
  ): Promise<ExternalResearchOutput> {
    validatePositiveInteger(
      input.maximumOutputBytes,
      maximumConfiguredOutputBytes,
      'Codex result size limit',
    );
    validatePositiveInteger(input.timeoutMs, maximumConfiguredTimeoutMs, 'Codex timeout');
    if (!input.prompt.trim()) {
      throw new ExternalResearchExecutorError('invalid_config', 'Codex research prompt is empty.');
    }
    assertNotCancelled(signal);

    const release = await codexExecutionGate.acquire(signal);
    try {
      assertNotCancelled(signal);
      return await this.#executeExclusive(input, signal);
    } finally {
      release();
    }
  }

  async #executeExclusive(
    input: ExternalResearchInput,
    signal: AbortSignal,
  ): Promise<ExternalResearchOutput> {
    let directory: string;
    try {
      directory = await mkdtemp(path.join(this.#temporaryRoot, 'jobhunter-codex-research-'));
    } catch {
      throw new ExternalResearchExecutorError(
        'temporary',
        'Codex research workspace could not be created.',
      );
    }

    let output: ExternalResearchOutput | null = null;
    let failure: unknown = null;
    try {
      output = await this.#executeInDirectory(input, signal, directory);
    } catch (error) {
      failure = error;
    }
    try {
      await rm(directory, { recursive: true, force: true });
    } catch {
      if (failure === null) {
        failure = new ExternalResearchExecutorError(
          'temporary',
          'Codex research workspace could not be cleaned up.',
        );
      }
    }
    if (failure !== null) {
      if (failure instanceof ExternalResearchExecutorError) throw failure;
      throw spawnError(failure);
    }
    if (!output) {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research execution produced no output.',
      );
    }
    return output;
  }

  async #executeInDirectory(
    input: ExternalResearchInput,
    signal: AbortSignal,
    directory: string,
  ): Promise<ExternalResearchOutput> {
    const schemaPath = path.join(directory, 'schema.json');
    const resultPath = path.join(directory, 'result.json');
    try {
      await writeFile(schemaPath, JSON.stringify(input.outputSchema), {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch {
      throw new ExternalResearchExecutorError(
        'temporary',
        'Codex research schema could not be prepared.',
      );
    }

    const disabledFeatureArguments = disabledAgentFeatures.flatMap((feature) => [
      '--disable',
      feature,
    ]);
    const args = [
      '--search',
      '--strict-config',
      '--ask-for-approval',
      'never',
      '--config',
      'shell_environment_policy.inherit=none',
      ...disabledFeatureArguments,
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-rules',
      '--ignore-user-config',
      '--sandbox',
      'read-only',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      resultPath,
      '-C',
      directory,
      '-',
    ] as const;
    let child: CodexResearchChildProcess;
    try {
      child = this.#spawn(this.#command, args, {
        cwd: directory,
        env: minimalEnvironment(this.#environment, directory),
        shell: false,
        detached: this.#platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw spawnError(error);
    }

    let completion: ProcessCompletion;
    try {
      completion = await waitForProcess({
        child,
        prompt: input.prompt,
        signal,
        timeoutMs: input.timeoutMs,
        stdoutLimitBytes: input.maximumOutputBytes,
        stderrLimitBytes: this.#diagnosticLimitBytes,
        terminationGraceMs: this.#terminationGraceMs,
        signalProcess: this.#signalProcess,
      });
    } catch (error) {
      throw spawnError(error);
    }
    if (completion.stopReason === 'cancelled') {
      throw new ExternalResearchExecutorError(
        'cancelled',
        'Codex research execution was cancelled.',
      );
    }
    if (completion.stopReason === 'timeout') {
      throw new ExternalResearchExecutorError('temporary', 'Codex research execution timed out.');
    }
    if (completion.stopReason === 'stdout_limit' || completion.stopReason === 'stderr_limit') {
      throw new ExternalResearchExecutorError(
        'permanent',
        'Codex research process output exceeded the configured size limit.',
      );
    }
    if (completion.stopReason === 'stdin_error') {
      throw new ExternalResearchExecutorError(
        'temporary',
        'Codex research prompt could not be delivered to the local process.',
      );
    }
    if (completion.code !== 0 || completion.signal !== null) {
      throw classifyNonZeroExit(completion.stderr.text());
    }

    const bundleText = await readBoundedResult(resultPath, input.maximumOutputBytes);
    return {
      bundleText,
      externalSessionId: null,
      diagnosticSummary:
        completion.stderr.receivedBytes > 0
          ? `Codex emitted ${String(completion.stderr.receivedBytes)} bytes of diagnostic output.`
          : null,
    };
  }
}
