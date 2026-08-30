import type { ReactElement } from 'react';

export default function AgentRunNotFound(): ReactElement {
  return (
    <main id="main-content" className="error-state" tabIndex={-1}>
      <h1>找不到这次 Agent 运行</h1>
      <p>运行记录可能已被清理，或链接地址不正确。</p>
      <a className="button-secondary" href="/tasks">
        返回任务与 Agent 运行
      </a>
    </main>
  );
}
