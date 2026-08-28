# 019 非 supported 官网渠道闭环任务

> 状态：In Progress
> 显式覆盖：SSR-001, SSR-002, SSR-003, SSR-004, SSR-005, SSR-006, SSR-007, SSR-008, SSR-009, SSR-010, SSR-011

- [x] **SSR-T001** 建立 29 个非 supported 逻辑渠道基线与统一晋级门禁。（SSR-001, SSR-002, SSR-003, SSR-005, SSR-006）
- [x] **SSR-T002** 闭环 9 个 experimental 渠道的独立首页/末页定向 smoke 并晋级。（SSR-002, SSR-004, SSR-005, SSR-008, SSR-009）
- [x] **SSR-T003** 实现可由现有官网协议拆分的 blocked 渠道。（SSR-002, SSR-004, SSR-007, SSR-009）
- [ ] **SSR-T004** 实现需要新匿名浏览器或新协议的 blocked 渠道；当前仅剩拼多多社招。（SSR-002, SSR-003, SSR-007, SSR-009）
- [x] **SSR-T005** 为网易互联网、游戏、雷火三个校招物理来源分别实现与门禁。（SSR-007, SSR-009）
- [x] **SSR-T006** 更新 catalog、Registry、seed、Web/CLI 摘要与支持矩阵。（SSR-008）
- [ ] **SSR-T007** 运行 45 渠道同轮 2–3 页首页/末页 smoke 及完整离线回归，证明 45 / 0 / 0。（SSR-010）
- [ ] **SSR-T008** 完成拼多多社招 `anti_content` 签名运行时 Spike：固定 bundle 证据，验证逐请求 token、浏览器依赖和隔离运行边界；若不可稳定抽离，则以普通 Chrome + Playwright CDP 实现 fallback。（SSR-003, SSR-011）

## 基线

- 2026-08-28：16 supported、9 experimental、20 blocked；共 45 个逻辑渠道。
- 2026-08-28：直接 HTTP 在线门禁 9 通过、2 失败；`xiaomi.intern` 与网易混合协议返回访问验证页面。
- 2026-08-28：受控浏览器在线门禁 7/7 通过；其中部分仅为两页诊断或共享协议证据，不能直接代替独立渠道全量门禁。
- 2026-08-28：京东社招能采集真实职位，但 18 页中存在 4 个重复 requirement ID，当前正确报告 partial，尚不晋级。
- 2026-08-28：腾讯校招从 `join.qq.com` 分离 `projectMappingId=1`，103 个应届岗位、2 页、唯一 postId、详情与归一化在线门禁通过；基线收敛为 17 supported / 9 experimental / 19 blocked。
- 2026-08-28：百度社招以独立 `baidu.social` 适配器完成 SOCIAL 匿名 JSON 的 1,639 个岗位、82 页全量门禁；基线收敛为 18 supported / 9 experimental / 18 blocked。
- 2026-08-28：美团校招以 `jobType=1` 采集 185 个正式岗位；官网允许单页 200 条，从而避开跨页移动造成的重复 ID，唯一 `jobUnionId`、详情与归一化门禁通过；基线收敛为 19 supported / 9 experimental / 17 blocked。
- 2026-08-28：vivo 校园官网按 `Category=3/2` 分离实习与校招，分别返回 92/164 个岗位；单页全量、唯一 UUID、岗位深链与归一化门禁通过；基线收敛为 21 supported / 9 experimental / 15 blocked。
- 2026-08-28：OPPO 校招以 Graduate 项目 30 + doctor 项目 31 返回 140 个岗位，社招 ATS API 返回 139 个岗位；两者均完成单页全量、稳定 ID、深链与归一化门禁；基线收敛为 23 supported / 9 experimental / 13 blocked。
- 2026-08-28：阿里、字节、得物实习渠道通过校园物理列表首页/末页（及中间页）smoke，小红书实习此前匿名 JSON 门禁通过；各渠道均按记录级类别筛选，样本 ID 唯一且归一化正确；基线收敛为 27 supported / 5 experimental / 13 blocked。
- 2026-08-28：京东社招首页/末页 smoke 验证总数、末页长度、样本唯一 requirementId 与归一化；全量跨页重复仍如实报告 partial，不再作为 2 页 smoke 的阻断项；基线收敛为 28 supported / 4 experimental / 13 blocked。
- 2026-08-28：小米实习、网易实习/社招改为由正常匿名浏览器捕获官网结构化 JSON，并通过首页/中间页/末页 smoke；360 社招补齐匿名详情 API；9 个 experimental 已全部收口，基线为 32 supported / 0 experimental / 13 blocked。
- 2026-08-28：小红书社招以 `recruitType=social` 独立适配，京东校招以正式计划 47/56/57/58 独立适配；两者首页/末页 smoke 的总数、边界长度、唯一 ID 与归一化均通过，基线为 34 supported / 0 experimental / 11 blocked。
- 2026-08-28：小米 `type=2/1` 分别拆为校招/社招并通过浏览器边界 smoke；华为正式校招使用无 recruitmentType 的校园列表，社招使用 `newHr` 匿名 JSON，两者边界 smoke 通过；基线为 38 supported / 0 experimental / 7 blocked。
- 2026-08-28：阿里社招、拼多多校招、得物社招、360 实习/校招及网易互联网/游戏/雷火三个校招物理来源均通过 2–3 页边界 smoke；基线为 44 supported / 0 experimental / 1 blocked。
- 2026-08-28：拼多多社招在有界面 Chrome 可取得真实列表，但默认 headless Worker 的同一官方请求返回风控错误；不绕过 `anti_content`/验证码，继续保持唯一 blocked。
- 2026-08-28：拼多多社招官网运行时声明的 `careers.pinduoduo.com`、`careers.pddglobalhr.net` 均重定向到 `careers.pddglobalhr.com`；三个官方域名没有形成独立故障域。官网 SSR、`robots.txt`、`sitemap.xml` 和 PDD Holdings 官网均未提供可替代的完整公开职位列表。
- 2026-08-28：对拼多多社招执行最终可重复性复核：同一匿名 headless 会话有限重载 5 次均返回 `400023`，三个全新 headful Chrome 会话也均返回 `400023`。无限重试或依赖偶发成功不构成 supported；需等待官网开放稳定匿名协议、提供官方替代物理来源，或明确允许受支持的认证接入方式。
- 2026-08-28：进一步隔离启动方式后确认，失败会话均由 Playwright 直接 launch；普通 Chrome 使用空白临时 profile、无 stealth、无用户 Cookie 启动时完整列表返回 200。Chrome 首屏加载后再通过 CDP 附加，连续三轮独立首页/末页/详情 smoke 均通过：`navigator.webdriver=false`，总数稳定为 798，首页 10 条、末页第 80 页 8 条，末页样本 `T013636` 的职责、要求和加分项完整。阻断点从外部风控不可达收敛为尚未工程化 session-driven driver。
- 2026-08-28：按 SSR-T008 开始签名 Spike。当前 `_app-3abf0c1e9008cfdd.js` 的原始 SHA-256 为 `40eac6ca03f3b43f56217276a7515ea4de364113c4f0b2d1f17a7ec58ccbb9e9`；请求包装器每次先取 `_stm`、更新风控实例，再调用 `messagePackSync()`。同一空白会话的两个详情请求生成 400/418 字符的不同 token，排除固定 token 重放。普通 Chrome + Playwright CDP 明确保留为 fallback。
- 2026-08-28：SSR-T008 按既定顺序完成首轮实验：webpack bridge 通过；全新 profile 的最小同源浏览器运行时通过；Node + DOM shim 因模块读取 `screen.availWidth`、继续需要伪造指纹而停止；最小 headful 与原生 `--headless=new` 各连续三轮首页/末页/详情 smoke 通过。静态 AST 抽取 bundle 后前两轮通过，第三轮及随后单轮返回 `54001`，同期完整官网 headful 页面也显示 0 个职位，判断为风险/频控窗口但不做无限重试。待冷却后仍需补静态抽取路径的三轮复核，任务与渠道保持未完成/blocked。
