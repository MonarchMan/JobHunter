<p align="center">
  <img src="apps/web/public/assets/brand/jobhunter-logo.png" alt="JobHunter Logo" width="112">
</p>

<h1 align="center">JobHunter</h1>

<p align="center">
  本地管理简历、企业官网职位、匹配判断与后台任务的个人求职工作台。
</p>

<p align="center">
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24.x-4E5FBB?logo=nodedotjs&logoColor=white">
  <img alt="pnpm 11" src="https://img.shields.io/badge/pnpm-11.x-E06C5D?logo=pnpm&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-4E5FBB?logo=typescript&logoColor=white">
  <img alt="Local first" src="https://img.shields.io/badge/data-local--first-596275">
</p>

<p align="center">
  <a href="docs/guide.md"><strong>上手指南</strong></a> ·
  <a href="docs/arch/overall-arch.md"><strong>总体架构</strong></a> ·
  <a href="packages/sources/SUPPORT_MATRIX.md"><strong>来源支持矩阵</strong></a> ·
  <a href="docs/cli.md"><strong>CLI 指南</strong></a>
</p>

JobHunter 帮助个人求职者减少重复搜索和信息整理：先从简历建立结构化资料，再同步企业官网职位，最后通过筛选和可追溯的匹配依据辅助判断。系统不会替你自动投递，最终申请仍由你在企业官网完成。

> [!IMPORTANT]
> 项目默认只在本机运行，数据保存在 `var/`，Web 服务默认监听 `127.0.0.1`。不要把 `.env`、模型密钥、真实简历或运行数据提交到版本库。

## 核心能力

| 能力             | 说明                                                         |
| ---------------- | ------------------------------------------------------------ |
| 结构化个人资料   | 导入 PDF、DOCX、JPEG 或 PNG 简历，并检查、编辑解析结果       |
| 企业官网职位同步 | 从已支持的企业招聘入口采集职位，保留来源与官网详情链接       |
| 职位筛选与评分   | 按公司、类别、地点和状态筛选，并查看与个人资料相关的匹配依据 |
| 简历制作与导出   | 编辑在线简历、预览版式并生成投递文件                         |
| 面试准备         | 围绕简历项目建立准备档案，整理个人面经和公开面试资料         |
| 任务诊断         | 跟踪同步、解析和匹配任务，查看失败原因与恢复入口             |

### 能力边界

| 场景       | JobHunter 的处理方式                                             |
| ---------- | ---------------------------------------------------------------- |
| 职位来源   | 优先读取企业公开招聘入口；遇到登录、验证码或访问限制时安全停止   |
| 浏览器采集 | 使用隔离的受控浏览器读取动态页面，不复用个人登录状态             |
| 模型调用   | 仅在明确配置后用于画像、岗位理解、润色或建议，不代替用户作出决定 |
| 职位申请   | 打开企业官网详情或投递入口，由用户自行核对并提交                 |
| 本地数据   | SQLite、简历、日志和任务状态保存在配置的数据目录中               |

## 项目架构

[![JobHunter 系统架构图](docs/arch/image/jobhunter-system.svg)](docs/arch/image/README.md)

**[打开交互版与使用说明](docs/arch/image/README.md)** · [可编辑 JSON](docs/arch/image/jobhunter.architecture.json) · [求职流程图](docs/arch/image/jobhunter-flow.svg)

支持节点详情、关联追踪、缩放平移、深浅主题和 SVG 导出。在仓库根目录运行 `pnpm architecture:serve`，然后打开 [本地交互版](http://127.0.0.1:4321/)；也可以下载生成的 HTML 离线浏览。

## 快速开始

| 环境                     | 版本或建议                     | 是否必需 |
| ------------------------ | ------------------------------ | -------- |
| Node.js                  | `24.x`                         | 必需     |
| pnpm                     | `11.x`                         | 必需     |
| Edge、Chrome 或 Chromium | 动态来源采集或浏览器测试时使用 | 可选     |
| 模型服务                 | OpenAI 兼容接口或 Anthropic    | 可选     |

```shell
pnpm install
pnpm --filter @jobhunter/cli build
node apps/cli/dist/main.js init
node apps/cli/dist/main.js doctor
pnpm --filter @jobhunter/web dev
```

然后打开 [http://127.0.0.1:3210/](http://127.0.0.1:3210/)。Web 启动器会同时启动独立 Worker，正常使用时不需要手动运行第二个 Worker。

不同系统的配置命令、模型接入、浏览器选择和首次使用流程见 **[完整上手指南](docs/guide.md)**。

## 文档导航

| 文档                                                   | 内容                             |
| ------------------------------------------------------ | -------------------------------- |
| [完整上手指南](docs/guide.md)                          | 安装、初始化、首次使用和常见问题 |
| [CLI 指南](docs/cli.md)                                | 命令参数、JSON 输出、备份和恢复  |
| [总体架构](docs/arch/overall-arch.md)                  | 进程职责、模块边界和数据流       |
| [SDD 开发流程](docs/sdd/README.md)                     | 规格、设计、任务与验收规则       |
| [功能规格索引](specs/README.md)                        | 当前能力、依赖关系和实现状态     |
| [招聘来源支持矩阵](packages/sources/SUPPORT_MATRIX.md) | 各企业来源的覆盖范围与限制       |

<details>
<summary><strong>开发者验证命令</strong></summary>

```shell
pnpm format:check
pnpm typecheck
pnpm test
pnpm docs:check
```

需要执行仓库常规检查集合时运行 `pnpm check`。

</details>
