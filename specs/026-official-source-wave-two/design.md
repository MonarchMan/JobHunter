# 026 第二批官网来源扩展设计

> 状态：In Progress

## 分批交付

米哈游本轮从 jobs.mihoyo.com 官方导航独立确认社招、校招与实习分区，优先匿名 HTTP。公司协议归属 companies/mihoyo，保留 companyId 后缀 120；列表缺少职责要求时复用既有 required 详情契约，不引入新的进程或依赖方向。实现前确认 channelDetailIds/hireType/职位性质筛选及必要项目元数据，再注册实际适配器；独立首尾页/详情 smoke、离线异常和 SQLite 同步回归为交付依据。

已确认三条物理来源：social（hireType=0，不过滤性质）、intern（校园 hireType=1/jobNatures=[3]）、campus（hireType=1/jobNatures=[1]），均 channelDetailIds=[1]。jobNatures 是官网公开详情推荐列表使用的字段，已独立验证它将校园 262 拆为实习 144 与应届 118；不固定项目 ID/年份，覆盖对应性质全部在招项目。社招包括 nature=1 全职和 nature=5 第三方编制，不能用全职筛选遗漏后者，归一化保留原始 employmentType，不冒充米哈游直聘。社招入口实习筛选当前返回合法零，不注册无详情证据的占位来源；实习支持范围为校园实习专项，不声称其他独立入口已接入。

POST ats.openout.mihoyo.com/ats-portal/v1/job/list 返回 code=0/success=true、data.list/total/pageNo/pageSize；固定每页 10，严格核对回显和 nature/channelDetailIds。POST /v1/job/info 用 id、channelDetailIds、hireType 读取详情，核对 id、hireType、性质与开放 status=1。真实 description/jobRequire 必须非空，不使用 jobSummary 代替。无发布日期则 publishedAt=null，不猜测；地点直接使用 addressDetailList 的公开名称。分页采样、重复、短页、总数漂移保留 partial；健康仅首页，生产 HTTP 每分钟 12 次，详情限流复用同一 sourceKey。无浏览器或登录态依赖，不需要新 ADR。

携程采用统一官网 careers.ctrip.com 的匿名 HTTP，不需要浏览器、账号或签名。三条 required 物理来源分别为社会正式岗位（category=1/kind=1）、日常实习（category=1/kind=3）及应届校招（category=2/kind=1）。客服导航只是社招类别筛选，已包含；留用实习当前官网明确未开启，后续独立验证，不注册占位 adapter，也不宣称覆盖其他品牌或 Global Recruitment 独立站。

协议置于 companies/ctrip，渠道入口分别放入 social/intern/campus。固定官网容量 10，生产串行顺序分页，maximumPages 上限 1000；显式 first-last 用于两页 smoke。响应不回显页码，不能将请求页号当作响应证据；以各页长度、稳定总数、唯一 ID 及全量计数闭合判断 complete。采样、短页、重复、总数漂移均为 partial，保护旧岗位。健康检查仅首页，请求复用 SourceHttpClient 限流（12/min，burst=1）。

仅 head.language=zh_CN 会返回英文城市。正常官网设置固定展示偏好 Cookie `language=zh-CN`；匿名 HTTP 仅携带该常量即可返回中文，不使用任何用户、登录、追踪或风控 Cookie，不需要 c-sign。城市直接采用官网字段，避免引入不完整的人工英文城市映射。

列表与详情均为 POST /api/hrrecruit/getJobAd，成功码字符串 201。详情 condition.fromId 指定已发现职位；使用 fromId（MJ 编号）作为稳定身份和官网深链，不使用易变列表行 id。列表内联真实 requirements/duty，声明 inline；HTML 转纯文本，publishDate 按中国标准时间解释并拒绝非法日期。解析器剔除内部 HR/用户字段，逐条校验 category/kind；缺少城市保持空数组，不从职位名称猜测。独立详情 smoke 验证 fromId 与正文，不逐岗请求详情。不改变进程或依赖方向，无需新增 ADR。

本轮先建立五家公司范围并验证快手与哔哩哔哩。滴滴、携程、米哈游进入后续接入队列，不将推荐入口视为已验证接口。研究结果写入 research.md；运行原始样本写入忽略版本管理的 var/，提交 fixture 时仅保留公开职位字段。

## 验证顺序

1. 访问官方招聘入口，辨认各渠道与官网当前实际使用的 JSON 请求。
2. 优先匿名 HTTP；若需要官网初始化会话，使用正常受控浏览器，捕获公开结构化响应。
3. 请求首页，由 total 与有效 pageSize 计算末页；最多增加一页中间样本，不遍历其余列表。
4. 检查返回页码、两端总数、末页长度、样本稳定 ID 唯一性及至少一条详情的身份和字段。记录频道筛选依据，避免共享协议成功被误当成三个渠道均已通过。
5. 协议验证通过后复用现有来源契约实现；fixture 驱动离线异常测试，再使用适配器定向 smoke 验证后晋级。

## 目录与状态

滴滴本轮先验证国内官网导航中的社招、实习、校招，国际站作为独立范围记录，不隐含已覆盖。优先复用匿名 JSON/已有浏览器传输，协议确认后补充具体映射；实现前确定公司目录、分页完整性与详情策略。若引入新的核心技术选型，先新增 ADR；单纯增加公司协议不改变依赖方向。

继续沿用 018 的公司、逻辑渠道和物理来源身份规则，不引入新进程或数据所有权。快手新增官网原始运行时驱动的技术决策见 ADR-0023；其他来源仍沿用原有传输机制。公司专属请求和 Schema 保存在各公司目录，共享模块只承担传输和分页机制。候选 URL 保存在研究台账中，不注册尚不存在的 adapter。

协议验证通过只是 endpoint_verified，不能替代适配器离线与在线验证。新增公司可先以三条零物理来源的逻辑渠道进入 catalog，blocked 表示尚无可运行来源，而非已证实官网拦截。

## B 站社招工程化

新增 `companies/bilibili/social`，公司目录拥有入口、字段 Schema、业务 code 分类、招聘类型检查和归一化规则，并经包公开入口供 Worker 使用。沿用既有 SourcePageClient responseShape 分发，增加 `bilibili-social`：Worker 只构造 pageNum/pageSize 的会话内分页请求，调用公司解析器处理响应。无需新增进程、登录状态或依赖方向，因此不新增 ADR。

适配器仅支持浏览器传输，复用 inline 分页适配器归一化机制，生产容量默认 50（允许 1–100）。首屏 UI 容量为 10 时先重放第 1 页，再按 total/请求容量分页；响应 pages/size 仅为不可靠上游字段，不影响完整性。B 站解析器严格验证社招过滤、业务 code、total 与白名单记录；适配器校验浏览器 collection 的页码、页长、唯一 ID 和累计计数，阻止缺页或重复集合被误判为 complete。

列表已包含完整职责和要求，capabilities.detail=inline，无需为每个职位请求详情。在线 smoke 使用生产适配器和实际 Worker 浏览器客户端取首页/末页（连同 UI 初始化最多三次列表请求），并独立加载其中一条官方详情，核对 ID、名称、职责与要求。采样 partial 不关闭旧职位；普通测试通过固定样本注入 SourcePageClient，不访问官网。

通过中立契约的 minimumRequestIntervalMs 指定会话内 JSON 请求至少间隔 5 秒，与默认每分钟 12 请求一致；健康检查最多采集一页。会话生命周期、超时、并发池和熔断继续复用既有实现。

## 快手三个渠道

先独立观察社招、日常实习与校园官网的公开请求，确认筛选参数和岗位深链。协议与频道定义归属 companies/kuaishou，共享公司级解析和归一化，social/intern/campus 各有公开适配器入口与独立身份。

匿名浏览器加载官网之后调用已加载模块的原始公开职位请求方法，保留官网的请求封装、服务器交互和匿名会话，不抽取或重放签名。原生调用只允许经验证的列表、项目和字典操作；模块缺失或接口变化按 parse_changed 失败。接入方式见 [ADR-0023](../../docs/adr/0023-official-runtime-source-driver.md)，通过 SourcePageClient 的 kuaishou-jobs 分发，应用与领域不接触浏览器。

三个逻辑渠道映射四个物理来源：social/C001、intern/C002、intern.campus/当前 intern 项目、campus/当前 fulltime 项目。实习两个来源均为 required，不能只完成一个就认为渠道完整。校园旧项目也标 active，因此按有效项目的最新 year 选择对应 projectType，完整清单缺失或同年歧义时失败，不把年份写死在配置中。

每个来源默认每页 50（允许 1–100），从不触发职位列表的官网首页初始化，按总数计算末页，并检查一条独立详情。smoke 仅两次列表请求；所有采样报告 partial / sampled_pages。元数据和列表请求间隔至少 5 秒，单次调用 30 秒、整次采集 300 秒截止；健康检查最多一页。所有正常/异常出口释放页面，外层池释放 context/browser。无浏览器时 access_blocked，不降级为裸 HTTP。旧的通用 fetch 重放失败不作为否定官网原生请求路径的证据。

职责和要求以纯文本内联拼接，城市和经验按官网字典解码；不把 updateTime 当发布日期，当前 publishedAt 为 null。浏览器驱动和适配器两层校验完整性，缺页、短页、重复、总数漂移不能触发旧岗位下线。公开字段白名单在 SourcePageClient 返回前剔除无关内部字段。

## 滴滴接入协议

最新验收决定：用户已手动复现官网第 65 页短页，同意将社招适配器记为 supported。目录保留上游分页缺陷说明，物理来源按 supported 默认启用规则登记；已有运行开关不重置。此决定仅改变来源支持状态，不改变解析器、分页完整性或同步下线保护：遇到该异常仍为 partial/invalid_page_boundary，原始证据保留在 research.md。

三渠道对应社招、实习、常规校招三个 required 物理来源，以及未来精英（Moka 116021）这一校园 supplemental 来源；来源 ID 后缀 254–257 保持不变。三个逻辑渠道均 supported，国内范围不含国际招聘站。校招支持范围是已验证的常规校招；未来精英后续独立验证，当前保持 experimental/default off，不阻断逻辑渠道晋级。不改变来源身份、数据所有权或通用状态派生规则，也不放松完整性校验。

原始 Moka 列表的 open/pause 均参与分页计数和唯一性检查，discover 只输出 open；完整集合可推导在招 expectedCount，采样发现 pause 时在招总数未知（null）。未知状态失败，暂停详情不可入库。字段白名单剔除无关内部配置；空地点不猜测城市，无时区 publishedAt 按中国标准时间解释。

现有 deferred 是已有列表正文后的补充详情，不能承载空正文。因此社招/实习使用新的 detail=required 契约，Registry 要求 fetchDetail；JobSyncService 在逐条隔离错误的 try 内、任何写入事务之前调用 fetchDetail，再 normalize/merge。失败记录隔离观察，不创建占位、不排 deferred enrichment 任务。校园继续 inline；既有 deferred 的缓存和后续任务不变。该必要契约调整见 ADR-0024，源协议仍属于 sources。

社招使用匿名 HTTP：`front/list?page=&recruitType=1&size=16`，严格保持已验证容量 16（50 会返回拦截业务码，不能据此判断匿名 HTTP 不可用）；详情 `front/view/:jdId` 延迟获取，并用列表 jdNo 与详情 jdNo 绑定身份。

后续复核发现响应确实包含 page/size，因此社招解析器显式校验 page 与请求一致、size=16；原先忽略该回显属于适配器缺口，现已补齐。移动端虽请求 size=10，响应仍是 16，不能切换到 10 并按其计算页数。PC 官网直接点末页同样短页；禁缓存及刷新查询没有修复末页。上游计数/列表不一致的具体机制尚未确证；社招按用户验收记为 supported，但不能通过放宽完整性规则宣称上游已修复。

实习/校园采用官网 Moka 的原始 HTTP 模块 `0wyxq0`（webpack5），由官网客户端处理自己的响应封装，不抽取解密实现。固定 orgId=didiglobal，siteId 分别 6222/96064/116021；列表 `/api/outer/ats-apply/website/jobs/v2` 使用 limit=30/offset，无岗位过滤。实习校验 hireMode=1、commitment=实习；校招校验 hireMode=2、commitment=全职和校园入口。列表无正文时以 required 模式调用 fetchDetail，浏览器 detail collection 仅允许目标岗位的一条公开详情。校园列表内联正文，不额外逐岗请求。

增加 didi-moka / didi-moka-detail 响应形态，但不增加进程、账号或领域依赖；Worker 持有匿名页面与生命周期，sources 拥有固定路径和方法。原始运行时驱动延续 ADR-0023，滴滴 Moka 适用范围补充在该 ADR；不开放任意模块或请求。配置允许显式设置采样页数与 first-last，采样永远 partial；默认顺序完整采集。社招请求和 Moka 分页均低频串行，health 一页。
