import { EventEmitter } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BrowserAssistedCodexResearchExecutor,
  CodexLocalResearchExecutor,
  type CodexResearchChildProcess,
  type CodexResearchSpawn,
  type CodexResearchSpawnOptions,
} from '../src/codex-research-executor.js';
import type {
  ResearchBrowserCollectedPage,
  ResearchBrowserGateway,
  ResearchBrowserGatewayOptions,
  ResearchBrowserTraceEntry,
} from '../src/research-browser-gateway.js';

/** 构造测试输入或执行断言的辅助逻辑。 */
interface SpawnCapture {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: CodexResearchSpawnOptions;
  readonly child: FakeChild;
  prompt: string;
  schema: unknown;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
class FakeChild extends EventEmitter implements CodexResearchChildProcess {
  public readonly pid: number | undefined = 987_654_321;
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly killedSignals: NodeJS.Signals[] = [];

  /** 执行测试替身或时钟的操作。 */
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

/** 构造测试输入或执行断言的辅助逻辑。 */
async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'jobhunter-codex-executor-test-'));
  temporaryRoots.push(directory);
  return directory;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function argumentAfter(args: readonly string[], key: string): string {
  const index = args.indexOf(key);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value) throw new Error(`Missing ${key} process argument.`);
  return value;
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function input(
  overrides: Partial<Parameters<CodexLocalResearchExecutor['execute']>[0]> = {},
): Parameters<CodexLocalResearchExecutor['execute']>[0] {
  return {
    requestId: '018f0000-0000-7000-8000-000000000024',
    promptVersion: 'community-research-prompt@v3',
    prompt: 'Research public interview experiences and return JSON.',
    outputSchema: { type: 'object', additionalProperties: false },
    collectionPlan: {
      version: 'community-browser-collection@v2',
      queries: ['大模型算法 面经 面试 技术问题'],
      priorityQueryCount: 0,
      relevanceTerms: ['大模型算法', '大模型'],
      maximumSources: 1,
    },
    browserPolicy: {
      allowedDomains: [],
      blockedDomains: [],
      maximumSearches: 5,
      maximumPages: 10,
      maximumReadCalls: 20,
      maximumPageCharacters: 60_000,
      maximumTotalCharacters: 300_000,
      navigationTimeoutMs: 20_000,
    },
    maximumOutputBytes: 1_024,
    timeoutMs: 2_000,
    ...overrides,
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
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

const browserSourceUrl = 'https://interviews.nowcoder.com/discuss/123456';
const browserQuestion = 'SFT 训练不稳定时如何排查和优化？';
const browserEvidence = `面试问题：${browserQuestion}`;

function browserBundle(
  evidenceExcerpt = browserEvidence,
  answerExcerpt: string | null = null,
  questionText = browserQuestion,
  sourceUrl = browserSourceUrl,
  experienceSourceUrl = sourceUrl,
): string {
  const retrievedAt = '2026-08-30T08:00:00.000Z';
  return JSON.stringify({
    schemaVersion: 'community-research-bundle@v1',
    requestFingerprint: 'a'.repeat(64),
    generatedAt: retrievedAt,
    sources: [
      {
        url: sourceUrl,
        title: '大模型算法面试经验',
        publishedAt: null,
        retrievedAt,
      },
    ],
    experiences: [
      {
        company: null,
        role: '大模型算法',
        stage: null,
        occurredAt: null,
        sourceUrl: experienceSourceUrl,
        questions: [
          {
            text: questionText,
            answerExcerpt,
            topics: ['SFT'],
            evidenceExcerpt,
          },
        ],
      },
    ],
    warnings: [],
  });
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function browserTrace(
  bodyText = `原文上下文。${browserEvidence}后续上下文。`,
): readonly ResearchBrowserTraceEntry[] {
  const occurredAt = '2026-08-30T08:00:00.000Z';
  return [
    {
      sequence: 1,
      tool: 'open',
      occurredAt,
      ok: true,
      finalUrl: browserSourceUrl,
      title: '大模型算法面试经验',
      retrievedAt: occurredAt,
    },
    {
      sequence: 2,
      tool: 'readPage',
      occurredAt,
      ok: true,
      finalUrl: browserSourceUrl,
      title: '大模型算法面试经验',
      retrievedAt: occurredAt,
      bodyText,
    },
  ];
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function fakeBrowserGateway(
  trace: readonly ResearchBrowserTraceEntry[],
  onClose: () => void,
  pages: readonly ResearchBrowserCollectedPage[] = [
    {
      query: '大模型算法 面经 面试 技术问题',
      searchRank: 1,
      finalUrl: browserSourceUrl,
      title: '大模型算法面试经验',
      retrievedAt: '2026-08-30T08:00:00.000Z',
      bodyText: `原文上下文。${browserEvidence}后续上下文。`,
      bodySha256: 'b'.repeat(64),
      bodyLength: 35,
    },
  ],
): ResearchBrowserGateway {
  return {
    url: 'http://127.0.0.1:43210/mcp',
    bearerToken: 'fixture-browser-token',
    collectPages: () => Promise.resolve(pages),
    readTrace: () => trace,
    close: () => {
      onClose();
      return Promise.resolve();
    },
  };
}

/** 构造测试输入或执行断言的辅助逻辑。 */
function configValues(args: readonly string[]): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--config') {
      const value = args[index + 1];
      if (!value) throw new Error('Expected a value after --config.');
      values.push(value);
    }
  }
  return values;
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
    expect(executor.supportedPromptVersions).toContain(input().promptVersion);
    expect(executor.capabilitySummary).toMatchObject({
      liveWebSearch: true,
      browserTools: [],
      sandbox: 'web-search-only-local-process',
    });
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

  it('still sends SIGKILL to a detached POSIX process group after its leader exits on SIGTERM', async () => {
    const root = await temporaryRoot();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    const started = deferred();
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      platform: 'darwin',
      terminationGraceMs: 5,
      spawn: () => {
        started.resolve();
        return child;
      },
      signalProcess: (_process, signal) => {
        signals.push(signal);
        if (signal === 'SIGTERM') queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
      },
    });
    const controller = new AbortController();
    const execution = executor.execute(input(), controller.signal);
    await started.promise;
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

  it('bounds captured diagnostic output and terminates on hard-limit overflow', async () => {
    const root = await temporaryRoot();
    const child = new FakeChild();
    const signals: NodeJS.Signals[] = [];
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      platform: 'darwin',
      diagnosticLimitBytes: 8,
      terminationGraceMs: 5,
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
      message: 'Codex research process diagnostic output exceeded the configured size limit.',
    });
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('keeps only a bounded diagnostic excerpt without stopping a successful process', async () => {
    const root = await temporaryRoot();
    const diagnostic = 'x'.repeat(70 * 1024);
    const bundle = JSON.stringify({ requestFingerprint: 'a'.repeat(64), experiences: [] });
    const executor = new CodexLocalResearchExecutor({
      temporaryRoot: root,
      spawn: (command, args, options) => {
        const child = new FakeChild();
        child.stdin.once('finish', () => {
          void (async () => {
            await writeFile(argumentAfter(args, '--output-last-message'), bundle, 'utf8');
            child.stderr.end(diagnostic);
            child.stdout.end();
            child.emit('exit', 0, null);
          })().catch((error: unknown) => {
            child.emit('error', error instanceof Error ? error : new Error('Fixture failed.'));
          });
        });
        expect(command).toBe('codex');
        expect(options.cwd).toContain('jobhunter-codex-research-');
        return child;
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).resolves.toMatchObject({
      bundleText: bundle,
      diagnosticSummary: `Codex emitted ${String(Buffer.byteLength(diagnostic))} bytes of diagnostic output.`,
    });
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

describe('BrowserAssistedCodexResearchExecutor', () => {
  it('collects evidence before spawning a Codex process with no browser credentials or tools', async () => {
    const root = await temporaryRoot();
    const signal = new AbortController().signal;
    let capture: SpawnCapture | null = null;
    let gatewayOptions: ResearchBrowserGatewayOptions | null = null;
    let closeCount = 0;
    const bundle = browserBundle();
    const executor = new BrowserAssistedCodexResearchExecutor({
      command: '/fixture/codex',
      temporaryRoot: root,
      platform: 'darwin',
      environment: {
        PATH: '/fixture/bin',
        HOME: '/Users/fixture',
        CODEX_HOME: '/Users/fixture/.codex',
        LANG: 'en_US.UTF-8',
        JOBHUNTER_BROWSER_MCP_TOKEN: 'stale-token-must-be-replaced',
        JOBHUNTER_MODEL_API_KEY: 'must-not-be-inherited',
      },
      startBrowserGateway: (options) => {
        gatewayOptions = options;
        return Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        );
      },
      spawn: successfulSpawn(bundle, (value) => {
        expect(closeCount).toBe(1);
        capture = value;
      }),
    });

    const result = await executor.execute(input(), signal);
    const launched = capture as SpawnCapture | null;
    if (!launched) throw new Error('Expected the Codex fixture process to launch.');

    expect(executor.version).toBe('v2');
    expect(executor.supportedPromptVersions).toEqual(['community-research-prompt@v3']);
    expect(executor.capabilitySummary).toEqual({
      liveWebSearch: false,
      browserTools: [],
      sandbox: 'isolated-evidence-local-process',
    });
    expect(gatewayOptions).toEqual({
      allowedDomains: input().browserPolicy.allowedDomains,
      blockedDomains: input().browserPolicy.blockedDomains,
      limits: {
        maximumSearches: 5,
        maximumPages: 10,
        maximumReadCalls: 20,
        maximumPageCharacters: 60_000,
        maximumTotalCharacters: 300_000,
        navigationTimeoutMs: 20_000,
      },
      signal,
    });
    expect(configValues(launched.args)).toEqual(['shell_environment_policy.inherit=none']);
    expect(launched.args).not.toContain('code_mode_host');
    expect(launched.args).toContain('shell_tool');
    expect(launched.args).toContain('unified_exec');
    expect(launched.args).not.toContain('--search');
    expect(launched.options.env).toEqual({
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
    expect(launched.prompt).toContain('Research public interview experiences and return JSON.');
    expect(launched.prompt).toContain('JobHunter 预采集证据包');
    expect(launched.prompt).toContain(browserEvidence);
    expect(JSON.stringify(launched.args)).not.toContain(browserEvidence);
    expect(JSON.stringify(launched.options.env)).not.toContain(browserEvidence);
    expect(result.bundleText).toBe(bundle);
    expect(closeCount).toBe(1);
  });

  it('rejects the frozen v2 prompt without starting a browser gateway', async () => {
    const root = await temporaryRoot();
    let startCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () => {
        startCount += 1;
        return Promise.resolve(fakeBrowserGateway(browserTrace(), () => undefined));
      },
    });

    await expect(
      executor.execute(
        input({ promptVersion: 'community-research-prompt@v2' }),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      category: 'invalid_config',
      message:
        'Codex research executor browser-assisted-codex does not support prompt community-research-prompt@v2.',
    });
    expect(startCount).toBe(0);
  });

  it('accepts a bundle only when its source and evidence are present in the browser trace', async () => {
    const root = await temporaryRoot();
    let closeCount = 0;
    const bundle = browserBundle();
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        ),
      spawn: successfulSpawn(bundle, () => undefined),
    });

    await expect(executor.execute(input(), new AbortController().signal)).resolves.toEqual({
      bundleText: bundle,
      externalSessionId: null,
      diagnosticSummary: null,
    });
    expect(closeCount).toBe(1);
  });

  it.each([
    {
      name: 'untraced source',
      trace: browserTrace().filter((entry) => entry.tool !== 'open'),
      message: 'Browser research result has no interview questions backed by this browser trace.',
    },
    {
      name: 'untraced evidence',
      trace: browserTrace('页面中没有模型所声称的证据摘要。'),
      message: 'Browser research result has no interview questions backed by this browser trace.',
    },
  ])('rejects $name and closes the browser gateway', async ({ trace, message }) => {
    const root = await temporaryRoot();
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(trace, () => {
            closeCount += 1;
          }),
        ),
      spawn: successfulSpawn(browserBundle(), () => undefined),
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'permanent',
      message,
    });
    expect(closeCount).toBe(1);
  });

  it.each([
    {
      name: 'source',
      bundle: browserBundle(browserEvidence, null, browserQuestion, 'https://placeholder.invalid'),
    },
    {
      name: 'experience source',
      bundle: browserBundle(
        browserEvidence,
        null,
        browserQuestion,
        browserSourceUrl,
        'https://placeholder.invalid',
      ),
    },
  ])('rejects a non-public $name URL as permanent browser evidence', async ({ bundle }) => {
    const root = await temporaryRoot();
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        ),
      spawn: successfulSpawn(bundle, () => undefined),
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'permanent',
      message: 'Browser research result has no interview questions backed by this browser trace.',
    });
    expect(closeCount).toBe(1);
  });

  it('clears an answer excerpt that is absent from the cited browser page', async () => {
    const root = await temporaryRoot();
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        ),
      spawn: successfulSpawn(
        browserBundle(browserEvidence, '这是模型自行补写的答案。'),
        () => undefined,
      ),
    });

    const result = await executor.execute(input(), new AbortController().signal);
    const finalized = JSON.parse(result.bundleText) as {
      readonly experiences: readonly {
        readonly questions: readonly { readonly answerExcerpt: string | null }[];
      }[];
      readonly warnings: readonly string[];
    };
    expect(finalized.experiences[0]?.questions[0]?.answerExcerpt).toBeNull();
    expect(finalized.warnings).toContainEqual(expect.stringContaining('清空 1 个'));
    expect(closeCount).toBe(1);
  });

  it('rejects a fabricated question even when its evidence excerpt exists on the page', async () => {
    const root = await temporaryRoot();
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        ),
      spawn: successfulSpawn(
        browserBundle(browserEvidence, null, '解释 PPO clipped objective 的推导。'),
        () => undefined,
      ),
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'permanent',
      message: 'Browser research result has no interview questions backed by this browser trace.',
    });
    expect(closeCount).toBe(1);
  });

  it('keeps the trace-backed subset and records deterministic pruning warnings', async () => {
    const root = await temporaryRoot();
    const bundle = JSON.parse(browserBundle()) as {
      sources: { url: string; title: string; publishedAt: null; retrievedAt: string }[];
      experiences: {
        company: null;
        role: string;
        stage: null;
        occurredAt: null;
        sourceUrl: string;
        questions: {
          text: string;
          answerExcerpt: string | null;
          topics: string[];
          evidenceExcerpt: string;
        }[];
      }[];
    };
    const validSource = bundle.sources[0];
    const validExperience = bundle.experiences[0];
    if (!validSource || !validExperience) throw new Error('Expected a valid browser fixture.');
    const untracedUrl = 'https://interviews.example.org/unread';
    bundle.sources.push({ ...validSource, url: untracedUrl });
    bundle.experiences.push({ ...validExperience, sourceUrl: untracedUrl });
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(fakeBrowserGateway(browserTrace(), () => undefined)),
      spawn: successfulSpawn(JSON.stringify(bundle), () => undefined),
    });

    const result = await executor.execute(
      input({ maximumOutputBytes: 4_096 }),
      new AbortController().signal,
    );
    const finalized = JSON.parse(result.bundleText) as {
      readonly sources: readonly { readonly url: string }[];
      readonly experiences: readonly { readonly sourceUrl: string }[];
      readonly warnings: readonly string[];
    };
    expect(finalized.sources).toEqual([expect.objectContaining({ url: browserSourceUrl })]);
    expect(finalized.experiences).toEqual([
      expect.objectContaining({ sourceUrl: browserSourceUrl }),
    ]);
    expect(finalized.warnings).toContainEqual(expect.stringContaining('未完成读取'));
  });

  it('closes the browser gateway when execution is cancelled', async () => {
    const root = await temporaryRoot();
    const child = new FakeChild();
    const started = deferred();
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      terminationGraceMs: 5,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        ),
      spawn: () => {
        child.stdin.resume();
        started.resolve();
        return child;
      },
      signalProcess: (_process, signal) => {
        if (signal === 'SIGTERM') queueMicrotask(() => child.emit('exit', null, 'SIGTERM'));
      },
    });
    const controller = new AbortController();
    const execution = executor.execute(input(), controller.signal);
    await started.promise;
    controller.abort();

    await expect(execution).rejects.toMatchObject({ category: 'cancelled' });
    expect(closeCount).toBe(1);
  });

  it('closes the browser gateway when the Codex process fails', async () => {
    const root = await temporaryRoot();
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(browserTrace(), () => {
            closeCount += 1;
          }),
        ),
      spawn: () => {
        const child = new FakeChild();
        child.stdin.resume();
        queueMicrotask(() => {
          child.stdout.end();
          child.stderr.end('network unavailable');
          child.emit('exit', 1, null);
        });
        return child;
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'temporary',
      message: 'Codex research execution failed because a temporary dependency was unavailable.',
    });
    expect(closeCount).toBe(1);
  });

  it('does not start Codex when the browser collector returns no readable pages', async () => {
    const root = await temporaryRoot();
    let spawnCount = 0;
    let closeCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve(
          fakeBrowserGateway(
            [
              {
                sequence: 1,
                tool: 'search',
                occurredAt: '2026-08-30T08:00:00.000Z',
                ok: true,
                query: '大模型算法 面经',
                resultCount: 0,
              },
            ],
            () => {
              closeCount += 1;
            },
            [],
          ),
        ),
      spawn: () => {
        spawnCount += 1;
        return new FakeChild();
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'permanent',
      message: 'The anonymous research browser found no readable public interview pages.',
    });
    expect(spawnCount).toBe(0);
    expect(closeCount).toBe(1);
  });

  it('does not start Codex when browser cleanup fails', async () => {
    const root = await temporaryRoot();
    let spawnCount = 0;
    const executor = new BrowserAssistedCodexResearchExecutor({
      temporaryRoot: root,
      startBrowserGateway: () =>
        Promise.resolve({
          ...fakeBrowserGateway(browserTrace(), () => undefined),
          close: () => Promise.reject(new Error('fixture gateway cleanup failed')),
        }),
      spawn: () => {
        spawnCount += 1;
        return new FakeChild();
      },
    });

    await expect(executor.execute(input(), new AbortController().signal)).rejects.toMatchObject({
      category: 'temporary',
      message: 'The anonymous research browser could not be cleaned up.',
    });
    expect(spawnCount).toBe(0);
  });
});
