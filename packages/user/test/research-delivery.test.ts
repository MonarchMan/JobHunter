import { afterEach, expect, it } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NodeResearchDelivery } from '../src/persistence/research-delivery.js';

const roots: string[] = [];
const id = '018f0000-0000-7000-8000-00000000d001';
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** 使用真实文件系统验证交付边界，不调用外部模型。 */
it('publishes bounded result files atomically and rejects symlinks, directories and oversize data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'jh-research-delivery-'));
  roots.push(root);
  const delivery = new NodeResearchDelivery(root);
  await delivery.write(id, Buffer.from('{"ok":true}'));
  expect(Buffer.from(await delivery.read(id)).toString()).toBe('{"ok":true}');
  expect(() => delivery.location('../outside')).toThrow();
  await expect(delivery.write(id, Buffer.alloc(2 * 1024 * 1024 + 1))).rejects.toThrow();
  await rm(delivery.location(id));
  const outside = path.join(root, 'outside.json');
  await writeFile(outside, '{}');
  await symlink(outside, delivery.location(id));
  await expect(delivery.read(id)).rejects.toThrow();
  await rm(path.dirname(delivery.location(id)), { recursive: true });
  await symlink(root, path.dirname(delivery.location(id)));
  await expect(delivery.read(id)).rejects.toThrow();
});
