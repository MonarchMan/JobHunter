# ADR-0003：独立 Worker 与 SQLite 持久化队列

- 状态：Accepted
- 日期：2026-08-19

## 决策

采集、模型调用和批量匹配由独立 Worker 执行；任务和计划持久化在 SQLite，不引入 Redis。任务使用幂等键和带心跳的租约领取。

## 原因

耗时工作不应阻塞 CLI 或后续 HTTP 请求。进程内定时器无法在重启后恢复，而 Redis 对个人部署属于不必要依赖。

## 后果

任务 Handler 必须幂等，领取事务必须短小，默认单 Worker。迁移 PostgreSQL 后需要替换领取 SQL，但任务协议保持稳定。
