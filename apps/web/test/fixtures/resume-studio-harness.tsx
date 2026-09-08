import { createRoot, type Root } from 'react-dom/client';
import type { ResumeDraftDetail } from '@jobhunter/application/web';
import { resumeDocumentContentSchema } from '@jobhunter/resume-template';
import { ResumeStudio } from '../../app/resume-studio/[draftId]/resume-studio.js';
import '../../app/styles.css';

let root: Root | undefined;
let detail: ResumeDraftDetail;
let mountVersion = 0;

/** 在空白内存页面挂载真实编辑器，所有请求由本地测试替身处理，不访问服务或用户资料。 */
export function mount(initial: ResumeDraftDetail): void {
  // 1、保存替身执行 Schema 和 revision 校验，模拟持久化后重开草稿。
  detail = initial;
  window.fetch = (_input, init) => {
    if (!init || init.method === 'GET')
      return Promise.resolve(Response.json({ data: { token: 'test-token' } }));
    const payload = JSON.parse(String(init.body)) as { expectedRevision: number; content: unknown };
    if (payload.expectedRevision !== detail.draft.revision)
      return Promise.resolve(Response.json({ error: { message: '版本冲突' } }, { status: 409 }));
    detail = {
      ...detail,
      draft: {
        ...detail.draft,
        content: resumeDocumentContentSchema.parse(payload.content),
        revision: detail.draft.revision + 1,
      },
    };
    return Promise.resolve(Response.json({ data: detail }));
  };
  // 2、重新挂载而非复用组件状态，验证可恢复的持久化内容。
  root ??= createRoot(document.body.appendChild(document.createElement('div')));
  root.render(<ResumeStudio key={++mountVersion} initial={initial} />);
}

/** 返回最后一次成功保存的快照。 */
export function saved(): ResumeDraftDetail {
  return detail;
}
