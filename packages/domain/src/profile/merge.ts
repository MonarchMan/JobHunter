import { contentHash, DomainError, type ContentHash } from '../shared/index.js';
import { candidateProfileSchema, type CandidateProfileData } from './profile.js';

/** 领域模型的类型约束。 */
type MutableJsonObject = Record<string, unknown>;

/** 模块数据结构或契约。 */
export interface ProfileMergeDecision {
  readonly effective: CandidateProfileData;
  readonly contentHash: ContentHash;
  readonly lockedPaths: readonly string[];
  readonly ignoredLockedPaths: readonly string[];
}

/** 判断值是否为可递归合并的 JSON 对象。 */
function isObject(value: unknown): value is MutableJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 深度合并人工覆盖值，数组和标量按覆盖值替换。 */
function mergeObjects(base: unknown, override: unknown): unknown {
  if (!isObject(base) || !isObject(override)) return structuredClone(override);
  const result: MutableJsonObject = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? mergeObjects(result[key], value) : structuredClone(value);
  }
  return result;
}

/** 将规范 JSON Pointer 拆分为可访问路径段。 */
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

/** 从旧画像读取锁定字段，找不到路径时返回未找到。 */
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

/** 将旧画像中的锁定值写回新画像，路径不存在时返回失败。 */
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

/** 执行领域校验、归一化或合并逻辑。 */
export function mergeProfileVersion(
  previous: CandidateProfileData | null,
  extracted: CandidateProfileData,
  lockedPaths: readonly string[],
  manualOverrides: Readonly<Record<string, unknown>> = {},
): ProfileMergeDecision {
  // 1、先应用人工覆盖，再按锁定路径恢复上一版本值。
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

  // 2、最后统一通过画像 Schema，并计算包含无序集合的稳定内容哈希。
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
