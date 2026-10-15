# 030 招聘日程日历设计

> 状态：Draft
> 对应规格：[spec.md](./spec.md)

## 1. 设计结论

日历是 `ApplicationEvent` 的只读投影，不是新的事实来源。邮件分类结果使用统一 `schedule` 值对象，高频查询字段同步写入 `application_events` 类型化列；`payload_json` 只保留审计和非查询详情。

面试改期采用替换语义：分类器提取新安排以及可选原安排，投影层用原安排定位当前日程后直接更新为新时间。原日程不会作为“已改期”项目继续展示。

## 2. 时间结构

```ts
interface RecruitmentScheduleFact {
  activityType: 'interview' | 'written_exam' | 'assessment' | 'coding_test';
  scheduledStartAt: UtcInstant | null;
  scheduledEndAt: UtcInstant | null;
  deadlineAt: UtcInstant | null;
  scheduledStartLocalDate: string | null;
  scheduledEndLocalDate: string | null;
  deadlineLocalDate: string | null;
  previousScheduledStartAt: UtcInstant | null;
  previousScheduledStartLocalDate: string | null;
  timePrecision: 'exact_time' | 'date_only' | 'time_range' | 'date_range' | 'unknown';
  timezoneSource: 'explicit' | 'mailbox_default' | 'not_applicable' | 'unknown';
  timezoneText: string | null;
  stageLabel: string | null;
}
```

精确时间与本地日期字段互斥表达相应事实。日期字段使用 `YYYY-MM-DD`，避免时区换算把仅日期事项移动到前一天或后一天。

## 3. 模型提示与校验

模型必须先确定事件类型，再决定是否产生 `schedule`：

1. `assessment_invited` 允许笔试、测评和在线编程活动。
2. 面试邀请、改期和取消只能使用 `interview`。
3. 其他事件必须返回 `schedule: null`。
4. 改期的新时间来自当前正文；引用历史只可帮助识别原时间。
5. 取消事件不得产生新的有效开始时间。
6. 未明确结束时间时保持空值，禁止补默认时长。

应用边界继续验证证据、URL、决策阈值，并额外验证事件类型与活动类型、时间顺序、精度及时区来源的一致性。

## 4. 版本与迁移

- Agent 版本升级为 `recruitment-mail.classify@v2`，Prompt 升级为 `v4-schedule`，输出 Schema 升级为 `v2`。
- Worker 任务类型仍为 `mail.classify@v1`，但策略版本包含新 Agent 和 Prompt 版本，使内容版本相同的邮件可以按新策略安全重跑。
- 新申请事件同时写入 `schedule` 对象和类型化列。迁移只从统一 `schedule` 结构回填新字段，不兼容旧分类格式；需要时允许重新分类或重建本地数据。

## 5. 投影与查询

日程按申请和事件序号重放。邀请创建条目；改期依次按原时间、阶段、唯一活动定位目标，沿用稳定条目 ID 并替换为新时间；取消移除目标。改期和取消事件本身不展示。

应用层日期范围查询按 IANA 时区把本地起止日期转换为 UTC 半开区间，同时直接比较仅日期字段。Web Schema 输出 ISO 时间和 `YYYY-MM-DD` 本地日期，不暴露旧日程状态。

后续只需实现 `/calendar` 页面和工作台摘要。
