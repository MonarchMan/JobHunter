import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexLocalResearchExecutor,
  type CodexResearchChildProcess,
  type CodexResearchSpawn,
  type CodexResearchSpawnOptions,
} from '../src/codex-research-executor.js';

interface SpawnCapture {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: CodexResearchSpawnOptions;
  readonly child: FakeChild;
  prompt: string;
  schema: unknown;
}

class FakeChild extends EventEmitter implements CodexResearchChildProcess {
  public readonly pid: number | undefined = 987_654_321;
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killedSignals: NodeJS.Signals[] = [];

  public kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killedSignals.push(signal);
    return true;
  }
}

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'jobhunter-codex-executor-test-'));
  temporaryRoots.push(directory);
  return directory;
}

function argumentAfter(args: readonly string[], key: string): string {
  const index = args.indexOf(key);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) throw new Error(`Missing ${key} process argument.`);
  return value;
}

function input(
  overrides: Partial<Parameters<CodexLocalResearchExecutor['execute']>[0]> = {},
): Parameters<CodexLocalResearchExecutor['execute']>[0] {
  return {
    requestId: '018f0000-0000-7000-8000-000000000024',
    prompt: 'Research public interview experiences and return JSON.',
    outputSchema: { type: 'object', additionalProperties: false },
    maximumOutputBytes: 1_024,
    timeoutMs: 2_000,
    ...overrides,
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function successfulSpawn(
  bundleText: string,
  onCapture: (capture: SpawnCapture) => void,
): CodexResearchSpawn {
  return (command, args, options) => {
    const child = new FakeChild();
    const capture: SpawnCapture = {
      command,
      args: [...args],
      options,
      child,
      prompt: '',
      schema: null,
    };
    child.stdin.on('data', (chunk: Buffer) => {
      capture.prompt += chunk.toString('utf8');
    });
    child.stdin.once('finish', () => {
      void (async () => {
        capture.schema = JSON.parse(
          await readFile(argumentAfter(args, '--output-schema'), 'utf8'),
        ) as unknown;
        await writeFile(argumentAfter(args, '--output-last-message'), bundleText, 'utf8');
        child.stdout.end('final response captured');
        child.stderr.end();
        onCapture(capture);
        child.emit('exit', 0, null);
      })().catch((error: unknown) => {
        child.emit('error', error instanceof Error ? error : new Error('Fixture failed.'));
      });
    });
    return child;
  };
}

describe('CodexLocalResearchExecutor', () => {
  it('uses the constrained command, stdin prompt, minimal environment and isolated files', async () => {
    const root = await temporaryRoot();
    let capture: SpawnCapture | null = null;
    const bundle = JSON.stringify({ requestFingerprint: 'a'.repeat(64), experiences: [] });
    const executor = new CodexLocalResearchExecutor({
      command: '/fixture/codex',
      temporaryRoot: root,
      platform: 'darwin',
      environment: {
        PATH: '/fixture/bin',
        HOME: '/Users/fixture',
        CODEX_HOME: '/Users/fixture/.codex',
        LANG: 'en_US.UTF-8',
        JOBHUNTER_MODEL_API_KEY: 'must-not-be-inherited',
      },
      spawn: successfulSpawn(bundle, (value) => {
        capture = value;
      }),
    });

    const result = await executor.execute(input(), new AbortController().signal);
    const launched = capture as SpawnCapture | null;
    if (!launched) throw new Error('Expected the Codex fixture process to launch.');
    const schemaPath = argumentAfter(launched.args, '--output-schema');
    const resultPath = argumentAfter(launched.args, '--output-last-message');

    expect(launched.command).toBe('/fixture/codex');
    expect(launched.args).toEqual([
      '--search',
      '--strict-config',
      '--ask-for-approval',
      'never',
      '--config',
      'shell_environment_policy.inherit=none',
      '--disable',
      'apps',
      '--disable',
      'auth_elicitation',
      '--disable',
      'browser_use',
      '--disable',
      'browser_use_external',
      '--disable',
      'browser_use_full_cdp_access',
      '--disable',
      'code_mode_host',
      '--disable',
      'computer_use',
      '--disable',
      'goals',
      '--disable',
      'guardian_approval',
      '--disable',
      'hooks',
      '--disable',
      'image_generation',
      '--disable',
      'in_app_browser',
      '--disable',
      'in_app_chat',
      '--disable',
      'in_app_dictation',
      '--disable',
      'in_app_updates',
      '--disable',
      'multi_agent',
      '--disable',
      'plugin_sharing',
      '--disable',
      'plugins',
      '--disable',
      'remote_plugin',
      '--disable',
      'shell_snapshot',
      '--disable',
      'shell_tool',
      '--disable',
      'skill_mcp_dependency_install',
      '--disable',
      'skill_search',
      '--disable',
      'tool_call_mcp_elicitation',
      '--disable',
      'tool_suggest',
      '--disable',
      'unified_exec',
      '--disable',
      'view_image',
      '--disable',
      'workspace_dependencies',
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
      launched.options.cwd,
      '-',
    ]);
    expect(launched.options).toMatchObject({
      cwd: path.dirname(schemaPath),
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(launched.options.env).toMatchObject({
      PATH: '/fixture/bin',
      HOME: '/Users/fixture',
      CODEX_HOME: '/Users/fixture/.codex',
      LANG: 'en_US.UTF-8',
      TMPDIR: launched.options.cwd,
      TMP: launched.options.cwd,
      TEMP: launched.options.cwd,
      NO_COLOR: '1',
      TERM: 'dumb',
    });
    expect(launched.options.env).not.toHaveProperty('JOBHUNTER_MODEL_API_KEY');
    expect(launched.prompt).toBe(input().prompt);
    expect(launched.schema).toEqual(input().outputSchema);
    expect(result).toEqual({
      bundleText: bundle,
      externalSessionId: null,
      diagnosticSummary: null,
    });
    await expect(access(launched.options.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('maps a missing executable to a safe missing error and removes its workspace', async () => {
    const root = await temporaryRoot();
    const directories: string[] = [];
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      spawn: (_command, _args, options) => {
        directories.push(options.cwd);
        const child = new FakeChild();
        queueMicrotask(() => {
          child.emit(
            'error',
            Object.assign(new Error('contains a private executable path'), { code: 'ENOENT' }),
          );
        });
        return child;
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'missing',
      message: 'Codex CLI is not installed or is not available on PATH.',
    });
    const directory = directories[0];
    if (!directory) throw new Error('Expected an isolated directory.');
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when Codex cannot enforce the required restricted configuration', async () => {
    const root = await temporaryRoot();
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      spawn: () => {
        const child = new FakeChild();
        child.stdin.resume();
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.end('error: unknown feature shell_tool');
          child.emit('exit', 2, null);
        });
        return child;
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'invalid_config',
      message: 'Codex CLI does not support the required restricted research configuration.',
    });
  });

  it('reports an inaccessible Codex state directory as a local configuration error', async () => {
    const root = await temporaryRoot();
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      spawn: () => {
        const child = new FakeChild();
        child.stdin.resume();
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.end('failed to open state DB: attempt to write a readonly database');
          child.emit('exit', 1, null);
        });
        return child;
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'invalid_config',
      message: 'Codex CLI cannot access its local authentication or state directory.',
    });
  });

  it('rejects an oversized result file without returning untrusted content', async () => {
    const root = await temporaryRoot();
    const directories: string[] = [];
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      spawn: successfulSpawn(JSON.stringify({ value: 'x'.repeat(100) }), (capture) => {
        directories.push(capture.options.cwd);
      }),
    });

    await expect(
      executor.execute(input({ maximumOutputBytes: 32 }), new AbortController().signal),
    ).rejects.toMatchObject({
      category: 'permanent',
      message: 'Codex research result exceeded the configured size limit.',
    });
    const directory = directories[0];
    if (!directory) throw new Error('Expected an isolated directory.');
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('terminates the process group on cancellation and escalates to SIGKILL', async () => {
    const root = await temporaryRoot();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    let launched: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      launched = resolve;
    });
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      terminationGraceMs: 5,
      spawn: () => {
        launched?.();
        return child;
      },
      signalProcess: (_process, signal) => {
        signals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      },
    });
    const controller = new AbortController();
    const execution = executor.execute(input(), controller.signal);
    await started;
    controller.abort();

    await expect(execution).rejects.toMatchObject({ category: 'cancelled' });
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('times out and kills a process that does not stop after SIGTERM', async () => {
    const root = await temporaryRoot();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      terminationGraceMs: 5,
      spawn: () => child,
      signalProcess: (_process, signal) => {
        signals.push(signal);
        if (signal === 'SIGKILL') queueMicrotask(() => child.emit('exit', null, 'SIGKILL'));
      },
    });

    await expect(
      executor.execute(input({ timeoutMs: 10 }), new AbortController().signal),
    ).rejects.toMatchObject({
      category: 'temporary',
      message: 'Codex research execution timed out.',
    });
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('bounds captured process output and terminates on overflow', async () => {
    const root = await temporaryRoot();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      diagnosticLimitBytes: 8,
      spawn: () => {
        queueMicrotask(() => {
          child.stderr.write('sensitive-diagnostic-that-must-not-be-returned');
        });
        return child;
      },
      signalProcess: (_process, signal) => {
        signals.push(signal);
        if (signal === 'SIGTERM') queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'permanent',
      message: 'Codex research process output exceeded the configured size limit.',
    });
    expect(signals).toEqual(['SIGTERM']);
  });

  it('allows only one Codex research process across executor instances in a Worker', async () => {
    const root = await temporaryRoot();
    const children: FakeChild[] = [];
    const launches: { readonly args: readonly string[]; readonly child: FakeChild }[] = [];
    const firstStarted = deferred();
    const secondStarted = deferred();
    const spawn: CodexResearchSpawn = (_command, args) => {
      const child = new FakeChild();
      children.push(child);
      launches.push({ args: [...args], child });
      if (launches.length === 1) firstStarted.resolve();
      if (launches.length === 2) secondStarted.resolve();
      child.stdin.resume();
      return child;
    };
    const firstExecutor = new CodexLocalResearchExecutor({ temporaryRoot: root, spawn });
    const secondExecutor = new CodexLocalResearchExecutor({ temporaryRoot: root, spawn });

    const first = firstExecutor.execute(input(), new AbortController().signal);
    await firstStarted.promise;
    const second = secondExecutor.execute(
      input({ requestId: '018f0000-0000-7000-8000-000000000025' }),
      new AbortController().signal,
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(launches).toHaveLength(1);

    const firstLaunch = launches[0];
    if (!firstLaunch) throw new Error('Expected the first Codex process.');
    await writeFile(
      argumentAfter(firstLaunch.args, '--output-last-message'),
      JSON.stringify({ result: 1 }),
      'utf8',
    );
    firstLaunch.child.emit('exit', 0, null);
    await first;
    await secondStarted.promise;
    expect(launches).toHaveLength(2);

    const secondLaunch = launches[1];
    if (!secondLaunch) throw new Error('Expected the second Codex process.');
    await writeFile(
      argumentAfter(secondLaunch.args, '--output-last-message'),
      JSON.stringify({ result: 2 }),
      'utf8',
    );
    secondLaunch.child.emit('exit', 0, null);
    await second;
    expect(children).toHaveLength(2);
  });
});
