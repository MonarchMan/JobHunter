import type { ProjectDossierDetail } from '../ports/interview-projects.js';
import { drillCoverageDimensions } from '@jobhunter/domain';

const coverageLabels: Readonly<Record<(typeof drillCoverageDimensions)[number], string>> = {
  background_goal: '背景与目标',
  personal_responsibility: '个人职责',
  architecture_design: '架构设计',
  key_implementation: '关键实现',
  technical_tradeoff: '技术取舍',
  data_metrics: '数据指标',
  incident_debugging: '故障与调试',
  collaboration_delivery: '协作与推进',
  security_quality: '安全与质量',
  reflection_evolution: '反思与演进',
};

function clean(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

export function renderProjectNotebook(detail: ProjectDossierDetail): string {
  const lines: string[] = [
    `# ${clean(detail.snapshot.project.name)} · 面试准备`,
    '',
    '> 本文档由 JobHunter 根据本地结构化数据生成。它是只读投影，不包含标准答案。',
    '',
    '## 简历项目快照',
    '',
    `- 角色：${detail.snapshot.project.role ? clean(detail.snapshot.project.role) : '未填写'}`,
    `- 时间：${detail.snapshot.project.startDate ?? '未填写'} ～ ${detail.snapshot.project.endDate ?? '至今/未填写'}`,
  ];
  for (const highlight of detail.snapshot.project.highlights) lines.push(`- ${clean(highlight)}`);

  for (const session of detail.sessionRecords) {
    lines.push(
      '',
      `## 拷打会话 ${session.id}`,
      '',
      `- Profile：${session.profileKey}@${session.profileVersion}`,
      `- 状态：${session.status}`,
      '',
      '### 覆盖图',
      '',
      '| 维度 | 状态 |',
      '| --- | --- |',
    );
    const coverage = detail.coverage.filter((item) => item.sessionId === session.id);
    for (const dimension of drillCoverageDimensions) {
      lines.push(
        `| ${coverageLabels[dimension]} | ${coverage.find((item) => item.dimension === dimension)?.status ?? 'unasked'} |`,
      );
    }
    const turns = detail.turns
      .filter((turn) => turn.sessionId === session.id)
      .toSorted((left, right) => left.turnNo - right.turnNo);
    for (const turn of turns) {
      lines.push('', `### 第 ${String(turn.turnNo)} 题`, '');
      lines.push(turn.question ? clean(turn.question) : `_${turn.status}_`);
      if (turn.guidanceSlots.length > 0) {
        lines.push('', `回答结构：${turn.guidanceSlots.map(clean).join(' / ')}`);
      }
      const answers = detail.answers
        .filter((answer) => answer.turnId === turn.id)
        .toSorted((left, right) => left.revisionNo - right.revisionNo);
      for (const answer of answers) {
        lines.push('', `#### 回答修订 ${String(answer.revisionNo)}`, '', clean(answer.answer));
        const items = detail.knowledgeItems.filter(
          (item) => item.sourceAnswerRevisionId === answer.id,
        );
        if (items.length > 0) {
          lines.push('', '推导记录：');
          for (const item of items) {
            lines.push(`- [${item.kind}/${item.status}] ${clean(item.statement)}`);
          }
        }
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
