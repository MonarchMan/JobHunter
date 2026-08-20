import { contentHash, DomainError, type ContentHash } from '../shared/index.js';
import { candidateProfileSchema, type CandidateProfileData } from './profile.js';

type MutableJsonObject = Record<string, unknown>;

export interface ProfileMergeDecision {
  readonly effective: CandidateProfileData;
  readonly contentHash: ContentHash;
  readonly lockedPaths: readonly string[];
  readonly ignoredLockedPaths: readonly string[];
}

function isObject(value: unknown): value is MutableJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeObjects(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) return structuredClone(override);
  const result: MutableJsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? mergeObjects(result[key], value) : structuredClone(value);
  }
  return result;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith('/') || pointer.endsWith('/') || pointer.includes('//')) {
    throw new DomainError('PROFILE_LOCK_INVALID', 'Locked paths must be canonical JSON Pointers.', {
      pointer,
    });
  }
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function readPointer(
  root: unknown,
  segments: readonly string[],
): { found: boolean; value?: unknown } {
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) return { found: false };
      const index = Number(segment);
      if (index >= current.length) return { found: false };
      current = current[index];
    } else if (isObject(current)) {
      if (!(segment in current)) return { found: false };
      current = current[segment];
    } else {
      return { found: false };
    }
  }
  return { found: true, value: current };
}

function writePointer(
  root: MutableJsonObject,
  segments: readonly string[],
  value: unknown,
): boolean {
  let current: MutableJsonObject | unknown[] = root;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      if (Array.isArray(current)) {
        if (!/^(0|[1-9]\d*)$/.test(segment)) return false;
        const arrayIndex = Number(segment);
        if (arrayIndex >= current.length) return false;
        current[arrayIndex] = structuredClone(value);
      } else {
        current[segment] = structuredClone(value);
      }
      return true;
    }
    const next: unknown = Array.isArray(current)
      ? /^(0|[1-9]\d*)$/.test(segment)
        ? current[Number(segment)]
        : undefined
      : current[segment];
    if (!isObject(next) && !Array.isArray(next)) return false;
    current = next;
  }
  return false;
}

export function mergeProfileVersion(
  previous: CandidateProfileData | null,
  extracted: CandidateProfileData,
  lockedPaths: readonly string[],
  manualOverrides: Readonly<Record<string, unknown>> = {},
): ProfileMergeDecision {
  const effective = mergeObjects(extracted, manualOverrides);
  if (!isObject(effective)) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Profile merge must produce an object.');
  }

  const normalizedLocks = [...new Set(lockedPaths)].toSorted();
  const ignoredLockedPaths: string[] = [];
  for (const pointer of normalizedLocks) {
    const segments = pointerSegments(pointer);
    const previousValue = readPointer(previous, segments);
    if (!previousValue.found || !writePointer(effective, segments, previousValue.value)) {
      ignoredLockedPaths.push(pointer);
    }
  }

  const parsed = candidateProfileSchema.parse(effective);
  return {
    effective: parsed,
    contentHash: contentHash(parsed, [
      '/targetRoles',
      '/preferences/locations',
      '/preferences/companySizes',
      '/preferences/employmentTypes',
      '/preferences/excludedTerms',
      '/domains',
    ]),
    lockedPaths: normalizedLocks,
    ignoredLockedPaths,
  };
}
