import { describe, expect, it } from 'vitest';
import { makeCandidateProfile } from '@jobhunter/user/testing';
import {
  buildProfileSnapshot,
  jobAnalysisAgentDefinition,
  parseJobAnalysisOutput,
} from '../src/agents/job-analysis-agent.js';

const facts = {
  requiredSkills: [],
  preferredSkills: [],
  minimumYearsExperience: null,
  seniority: null,
  domains: [],
};
/** 验证统一输出边界，不接受关闭块被偷偷生成或开启块缺失。 */
describe('job analysis output sections', () => {
  it.each([false, true])('validates score=%s with both advice switch values', (score) => {
    for (const advice of [false, true]) {
      const input = {
        title: '工程师',
        description: '开发平台',
        experienceText: null,
        educationText: null,
        recruitmentCategory: 'social' as const,
        profile: buildProfileSnapshot(makeCandidateProfile()),
        outputs: { understanding: score, match: score, advice },
        instructions: '按开关生成',
      };
      const output = {
        understanding: score ? facts : null,
        match: score ? { score: 80, reasons: ['方向匹配'] } : null,
        advice: advice ? { highlights: [], gaps: [], preparation: ['准备项目案例'] } : null,
      };
      expect(parseJobAnalysisOutput(output, input)).toEqual(output);
      expect(() =>
        parseJobAnalysisOutput(
          { ...output, advice: advice ? null : { highlights: [], gaps: [], preparation: [] } },
          input,
        ),
      ).toThrow();
      if (score)
        expect(() =>
          parseJobAnalysisOutput(
            {
              ...output,
              understanding: {
                ...facts,
                requiredSkills: [
                  {
                    value: 'Python',
                    evidence: [{ field: 'description', quote: '不存在的 Python' }],
                  },
                ],
              },
            },
            input,
          ),
        ).toThrow(/evidence/);
    }
    expect(jobAnalysisAgentDefinition.key).toBe('job-analysis');
    expect(jobAnalysisAgentDefinition.tools).toEqual([]);
  });
});
