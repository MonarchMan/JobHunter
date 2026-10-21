# 031 应聘进展集中展示设计

> 状态：Ready
> 对应规格：[spec.md](./spec.md)

## 1. 数据来源

`job_applications` 是岗位申请当前投影，`application_events` 是不可变流程事实。应用层新增只读 `ApplicationProgressQueryService`，按公司名称或已关联公司 ID 分组，再按申请 ID 输出岗位卡片和事件时间线。

## 2. 流程模型

岗位流程阶段统一映射为：

```text
applied → assessment → interview → offer / closed
```

`offer_intent` 和 `offered` 归入 Offer 分支；`rejected` 和 `closed` 归入结束分支；`action_required` 作为待处理标记，不单独覆盖当前阶段。

面试轮次从 `interview_invited`、`interview_rescheduled`、`interview_cancelled` 事件派生。优先使用 `stageLabel`，同一申请中缺失标签的事件按首次出现顺序生成稳定轮次。

## 3. 页面结构

不新增独立的主导航“应聘进展”页，统一进入“我的”页面；“我的”页面通过“个人资料 / 应聘进展”两个分区切换。应聘进展分区使用公司卡片、岗位流程条和岗位详情时间线。公司卡片展示岗位数、进行中数量、待处理数量、最近更新时间；岗位详情展示阶段、面试轮次、下一项安排和事件来源链接。旧 `/profile` 与 `/applications` 路由暂时保留用于已有深链接。

工作台可通过摘要入口进入该页面；日历仍只负责时间安排，两者通过 `applicationId` 互相跳转。

## 4. 公开接口

- `GET /api/applications`：返回公司分组、岗位摘要、流程阶段和面试轮次。
- `GET /api/applications/:id`：后续用于单岗位详情和深链接；首版页面可随列表响应展开时间线。

首版先实现列表接口和页面详情展开，不引入人工修改接口。
