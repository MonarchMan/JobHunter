# JobHunter 上手指南

JobHunter 是一个运行在本机的个人求职工作台。它把简历、企业官网职位、匹配结果和后台任务放在同一个界面里，让你不用在招聘网站、表格和零散笔记之间来回切换。

如果你第一次接触这个项目，建议先完成最小配置并打开 Web 工作台。模型服务和受控浏览器都可以稍后再配置，不会妨碍你了解主要界面。

## 1. 你可以用它做什么

一条典型的使用路径是：

1. 导入简历，检查系统整理出的结构化个人资料。
2. 确认目标岗位后，从已支持的企业官网同步职位。
3. 在职位列表中按公司、地点和类别筛选，并查看匹配依据。
4. 从任务页面了解同步、解析或匹配是否完成，以及失败后如何恢复。

所有个人数据默认保存在项目根目录的 `var/` 中，Web 服务默认只监听本机地址 `127.0.0.1`。

## 2. 十分钟启动

### 2.1 准备环境

| 环境                     | 版本或建议                               | 是否必需 | 用途                                                       |
| ------------------------ | ---------------------------------------- | -------- | ---------------------------------------------------------- |
| Node.js                  | `24.x`                                   | 必需     | 运行 CLI、Worker、Web 和项目脚本                           |
| pnpm                     | `11.x`                                   | 必需     | 安装依赖并执行 workspace 命令                              |
| Microsoft Edge 或 Chrome | 使用仍受支持的稳定版本，可自动探测       | 可选     | 采集需要真实浏览器的动态招聘来源                           |
| Playwright Chromium      | 使用项目当前 Playwright 版本对应的浏览器 | 可选     | 没有可用系统浏览器时作为采集运行时，也用于浏览器自动化测试 |

Edge、Chrome 和 Playwright Chromium 不需要全部安装。只浏览已有数据或使用普通 HTTP 来源时，可以暂不准备浏览器；需要动态页面采集或浏览器测试时，至少保证其中一种可用。

先确认 Node.js 和 pnpm 版本：

```shell
node --version
pnpm --version
```

### 2.2 安装与配置

在项目根目录执行：

macOS / Linux：

```bash
pnpm install
cp .env.example .env
```

Windows PowerShell：

```powershell
pnpm install
Copy-Item .env.example .env
```

刚开始使用时不必填写模型密钥。默认配置已经把数据目录指向 `./var`，该目录不会提交到 Git。

### 2.3 初始化工作区

```shell
pnpm --filter @jobhunter/cli build
node apps/cli/dist/main.js init
node apps/cli/dist/main.js doctor
```

`init` 可以重复运行，不会反复创建相同数据。`doctor` 会检查数据目录、数据库和关键配置；如果它给出错误，先根据提示修复，再启动 Web。

### 2.4 打开工作台

```shell
pnpm --filter @jobhunter/web dev
```

浏览器访问 [http://127.0.0.1:3210/](http://127.0.0.1:3210/)。启动器会同时运行 Web 和一个独立 Worker，因此正常使用时不需要再开第二个 Worker。

如果 3210 端口已被占用，可以临时换一个端口：

macOS / Linux：

```bash
PORT=3211 pnpm --filter @jobhunter/web dev
```

Windows PowerShell：

```powershell
$env:PORT='3211'
pnpm --filter @jobhunter/web dev
```

## 3. 完成第一次求职流程

### 3.1 建立个人资料

进入“个人资料”，导入 PDF、DOCX、JPEG 或 PNG 简历。导入会立即创建后台任务；解析完成后，逐项检查基本信息、教育经历、工作经历、项目、专业技能等内容，再确认目标岗位。

目标岗位不仅用于展示，也决定后续同步和匹配的范围。如果来源同步按钮不可用，通常是因为这里还没有确认可识别的目标岗位类别。

### 3.2 同步招聘来源

进入“来源”，先选择一家已启用的公司进行同步。同步是异步任务，页面不需要一直停留在加载状态；可以前往“任务”查看进度。

部分企业官网使用动态页面，需要受控浏览器才能读取。遇到登录、验证码或访问限制时，JobHunter 会停止本次采集并保留已有数据，不会尝试绕过网站限制。

### 3.3 筛选和判断职位

进入“职位”，可以按关键词、公司、招聘类别、职位类别、地点和状态缩小范围。职位标题会打开企业官网详情页；评分结果用于辅助判断，不替代你对岗位要求和申请条件的确认。

### 3.4 查看任务状态

简历解析、来源同步和匹配都由 Worker 执行。“任务”页面会显示等待、运行、完成或失败状态。失败时先阅读页面提供的恢复建议；浏览器或来源底层错误的脱敏详情会记录在 `var/logs/jobhunter.log`。

## 4. 按需启用模型能力

只有简历画像、岗位理解、润色或匹配建议等模型任务需要模型服务。编辑 `.env`，填写 OpenAI 兼容配置：

```dotenv
JOBHUNTER_MODEL_PROVIDER=openai-compatible
JOBHUNTER_MODEL_BASE_URL=https://your-model-endpoint/v1
JOBHUNTER_MODEL_API_KEY=your-api-key
JOBHUNTER_MODEL_NAME=your-model-name
```

使用 Anthropic 原生 Messages API 时：

```dotenv
JOBHUNTER_MODEL_PROVIDER=anthropic
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_MODEL=your-claude-model
```

`ANTHROPIC_BASE_URL` 留空时使用官方地址。修改配置后重启 Web，使 Web 与 Worker 使用同一份环境变量。

不要把 `.env`、密钥、简历或 `var/` 中的运行数据提交到版本库。

## 5. 浏览器来源无法运行时

JobHunter 会自动探测 Windows 和 macOS 常见位置中的 Edge 或 Chrome。Linux 默认使用 Playwright Chromium；其他平台在没有可用系统浏览器时也可以安装它：

```shell
pnpm exec playwright install chromium
```

浏览器安装在非标准位置时，在 `.env` 中指定：

```dotenv
JOBHUNTER_BROWSER_EXECUTABLE=/absolute/path/to/browser
```

仍然无法启动时，依次检查：

1. `node apps/cli/dist/main.js doctor` 是否通过。
2. 指定路径是否指向真实的浏览器可执行文件。
3. `var/logs/jobhunter.log` 中是否存在经过脱敏的启动错误。
4. 官网是否要求登录、验证码或暂时限制访问。

## 6. 需要命令行时

Web 工作台适合日常使用；CLI 更适合诊断、脚本和批量导出。常见入口如下：

```shell
# 查看完整帮助
node apps/cli/dist/main.js --help

# 查看来源和任务
node apps/cli/dist/main.js source list
node apps/cli/dist/main.js task list --status pending,running --limit 20

# 同步单个来源并等待结果
node apps/cli/dist/main.js source sync tencent-social --wait

# 导出职位
node apps/cli/dist/main.js job export "exports/jobs.csv" --format csv --bom
```

参数顺序、画像维护、备份恢复和退出码说明见 [CLI 指南](./cli.md)。

## 7. 开发者验证

修改代码后，至少运行与变更范围匹配的检查：

```shell
pnpm format:check
pnpm typecheck
pnpm test
pnpm docs:check
```

需要完整检查时执行 `pnpm check`。浏览器端到端测试和依赖边界等专项命令可从根目录 `package.json` 查询。

## 8. 继续了解项目

- [CLI 指南](./cli.md)：命令参数、JSON 输出、备份和恢复。
- [总体架构](./arch/overall-arch.md)：进程职责、模块边界和数据流。
- [SDD 开发流程](./sdd/README.md)：规格、设计、任务与验收规则。
- [功能规格索引](../specs/README.md)：当前能力及实现状态。
- [招聘来源支持矩阵](../packages/sources/SUPPORT_MATRIX.md)：各企业来源的覆盖范围与限制。
