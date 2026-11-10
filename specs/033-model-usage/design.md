# 用量统计设计

> 状态：Implemented

UsageService 在生成筛选候选、全部时间起点和聚合前，排除网络传输失败的请求；不修改仓储读取和底层账本。总成本移除未定价次数文案及 tooltip，未知费用仍保持 null，不补零或回算。

currency 仅选择 USD/CNY 显示币种，默认 USD，不参与账单过滤。装配层将 MODEL_USD_TO_CNY_RATE（默认 7.2）传入纯统计用例，校验为有限正数。UsageTotals.costByCurrency 保留原始分币种汇总，cost 按汇率转换已知金额；全部未定价时为 null。时间桶、分组、总计和浏览器逐请求/价格显示共用该换算规则。汇率随报告传给页面，不写回请求账本。

页面筛选调整：移除“全部 / JobHunter”切换及页面 application 参数传递，保留右侧币种、供应商、模型、时间控件；不改变请求的应用快照字段。

账本改造采用 [ADR-0059](../../docs/adr/0059-model-request-ledger.md)：model_requests 保存独立请求、用量和价格快照，通过可空 agent_run_id 单向关联运行；请求 ID 在发送前生成，传输观测回调通过 AgentRunStore 端口即时落库。模型适配器只依赖回调契约，不依赖 SQLite。运行的 billingCalls/requestIds 是查询结果，不是重复存储。运行汇总列保留供列表与无明细历史兼容。清理运行使用 ON DELETE SET NULL 保留账本。0048 迁移搬运已知快照后删除旧 JSON 列；下述原 JSON 方案仅作为历史说明。

新增模型传输观测器：每次 dispatch 独立记录状态和时刻，将 OpenAI/Anthropic SSE 聚合成原客户端可校验的 JSON。仅有效文本/工具参数首次出现时记录首字，使用输出 Tokens / 首字到结束秒数计算速度；丢失终止事件、流错误或超限显式失败。ModelUsage 可携带多次 HTTP 账单，ModelClientError 携带失败调用用量，由 Runner 持久化一次。协议仍由 common models 所有，依赖及数据所有权不变，不新增 ADR。

页面复用 SelectField，顶部应用、供应商、模型和时间筛选更新 URL，供应商变化清空模型；顶部管理费用显示币种，设置管理趋势样式与日志列，主区域依据本机 CC Switch 完整界面对齐。更多指标为第二排四卡；汇总显示成功率、加权速度与首字中位数。显示偏好写入 URL 并随分页/切换保留。价格表展示筛选窗口内的实际快照（包括定价版本），不修改既有价格。供应商以请求主机聚合，未知历史数据单列“—”。旧 JSON 可选字段读取兼容，不执行数据迁移或回填。

参考 cc-switch 的 UsageDashboard/UsageTrendChart 信息结构（https://github.com/farion1231/cc-switch/tree/main/src/components/usage），独立实现指标卡、趋势、日志与模型视图，不引入其 Tauri/代理实现或依赖。

common/usage 声明只读仓储端口和聚合用例，common/persistence 通过 json_each 展开 agent_runs.model_usage_json，以请求时间过滤；Web 容器负责装配，Server Component 查询后只传递聚合及当前页日志。金额按币种筛选，不隐式换汇。沿用已存在的数据所有权和依赖方向，无需 ADR。

今日从上海零点开始按小时补零，7/30 天包含今日并按日补零。未知输入/输出不加入已知 token 合计，提示缺失请求数；未知缓存不参与命中率分母。失败运行中已记录的调用仍计费，运行状态明确为父运行状态。没有 HTTP 级别状态、供应商和时延快照时不展示虚构指标。查询不接触提示词、模型输出或凭据。
