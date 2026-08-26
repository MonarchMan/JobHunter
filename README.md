# JobHunter

JobHunter 是一个面向个人求职场景的本地招聘数据与岗位匹配工作台，包含：

- 企业官网招聘来源适配器与职位同步
- 本地 SQLite 数据存储
- 简历导入与候选人画像
- 岗位查询、匹配与导出
- CLI 命令行工具
- Web 管理台
- 可选的 OpenAI 兼容模型服务

项目默认只在本机运行，数据保存在 `./var`，不会自动部署到公网。

## 环境要求

- Node.js `24.x`
- pnpm `11.x`
- Windows、macOS 或 Linux

检查版本：

```powershell
node --version
pnpm --version
```

## 安装与配置

在项目根目录执行：

```powershell
pnpm install
Copy-Item .env.example .env
```

然后按需编辑 `.env`：

```dotenv
JOBHUNTER_DATA_ROOT=./var
JOBHUNTER_LOG_LEVEL=info

# OpenAI 兼容模型服务，三项也可以直接使用 BASE_URL/API_KEY/MODEL
BASE_URL=https://your-model-endpoint/v1
API_KEY=your-api-key
MODEL=your-model-name
```

模型配置是可选的。只有执行简历画像、岗位理解或匹配建议等模型任务时才需要填写。API Key 只放在本地 `.env`，不要提交到 Git。

初始化本地数据目录：

```powershell
pnpm --filter @jobhunter/cli build
node apps/cli/dist/main.js init
node apps/cli/dist/main.js doctor
```

初始化会幂等执行以下后台准备工作：如果存在 `docs/resumes/agent简历 - 新.docx`，将其导入并创建画像提取任务；为启用的十个官网来源创建职位同步任务；建立每日来源刷新和每周清理计划。真正的解析、官网请求和匹配由 Worker 异步执行。

如果 `pnpm exec jh` 尚未建立命令链接，也可以先运行：

```powershell
pnpm install
pnpm --filter @jobhunter/cli build
```

## 启动项目

开发时只需启动 Web 管理台；Web 启动器会自动拉起一个独立的 Worker 子进程。Worker 与 Next.js 使用相同的本地配置和数据库，但各自承担后台任务与页面服务。

### 1. 启动 Web 管理台

```powershell
pnpm --filter @jobhunter/web dev
```

Web 管理台默认入口：

<http://127.0.0.1:3210/>

主要页面包括：

- `/`：工作台首页
- `/jobs`：职位列表
- `/sources`：招聘来源与同步管理
- `/profile`：简历画像
- `/tasks`：后台任务
- `/agent-runs`：模型运行记录

可以通过环境变量修改本地监听端口：

```powershell
$env:PORT='3211'
pnpm --filter @jobhunter/web dev
```

Web 服务默认只允许绑定 loopback 地址；不建议将它直接暴露到局域网或公网。

### 单独启动 Worker（可选）

Worker 负责执行职位同步、简历画像、匹配等耗时任务：

```powershell
node apps/cli/dist/main.js worker start
```

正常使用 Web 时不需要手动执行这一步；只有在不启动 Web、需要单独运行后台队列，或进行 Worker 调试时，才使用 CLI 启动 Worker。不要在 Web 已运行时再启动第二个 Worker，以免多个进程同时领取任务。

启动 Web 后，可以直接在 Web 的“来源”页面发起同步，任务会由自动拉起的 Worker 异步执行。

Web 的“个人资料”页面也支持直接导入 PDF、DOCX 简历。上传后页面立即返回后台任务状态；请保持 Worker 运行，等待画像提取和岗位匹配完成。

### 3. 手动同步招聘来源

查看来源：

```powershell
node apps/cli/dist/main.js source list
```

同步单个来源并等待结果：

```powershell
node apps/cli/dist/main.js source sync tencent-social --wait
```

同步所有默认启用来源：

```powershell
node apps/cli/dist/main.js source sync --all --wait
```

来源同步依赖官网匿名访问条件。遇到验证码、登录或访问阻断时，系统会安全停止本次同步，并保留已有职位数据。

## 常用 CLI 操作

```powershell
# 导入简历
node apps/cli/dist/main.js resume import "docs/resumes/your-resume.docx"

# 查看职位
node apps/cli/dist/main.js job list --limit 20
node apps/cli/dist/main.js job list --company baidu --location 北京 --limit 20

# 查看任务
node apps/cli/dist/main.js task list --status pending,running --limit 20

# 运行匹配
node apps/cli/dist/main.js match run <profileId> --wait
node apps/cli/dist/main.js match list <profileId> --include-stale --limit 20

# 导出职位
node apps/cli/dist/main.js job export "exports/jobs.csv" --format csv --bom

# 查看完整帮助
node apps/cli/dist/main.js --help
```

更完整的 CLI 说明见 [docs/cli.md](docs/cli.md)。

## 开发与验证

```powershell
# 类型检查
pnpm typecheck

# 单元测试
pnpm test

# 集成测试
pnpm test:integration

# Web 浏览器测试
pnpm test:e2e

# 文档检查
pnpm docs:check

# 常规检查集合
pnpm check
```

在线招聘来源测试默认关闭。需要显式启用时，使用：

```powershell
$env:JOBHUNTER_ONLINE_SOURCES='1'
$env:JOBHUNTER_BROWSER_ONLINE_SOURCE='dewu'
pnpm test:online
```

浏览器来源选择器支持 `alibaba`、`bytedance`、`dewu`、`huawei`；每次在线 Smoke 最多采集两页。在线测试可能受官网限流、验证码和网络状态影响，不属于默认离线测试。

## 目录结构

```text
apps/
  cli/       CLI 入口
  worker/    后台任务与浏览器基础设施
  web/       Web 管理台
packages/
  domain/    领域模型与规则
  application/ 应用用例与端口
  db/        SQLite 持久化
  sources/   企业招聘来源适配器
  source-core/ 来源契约、HTTP 与浏览器端口
  llm/       OpenAI 兼容模型客户端
specs/       SDD 规格、设计与任务
docs/        架构、CLI 与 ADR 文档
var/         本地运行数据，不提交版本库
```

## 数据与安全

- `.env`、SQLite 数据库、简历和运行数据只保存在本地，不要提交到版本库。
- 招聘来源适配器遵守来源访问限制，不伪造登录状态、验证码或风控参数。
- Web 管理台默认绑定 `127.0.0.1`，仅供本机使用。
- 执行备份和恢复前请先停止 Worker 与 Web，详细流程见 [docs/cli.md](docs/cli.md)。
