import { describe, expect, it } from 'vitest';
import {
  mergeProfileVersion,
  parseCandidateProfile,
  type CandidateProfileData,
} from '../../src/domain/index.js';
/** 构造测试输入或执行断言的辅助逻辑。 */
function profile(overrides: Record<string, unknown> = {}): CandidateProfileData {
  return parseCandidateProfile({
    targetRoles: ['Agent 开发', '大模型应用'],
    preferences: {
      locations: ['北京'],
      companySizes: ['large'],
      employmentTypes: ['全职'],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [
      {
        name: 'TypeScript',
        level: 'proficient',
        evidence: [{ source: 'resume', quote: 'TypeScript 项目经验' }],
      },
    ],
    domains: ['大模型应用'],
    yearsOfExperience: 3,
    managementExperience: false,
    ...overrides,
  });
}

describe('profile version merge', () => {
  it('keeps intended roles optional and independent from job categories', () => {
    const legacy = profile({ targetRoles: ['研发'] });
    expect(legacy.intendedRoles).toBeUndefined();
    expect(legacy).not.toHaveProperty('intendedRoles');
    const corrected = mergeProfileVersion(null, legacy, [], {
      intendedRoles: [' 算法工程师 ', 'Agent 开发工程师'],
    });
    expect(corrected.effective.targetRoles).toEqual(['研发']);
    expect(corrected.effective.intendedRoles).toEqual(['算法工程师', 'Agent 开发工程师']);
    const reordered = mergeProfileVersion(null, legacy, [], {
      intendedRoles: ['Agent 开发工程师', '算法工程师'],
    });
    expect(reordered.contentHash).toBe(corrected.contentHash);
    const locked = mergeProfileVersion(corrected.effective, legacy, ['/intendedRoles']);
    expect(locked.ignoredLockedPaths).toEqual([]);
    expect(locked.effective.intendedRoles).toEqual(corrected.effective.intendedRoles);
    expect(() => profile({ intendedRoles: [' '] })).toThrow();
    expect(() => profile({ intendedRoles: '算法工程师' })).toThrow();
  });

  it('preserves parent and child locked paths while updating unlocked fields', () => {
    const previous = profile();
    const extracted = profile({
      targetRoles: ['大模型算法'],
      preferences: { ...previous.preferences, locations: ['上海'] },
      yearsOfExperience: 4,
    });
    const merged = mergeProfileVersion(previous, extracted, ['/preferences/locations']);
    expect(merged.effective.preferences.locations).toEqual(['北京']);
    expect(merged.effective.targetRoles).toEqual(['大模型算法']);
    expect(merged.effective.yearsOfExperience).toBe(4);

    const parentLocked = mergeProfileVersion(previous, extracted, ['/preferences']);
    expect(parentLocked.effective.preferences).toEqual(previous.preferences);
  });

  it('reports missing lock paths without corrupting the extracted profile', () => {
    const merged = mergeProfileVersion(profile(), profile(), ['/preferences/not-present']);
    expect(merged.ignoredLockedPaths).toEqual(['/preferences/not-present']);
    expect(merged.effective).toEqual(profile());
  });
});
