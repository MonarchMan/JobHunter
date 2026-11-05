# ADR-0061：同步任务分阶段合并自动评分

- 状态：Accepted
- 日期：2026-11-05

## 背景

同步后自动评分由回调对每个新增/修订职位单独入队 `match.score-job`，一次同步产生 1+N 条任务记录，任务列表被刷屏且评分进度与同步运行脱节。任务引擎没有"成功后重新入队"的正常流转路径（`reschedule` 仅失败触发并消耗重试预算），但 checkpoint 与租约恢复已能支撑阶段化执行。曾评估两个替代方案：复用 `match.score-batch`（仍是独立任务，用户否决）；新建 `packages/workflow` 编排包（与刚完成的 18→4 包合并方向相反，且无自有领域内容，否决）。

## 决策

1. `source.sync` 改为分阶段任务：阶段 A 为现有抓取发现（同步写事务提交、统计校验、来源健康判定，逻辑不变）；阶段 B 为自动评分，在 A 提交后于同一任务、同一租约内逐职位串行执行理解（含模型分）→ 加权评分 →（建议开关开启时）建议。手动入口 `match.score-job` / `match.score-batch` 保持不变。
2. 阶段进度经 `checkpoint` 实时落库（发现完成标记与逐项结果 `items[]`，与最终 `result_json` 同构且 `scoring` 为可选扩展，旧行兼容）。崩溃或重启后由 `recoverExpired` 重新领取，`retryPayload` 依据检查点跳过已完成的发现与已成功职位；无检查点时整任务重跑。不引入新任务状态。
3. 来源健康仅由阶段 A 决定；模型故障不会污染 `consecutive_failures` / `health_status`。阶段 A 成功但评分重试耗尽时整任务标记 failed，errorSummary 明示"同步已提交；评分 x/y 完成"。
4. 自动路径模型不可用或理解最终失败时降级为规则分（`requireModelScore: false`，计入 degradedCount）；手动批量维持模型失败即该项失败。`scoreEnabled` / `adviceEnabled` 分别在阶段 B 开始与每项建议子阶段前读取，开关语义与 WEB-016 解耦结论一致。
5. 边界不新建包：泛型阶段机制（逐项执行、检查点、恢复过滤）沉淀到 `common/src/tasks`；`SyncScoringStage` 端口由 recruitment 声明（依赖反转，替代并删除 `onSyncCompleted` 回调链与 `auto-scoring.ts`）；逐职位编排由 matching 从 `batch-job-score-handler` 抽取复用；装配留在 apps 入口。`source.sync` 租约保持现有 600 秒（不低于 `match.score-job` 的 300 秒，心跳续租支撑评分阶段），`taskTypeConcurrency['source.sync']` 保持现有默认 3。
6. SYNC-010 定向反转：同步任务可含评分阶段，但评分仍在同步写事务提交后执行，事务纪律与 `followupEnqueued` 统计口径不变。

## 影响与验证

规格需同步改写 SYNC-010、MCH-012 及 WEB-014/016 的任务详情展示措辞；任务详情弹窗新增评分进度区块。验证覆盖：阶段编排与开关读取时机（recruitment 单元）、逐项评分服务成功/降级/单项失败续跑/建议恢复（matching 单元）、崩溃恢复矩阵与旧 result_json 兼容（集成）、一次同步仅一条任务记录（浏览器 E2E）。风险已知并接受：任务状态混合语义（同步成功但任务可能 failed）、来源同步任务时长增至分钟级以上、抓取与评分共享重试预算。
