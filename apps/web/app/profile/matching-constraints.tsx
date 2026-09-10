'use client';

import { canonicalJobSubfamilies, type CandidateProfileData } from '@jobhunter/domain';
import type { ReactElement } from 'react';
import { SelectField } from '../components/select-field.js';

/** 用户确认的资格事实；空值表示未知，不根据当前日期自动推断。 */
type Constraints = NonNullable<CandidateProfileData['matchingConstraints']>;

const emptyConstraints: Constraints = {
  targetSubfamily: null,
  graduationYear: null,
  studentStatus: null,
  internshipDaysPerWeek: null,
  internshipMonths: null,
  availableFrom: null,
};

/** 在既有整份简历保存流程中编辑可选匹配事实，渲染不修改旧画像。 */
export function MatchingConstraintsFields({
  value,
  onChange,
}: {
  readonly value: CandidateProfileData['matchingConstraints'];
  readonly onChange: (value: Constraints) => void;
}): ReactElement {
  const facts = value ?? emptyConstraints;
  const yearInvalid =
    facts.graduationYear !== null &&
    (!Number.isInteger(facts.graduationYear) ||
      facts.graduationYear < 1900 ||
      facts.graduationYear > 2200);
  const monthsInvalid =
    facts.internshipMonths !== null && (facts.internshipMonths < 0 || facts.internshipMonths > 60);
  return (
    <>
      <label>
        细分岗位（可选）
        <SelectField
          name="targetSubfamily"
          label="细分岗位（可选）"
          value={facts.targetSubfamily ?? ''}
          options={[
            { value: '', label: '不限 / 待确认' },
            ...canonicalJobSubfamilies.map((item) => ({ value: item, label: item })),
          ]}
          onValueChange={(value) => {
            onChange({ ...facts, targetSubfamily: value || null });
          }}
        />
      </label>
      <label>
        学籍 / 应届身份
        <SelectField
          name="studentStatus"
          label="学籍 / 应届身份"
          value={facts.studentStatus ?? ''}
          options={[
            { value: '', label: '待确认' },
            { value: 'student', label: '在读（非应届）' },
            { value: 'graduating', label: '在读（应届）' },
            { value: 'fresh_graduate', label: '已毕业（应届身份）' },
            { value: 'graduated', label: '已毕业（非应届）' },
          ]}
          onValueChange={(value) => {
            onChange({
              ...facts,
              studentStatus: value ? (value as Constraints['studentStatus']) : null,
            });
          }}
        />
      </label>
      <label>
        毕业届别（年份）
        <input
          type="number"
          min="1900"
          max="2200"
          step="1"
          aria-invalid={yearInvalid}
          aria-describedby={yearInvalid ? 'matching-year-error' : undefined}
          value={facts.graduationYear ?? ''}
          onChange={(event) => {
            onChange({
              ...facts,
              graduationYear: event.currentTarget.value ? Number(event.currentTarget.value) : null,
            });
          }}
        />
        {yearInvalid && (
          <span id="matching-year-error" className="risk">
            请输入 1900～2200 之间的整数年份。
          </span>
        )}
      </label>
      <label>
        每周可实习天数
        <SelectField
          name="internshipDaysPerWeek"
          label="每周可实习天数"
          value={facts.internshipDaysPerWeek == null ? '' : String(facts.internshipDaysPerWeek)}
          options={[
            { value: '', label: '待确认' },
            ...[1, 2, 3, 4, 5, 6, 7].map((days) => ({
              value: String(days),
              label: `${String(days)} 天`,
            })),
          ]}
          onValueChange={(value) => {
            onChange({ ...facts, internshipDaysPerWeek: value ? Number(value) : null });
          }}
        />
      </label>
      <label>
        可持续实习月数
        <input
          type="number"
          min="0"
          max="60"
          step="0.5"
          aria-invalid={monthsInvalid}
          aria-describedby={monthsInvalid ? 'matching-months-error' : undefined}
          value={facts.internshipMonths ?? ''}
          onChange={(event) => {
            onChange({
              ...facts,
              internshipMonths: event.currentTarget.value
                ? Number(event.currentTarget.value)
                : null,
            });
          }}
        />
        {monthsInvalid && (
          <span id="matching-months-error" className="risk">
            请输入 0～60 之间的实习月数。
          </span>
        )}
      </label>
      <label>
        最早可到岗日期
        <input
          type="date"
          value={facts.availableFrom ?? ''}
          onChange={(event) => {
            onChange({ ...facts, availableFrom: event.currentTarget.value || null });
          }}
        />
      </label>
    </>
  );
}
