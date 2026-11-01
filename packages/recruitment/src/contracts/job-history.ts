/** 职位修订历史的只读公开投影，变更内容由招聘侧解析和校验。 */
export interface JobHistoryReader {
  revisions(jobId: string): readonly {
    readonly id: string;
    readonly revisionNumber: number;
    readonly changes: Record<string, unknown>;
    readonly createdAt: string;
  }[];
}
