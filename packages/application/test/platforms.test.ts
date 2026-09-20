import { expect, it, vi } from 'vitest';
import { PlatformError } from '@jobhunter/platform-core';
import { BossPlatformService, type PlatformRepository } from '../src/platforms.js';

it('retains CDP after request failure, freezes actions, and closes on explicit disconnect or shutdown', async () => {
  let generation = 0;
  const repository: PlatformRepository = {
    reset: () => ++generation,
    generation: () => generation,
    setStatus: vi.fn(),
    save: () => 'unused',
  };
  const disconnect = vi.fn();
  const readNext = vi.fn().mockRejectedValue(new PlatformError('access_blocked', 37));
  const provider = { connect: vi.fn().mockResolvedValue({ disconnect, readNext }) };
  const service = new BossPlatformService(provider, repository);
  const signal = new AbortController().signal;
  const connect = {
    action: 'connect' as const,
    portFile: '/profile/DevToolsActivePort',
    targetId: 'valid',
  };
  // 1、失败后只冻结，不释放授权或自动重连，重复调用不再访问上游。
  await service.execute(connect, 'task', signal);
  await expect(
    service.execute({ action: 'next', generation }, 'task', signal),
  ).rejects.toMatchObject({ category: 'access_blocked' });
  await expect(
    service.execute({ action: 'next', generation }, 'task', signal),
  ).rejects.toMatchObject({ category: 'session_unavailable' });
  expect(readNext).toHaveBeenCalledTimes(1);
  expect(provider.connect).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  // 2、用户断开、替换及 Worker 退出均释放连接；重复 close 无额外操作。
  await service.execute({ action: 'disconnect', generation }, 'task', signal);
  expect(disconnect).toHaveBeenCalledTimes(1);
  await service.execute(connect, 'task', signal);
  await service.execute(connect, 'task', signal);
  expect(disconnect).toHaveBeenCalledTimes(2);
  service.close();
  service.close();
  expect(disconnect).toHaveBeenCalledTimes(3);
});
