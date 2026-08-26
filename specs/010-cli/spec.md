# 010 CLI 规格

> 状态：Implemented
> 依赖：002–009, 012

## 目标

在 Web 管理台之前提供完整、可脚本化的个人使用入口，覆盖初始化、同步、简历、画像、匹配、查询、任务和运维。

## 功能需求

- **CLI-001**：`jh init` 必须创建数据目录、数据库、迁移和幂等 seed，并输出下一步指引。
- **CLI-002**：`jh source list|status|sync` 必须列出来源、健康、最近运行并手动入队单个/全部来源同步。
- **CLI-003**：`jh worker start` 必须启动 Worker，支持优雅关闭和可读状态输出。
- **CLI-004**：`jh job list|show|export` 必须支持关键词、公司、状态、地点、细分职位类别、最低分和稳定分页。
- **CLI-005**：`jh resume import`、`jh profile show|history|set|lock|unlock` 必须覆盖导入、画像查看和人工维护。
- **CLI-006**：`jh match score|list|show` 必须支持单个具体职位评分、任务状态、分项证据和建议；不得提供全量批量匹配入口。
- **CLI-007**：`jh task list|show|retry|cancel` 必须提供任务运维能力。
- **CLI-008**：`jh doctor` 和 `jh backup create|verify|restore` 必须暴露开发/运行自检与备份流程。
- **CLI-009**：所有读命令必须支持 `--json`，stdout 只输出机器结果，日志和进度写 stderr。
- **CLI-010**：危险删除/恢复命令必须先 dry-run；真正执行要求显式 `--confirm`，不得交互式误触。
- **CLI-011**：同步、单职位匹配等耗时命令默认只入队并返回 task ID；显式 `--wait` 才轮询结果且可取消等待而不取消任务。
- **CLI-012**：退出码必须稳定：0 成功、2 用法/配置、3 未找到、4 部分成功/来源退化、5 任务最终失败、1 未分类内部错误。

## 质量需求

- **CLI-Q01**：CLI 只调用应用层，不直接使用 Drizzle 或来源适配器。
- **CLI-Q02**：帮助文本必须给出默认值、单位和危险操作说明。
- **CLI-Q03**：中文为首期默认人类输出；JSON 字段与错误码保持英文稳定标识。
- **CLI-Q04**：Windows PowerShell 和常见 POSIX shell 中路径参数都必须正确处理。

## 验收场景

1. 空目录执行 init 两次，第二次幂等成功且不覆盖配置。（CLI-001）
2. source sync 返回 task ID，`--wait` 最终以同步结果决定退出码。（CLI-002,011,012）
3. job list 人类输出为表格，`--json` stdout 是可解析 JSON 且无日志混入。（CLI-004,009）
4. closed 职位默认不展示，显式状态筛选可查看。（CLI-004）
5. profile lock 后 history 显示新版本和锁定路径。（CLI-005）
6. restore 未提供 confirm 时只展示影响并不修改文件。（CLI-008,010）
7. 不存在 ID 返回退出码 3 和稳定错误 JSON。（CLI-012）

## 未决问题

无。
