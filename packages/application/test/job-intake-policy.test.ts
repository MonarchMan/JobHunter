import { parseCandidateProfile, parseId, utcInstant } from '@jobhunter/domain';
import { describe, expect, it } from 'vitest';
import type {
  CandidateProfileRecord,
  CandidateProfileRepository,
  ProfileVersionRecord,
} from '../src/ports/profiles.js';
import { ProfileJobIntakePolicy } from '../src/sync/job-intake-policy.js';

const profileId = parseId('018f0000-0000-7000-8000-000000000001', 'CandidateProfile');
const versionId = parseId('018f0000-0000-7000-8000-000000000002', 'ProfileVersion');

const profileRecord: CandidateProfileRecord = {
  id: profileId,
  name: '测试画像',
  createdAt: utcInstant(1),
  updatedAt: utcInstant(1),
};

const version: ProfileVersionRecord = {
  id: versionId,
  profileId,
  versionNo: 1,
  resumeDocumentId: null,
  agentRunId: null,
  extracted: parseCandidateProfile({
    targetRoles: ['大模型算法', '大模型应用开发'],
    preferences: {
      locations: [],
      companySizes: [],
      employmentTypes: [],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [],
    domains: [],
    yearsOfExperience: null,
    managementExperience: null,
  }),
  effective: parseCandidateProfile({
    targetRoles: ['大模型算法', '大模型应用开发'],
    preferences: {
      locations: [],
      companySizes: [],
      employmentTypes: [],
      excludedTerms: [],
      remoteAccepted: null,
    },
    education: [],
    workExperience: [],
    projects: [],
    skills: [],
    domains: [],
    yearsOfExperience: null,
    managementExperience: null,
  }),
  lockedPaths: [],
  contentHash: 'a'.repeat(64) as ProfileVersionRecord['contentHash'],
  isCurrent: true,
  createdAt: utcInstant(1),
};

function repository(withProfile: boolean): CandidateProfileRepository {
  return {
    createProfile: () => profileRecord,
    listProfiles: () => (withProfile ? [profileRecord] : []),
    getProfile: () => (withProfile ? profileRecord : null),
    getCurrentVersion: () => (withProfile ? version : null),
    getVersion: () => (withProfile ? version : null),
    listVersions: () => (withProfile ? [version] : []),
    appendVersion: () => ({ kind: 'created', version }),
  };
}

describe('ProfileJobIntakePolicy', () => {
  it('accepts only the canonical R&D family for the default profile', () => {
    const policy = new ProfileJobIntakePolicy(repository(true));
    expect(policy.allowedJobFamilies()).toEqual(['研发']);
    expect(policy.accepts({ jobFamily: '研发' })).toBe(true);
    expect(policy.accepts({ jobFamily: '产品' })).toBe(false);
  });

  it('rejects every job while no current profile exists', () => {
    const policy = new ProfileJobIntakePolicy(repository(false));
    expect(policy.allowedJobFamilies()).toEqual([]);
    expect(policy.accepts({ jobFamily: '研发' })).toBe(false);
    expect(policy.isReady()).toBe(false);
  });

  it('requires an explicit target role even when the profile has R&D domains', () => {
    const emptyTargetVersion: ProfileVersionRecord = {
      ...version,
      extracted: parseCandidateProfile({
        ...version.extracted,
        targetRoles: [],
        domains: ['人工智能', '后端开发'],
      }),
      effective: parseCandidateProfile({
        ...version.effective,
        targetRoles: [],
        domains: ['人工智能', '后端开发'],
      }),
    };
    const profiles = repository(true);
    const policy = new ProfileJobIntakePolicy({
      ...profiles,
      getCurrentVersion: () => emptyTargetVersion,
      getVersion: () => emptyTargetVersion,
      listVersions: () => [emptyTargetVersion],
    });

    expect(policy.allowedJobFamilies()).toEqual([]);
    expect(policy.isReady()).toBe(false);
    expect(policy.accepts({ jobFamily: '研发' })).toBe(false);
  });
});
