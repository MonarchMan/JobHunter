import { Buffer } from 'node:buffer';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { WritableCredentialVault } from '@jobhunter/mail-core';

const idleTimeoutMs = 60_000;

const credentialWorker = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class JobHunterCredentialApi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("Advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL Credential, uint Flags);
  [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string TargetName, int Type, int Flags, out IntPtr Credential);
  [DllImport("Advapi32.dll", EntryPoint="CredFree", SetLastError=true)]
  public static extern void CredFree(IntPtr Buffer);
  [DllImport("Advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string TargetName, int Type, int Flags);
}
"@

while (($line = [Console]::In.ReadLine()) -ne $null) {
  $requestId = $null
  try {
    $payload = $line | ConvertFrom-Json
    $requestId = [string]$payload.id
    $value = $null
    switch ([string]$payload.operation) {
      'ping' { $value = 'ready' }
      'put' {
        $bytes = [Text.Encoding]::UTF8.GetBytes([string]$payload.value)
        $pointer = [Runtime.InteropServices.Marshal]::AllocCoTaskMem($bytes.Length)
        try {
          [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
          $credential = New-Object JobHunterCredentialApi+CREDENTIAL
          $credential.Type = 1
          $credential.TargetName = [string]$payload.target
          $credential.CredentialBlobSize = $bytes.Length
          $credential.CredentialBlob = $pointer
          $credential.Persist = 2
          $credential.UserName = 'JobHunter'
          if (-not [JobHunterCredentialApi]::CredWrite([ref]$credential, 0)) { throw 'write_failed' }
        } finally {
          [Runtime.InteropServices.Marshal]::FreeCoTaskMem($pointer)
        }
        $value = 'ok'
      }
      'get' {
        $credentialPointer = [IntPtr]::Zero
        if (-not [JobHunterCredentialApi]::CredRead([string]$payload.target, 1, 0, [ref]$credentialPointer)) {
          throw 'read_failed'
        }
        try {
          $item = [Runtime.InteropServices.Marshal]::PtrToStructure(
            $credentialPointer,
            [type]'JobHunterCredentialApi+CREDENTIAL'
          )
          $bytes = New-Object byte[] $item.CredentialBlobSize
          [Runtime.InteropServices.Marshal]::Copy(
            $item.CredentialBlob,
            $bytes,
            0,
            $item.CredentialBlobSize
          )
          $value = [Convert]::ToBase64String($bytes)
        } finally {
          [JobHunterCredentialApi]::CredFree($credentialPointer)
        }
      }
      'revoke' {
        if (-not [JobHunterCredentialApi]::CredDelete([string]$payload.target, 1, 0)) {
          $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
          if ($errorCode -ne 1168) { throw 'delete_failed' }
        }
        $value = 'ok'
      }
      default { throw 'invalid_operation' }
    }
    [Console]::Out.WriteLine((@{ id = $requestId; ok = $true; value = $value } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ id = $requestId; ok = $false } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
  $payload = $null
  $value = $null
  $bytes = $null
  $credential = $null
  $item = $null
  $line = $null
}
`;

type CredentialOperation =
  | { readonly operation: 'ping' }
  | { readonly operation: 'put'; readonly target: string; readonly value: string }
  | { readonly operation: 'get'; readonly target: string }
  | { readonly operation: 'revoke'; readonly target: string };

interface CredentialWorkerResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly value?: string;
}

interface PendingCredentialOperation {
  readonly id: string;
  readonly resolve: (value: string) => void;
  readonly reject: (error: Error) => void;
}

/**
 * Windows Credential Manager 适配器。
 * 复用单个空闲超时的 PowerShell 辅助进程，避免每次查看授权码都重复支付进程启动成本。
 */
export class WindowsCredentialVault implements WritableCredentialVault {
  #child: ChildProcessByStdio<Writable, Readable, null> | null = null;
  #lines: ReadlineInterface | null = null;
  #pending: PendingCredentialOperation | null = null;
  #queue: Promise<void> = Promise.resolve();
  #idleTimer: NodeJS.Timeout | null = null;
  #nextRequestId = 0;

  /** 只预热本机 API 辅助进程，不读取或缓存任何凭据值。 */
  public async warmUp(): Promise<void> {
    await this.#enqueue({ operation: 'ping' });
  }

  /** 将邮箱连接秘密写入 Windows Credential Manager。 */
  public async put(ref: string, values: Readonly<Record<string, string>>): Promise<void> {
    this.#assertPlatform();
    await this.#enqueue({
      operation: 'put',
      target: this.#target(ref),
      value: JSON.stringify(values),
    });
  }

  /** 从 Windows Credential Manager 读取一条邮箱连接秘密。 */
  public async get(ref: string): Promise<Readonly<Record<string, string>>> {
    this.#assertPlatform();
    const result = await this.#enqueue({ operation: 'get', target: this.#target(ref) });
    try {
      const value = JSON.parse(Buffer.from(result, 'base64').toString('utf8')) as unknown;
      if (!value || typeof value !== 'object') throw new Error('invalid');
      return Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === 'string' && typeof entry[1] === 'string',
        ),
      );
    } catch {
      throw new Error('Credential is unavailable.');
    }
  }

  /** 从 Windows Credential Manager 撤销一条邮箱连接秘密。 */
  public async revoke(ref: string): Promise<void> {
    this.#assertPlatform();
    await this.#enqueue({ operation: 'revoke', target: this.#target(ref) });
  }

  /** 主动关闭辅助进程；未完成操作会以固定错误失败。 */
  public close(): void {
    this.#stopWorker(new Error('Credential helper closed.'));
  }

  #assertPlatform(): void {
    if (process.platform !== 'win32') throw new Error('Windows Credential Manager is required.');
  }

  #target(ref: string): string {
    if (!/^os:jobhunter\/mail\/[A-Za-z0-9._-]+$/.test(ref))
      throw new Error('Invalid mailbox credential reference.');
    return `JobHunter/mail/${ref.slice('os:jobhunter/mail/'.length)}`;
  }

  /** 串行化请求，确保每一行响应都能与唯一的当前操作对应。 */
  #enqueue(operation: CredentialOperation): Promise<string> {
    this.#assertPlatform();
    const result = this.#queue.then(() => this.#exchange(operation));
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 向已预热的辅助进程发送单个操作，并等待一行结构化响应。 */
  async #exchange(operation: CredentialOperation): Promise<string> {
    // 1、确保辅助进程存在；2、登记唯一待处理请求；3、写入不含日志输出的单行命令。
    const child = this.#ensureWorker();
    this.#clearIdleTimer();
    const id = String(++this.#nextRequestId);
    return new Promise<string>((resolve, reject) => {
      this.#pending = { id, resolve, reject };
      child.stdin.write(`${JSON.stringify({ id, ...operation })}\n`, 'utf8', (error) => {
        if (!error) return;
        this.#stopWorker(new Error('Credential helper write failed.'));
      });
    });
  }

  /** 启动仅接受本进程标准输入的隐藏 PowerShell 辅助进程。 */
  #ensureWorker(): ChildProcessByStdio<Writable, Readable, null> {
    if (this.#child) return this.#child;
    const encoded = Buffer.from(credentialWorker, 'utf16le').toString('base64');
    const executable = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    const child = spawn(
      executable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true },
    );
    const lines = createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY });
    this.#child = child;
    this.#lines = lines;
    lines.on('line', (line) => {
      this.#handleLine(line);
    });
    child.once('error', () => {
      this.#stopWorker(new Error('Credential helper failed to start.'));
    });
    child.once('exit', () => {
      if (this.#child === child)
        this.#stopWorker(new Error('Credential helper exited unexpectedly.'), false);
    });
    child.stdin.on('error', () => {
      this.#stopWorker(new Error('Credential helper input failed.'));
    });
    return child;
  }

  /** 校验辅助进程响应，并在操作完成后安排自动退出。 */
  #handleLine(line: string): void {
    const pending = this.#pending;
    if (!pending) return;
    let response: CredentialWorkerResponse;
    try {
      response = JSON.parse(line) as CredentialWorkerResponse;
    } catch {
      this.#stopWorker(new Error('Credential helper returned invalid data.'));
      return;
    }
    if (response.id !== pending.id) {
      this.#stopWorker(new Error('Credential helper response mismatch.'));
      return;
    }
    this.#pending = null;
    if (response.ok && typeof response.value === 'string') pending.resolve(response.value);
    else pending.reject(new Error('Credential operation failed.'));
    this.#scheduleIdleStop();
  }

  /** 空闲一段时间后释放辅助进程，避免长期占用系统资源。 */
  #scheduleIdleStop(): void {
    this.#clearIdleTimer();
    this.#idleTimer = setTimeout(() => {
      this.#stopWorker(new Error('Credential helper idle timeout.'));
    }, idleTimeoutMs);
    this.#idleTimer.unref();
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = null;
  }

  /** 清理流和进程；仅在需要时终止仍存活的辅助进程。 */
  #stopWorker(error: Error, terminate = true): void {
    this.#clearIdleTimer();
    const child = this.#child;
    this.#child = null;
    this.#lines?.close();
    this.#lines = null;
    const pending = this.#pending;
    this.#pending = null;
    pending?.reject(error);
    if (terminate && child && !child.killed) child.kill();
  }
}
