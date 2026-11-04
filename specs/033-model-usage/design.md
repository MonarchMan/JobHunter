# 用量统计设计

> 状态：Implemented

新增模型传输观测器：每次 dispatch 独立记录状态和时刻，将 OpenAI/Anthropic SSE 聚合成原客户端可校验的 JSON。仅有效文本/工具参数首次出现时记录首字，使用输出 Tokens / 首字到结束秒数计算速度；丢失终止事件、流错误或超限显式失败。ModelUsage 可携带多次 HTTP 账单，ModelClientError 携带失败调用用量，由 Runner 持久化一次。协议仍由 common models 所有，依赖及数据所有权不变，不新增 ADR。

页面复用 SelectField，顶部应用、供应商、模型和时间筛选更新 URL，供应商变化清空模型；设置管理币种、趋势样式与日志列，主区域依据本机 CC Switch 完整界面对齐。更多指标为第二排四卡；汇总显示成功率、加权速度与首字中位数。显示偏好写入 URL 并随分页/切换保留。价格表展示筛选窗口内的实际快照（包括定价版本），不修改既有价格。供应商以请求主机聚合，未知历史数据单列“—”。旧 JSON 可选字段读取兼容，不执行数据迁移或回填。

参考 cc-switch 的 UsageDashboard/UsageTrendChart 信息结构（https://github.com/farion1231/cc-switch/tree/main/src/components/usage），独立实现指标卡、趋势、日志与模型视图，不引入其 Tauri/代理实现或依赖。

common/usage 声明只读仓储端口和聚合用例，common/persistence 通过 json_each 展开 agent_runs.model_usage_json，以请求时间过滤；Web 容器负责装配，Server Component 查询后只传递聚合及当前页日志。金额按币种筛选，不隐式换汇。沿用已存在的数据所有权和依赖方向，无需 ADR。

今日从上海零点开始按小时补零，7/30 天包含今日并按日补零。未知输入/输出不加入已知 token 合计，提示缺失请求数；未知缓存不参与命中率分母。失败运行中已记录的调用仍计费，运行状态明确为父运行状态。没有 HTTP 级别状态、供应商和时延快照时不展示虚构指标。查询不接触提示词、模型输出或凭据。
