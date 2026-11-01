/** 通用资源引用检查输入；具体业务身份、事件例外与任务前缀由所有者提供。 */
export interface ResourceReferenceSubject {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly executionAliases: readonly string[];
  readonly versionIds: readonly string[];
  readonly streamType: string;
  readonly ignoredEventType: string;
  readonly ignoredReasonCode: string;
  readonly broadTaskPrefixes: readonly string[];
}

/** 同连接同步引用保护参与者，只读取自己拥有的数据，不执行外部调用。 */
export interface ResourceReferenceReader {
  isReferenced(subject: ResourceReferenceSubject): boolean;
}
