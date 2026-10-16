# 030 招聘日程日历设计

> 状态：Draft
> 对应规格：[spec.md](./spec.md)

## 1. 设计结论

日历是 `ApplicationEvent` 的只读投影，不是新的事实来源。邮件分类结果使用统一 `schedule` 值对象，高频查询字段同步写入 `application_events` 类型化列；`payload_json` 只保留审计和非查询详情。

面试改期采用替换语义：分类器提取新安排以及可选原安排，投影层用原安排定位当前日程后直接更新为新时间。原日程不会作为“已改期”项目继续展示。

## 2. 时间结构

```ts
interface RecruitmentScheduleFact {
  activityType: 'interview' | 'written_exam' | 'assessment';
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

1. `assessment_invited` 允许笔试和测评活动；在线编程、算法题和 Coding Test 均归为 `written_exam`。
2. 面试邀请、改期和取消只能使用 `interview`。
3. 其他事件必须返回 `schedule: null`。
4. 改期的新时间来自当前正文；引用历史只可帮助识别原时间。
5. 取消事件不得产生新的有效开始时间。
6. 未明确结束时间时保持空值，禁止补默认时长。

应用边界继续验证证据、URL、决策阈值，并额外验证事件类型与活动类型、时间顺序、精度及时区来源的一致性。

## 4. 版本与迁移

- Agent 版本升级为 `recruitment-mail.classify@v3`，Prompt 升级为 `v5-written-exam`，输出 Schema 升级为 `v3`；该版本删除 `coding_test` 并要求模型把在线代码题统一输出为 `written_exam`。
- Worker 任务类型仍为 `mail.classify@v1`，但策略版本包含新 Agent 和 Prompt 版本，使内容版本相同的邮件可以按新策略安全重跑。
- 新申请事件同时写入 `schedule` 对象和类型化列。迁移只从统一 `schedule` 结构回填新字段，不兼容旧分类格式；需要时允许重新分类或重建本地数据。
- 移除 `coding_test` 活动类型并直接重建 `application_events`；旧日程事实不做兼容转换，由招聘邮件按新 Agent 版本重新分类生成。

## 5. 投影与查询

日程按申请和邮件接收时间重放，事件序号只用于同刻稳定排序，避免历史邮件并发处理顺序改变事实先后。邀请创建条目，同一申请、同一时间槽的面试通知复用稳定条目；改期依次按原时间、阶段、唯一活动或新时间槽定位目标，沿用稳定条目 ID 并替换为新时间；取消移除目标。改期和取消事件本身不展示。

应用层日期范围查询按 IANA 时区把本地起止日期转换为 UTC 半开区间，同时直接比较仅日期字段。Web Schema 输出 ISO 时间和 `YYYY-MM-DD` 本地日期，不暴露旧日程状态。

Web 查询在响应边界按当前时间派生时间状态。截止字段与活动开始/结束字段过去后统一产生 `completed`；仅日期事项按用户时区的本地日期比较。该状态只描述日历时间是否已过去，不写回事件事实，也不推断用户是否实际参加或提交。

## 6. 工作台展示

不新增独立日历页面。工作台在“工作台概览”上方服务端加载当前月及未来 90 天日程，缩略卡片展示当前月和最近 5 项安排。详情使用原生 `dialog`：桌面端为月历与日期详情双栏，窄屏改为全屏纵向布局；月份切换通过 `/api/calendar` 按需读取，跨月日期点击同步更新可见月份，并支持活动类型筛选、时间状态标识、Esc 关闭和焦点返回。
