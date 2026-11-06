import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

for (const mode of ['shutdown', 'disconnect'] as const) {
  it(`reaps the owned framework process tree on parent ${mode}`, async () => {
    const server = `require('node:http').createServer((q,s)=>s.end('fixture')).listen(0,'127.0.0.1',function(){console.log('PORT:'+this.address().port)});`;
    const framework = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(server)}],{stdio:'inherit',windowsHide:true});`;
    const wrapper = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('../src/server/parent-lifetime.cjs', import.meta.url)),
        '-e',
        framework,
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true },
    );
    let output = '';
    wrapper.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    const exited = new Promise<void>((resolve) => {
      wrapper.once('exit', () => {
        resolve();
      });
    });
    try {
      const deadline = Date.now() + 15_000;
      while (!output.includes('PORT:') && Date.now() < deadline) await delay(20);
      const port = /PORT:(\d+)/u.exec(output)?.[1];
      if (!port) throw new Error('Synthetic framework failed to start');
      expect((await fetch(`http://127.0.0.1:${port}`)).status).toBe(200);
      if (mode === 'shutdown') wrapper.send('shutdown');
      else wrapper.disconnect();
      await exited;
      await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow();
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null && wrapper.connected)
        wrapper.send('shutdown');
      await exited;
    }
  }, 30_000);
}
