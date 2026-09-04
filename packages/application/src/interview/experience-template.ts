import type { InterviewExperienceDraft } from '@jobhunter/domain';

/** 个人面经导入与在线填写共用的模板文件名。 */
export const personalExperienceTemplateFileName = 'personal-interview-experience-v1.md';
/** 面向用户展示和下载的标准 Markdown 模板；空回答必须保持为空。 */
export const personalExperienceTemplateMarkdown = `# 个人面试经历

> 模板版本：personal-experience@v1
> 使用说明：保留标题和字段名称；没有答案时可留空，系统不会代为补写。一个文件可以继续增加“经历 2”“经历 3”。

## 经历 1

### 基本信息

- 公司：示例科技
- 岗位：后端开发工程师
- 面试阶段：一面
- 面试日期：2026-08-30
- 结果：待定
- 难度：中等
- 标签：Java、数据库、项目经历

### 问答

#### Q1

问题：请介绍一个你负责的项目，以及你在其中承担的职责。

回答：

复盘：记录当时没有讲清楚的事实、指标或取舍；不要在这里编造答案。

#### Q2

问题：遇到过什么线上问题，你如何定位并解决？

回答：

复盘：

### 过程与备注

记录面试流程、面试官追问、自己需要补充准备的内容，或无法归入具体问题的原始信息。
`;

/** 渲染单个字段，统一在线填写文档的可读格式。 */
function field(label: string, value: string | null): string {
  return `- ${label}：${value ?? ''}`;
}

/** 将结构化面经草稿转换成可再次导入的标准 Markdown。 */
export function renderPersonalExperienceMarkdown(experience: InterviewExperienceDraft): string {
  // 1、先写基本信息；2、按问题顺序写问答；3、最后写过程备注。
  const lines = [
    '# 个人面试经历',
    '',
    '> 模板版本：personal-experience@v1',
    '> 在线填写生成；系统不会补写空答案。',
    '',
    '## 经历 1',
    '',
    '### 基本信息',
    '',
    field('公司', experience.company),
    field('岗位', experience.role),
    field('面试阶段', experience.stage),
    field('面试日期', experience.occurredOn),
    field('结果', experience.outcome),
    field('难度', experience.difficulty),
    field('标签', experience.tags.join('、') || null),
    '',
    '### 问答',
    '',
  ];
  experience.questions.forEach((question, index) => {
    lines.push(
      `#### Q${String(index + 1)}`,
      '',
      `问题：${question.question}`,
      '',
      `回答：${question.answer ?? ''}`,
      '',
      `复盘：${question.reflection ?? ''}`,
      '',
    );
  });
  lines.push('### 过程与备注', '', experience.notes ?? '', '');
  return lines.join('\n');
}
