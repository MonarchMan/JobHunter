# 016 官网来源扩展与目录分层设计

> 状态：Implemented

## 目录

```text
packages/sources/
├─ src/
│  ├─ catalog/
│  │  ├─ sources.ts
│  │  ├─ registry.ts
│  │  └─ index.ts
│  ├─ companies/<company>/<channel>/
│  │  ├─ adapter.ts
│  │  ├─ schemas.ts
│  │  └─ index.ts
│  └─ shared/
│     ├─ browser/
│     ├─ paged-json/
│     └─ normalization/
└─ test/
   ├─ companies/<company>/<channel>.test.ts
   └─ fixtures/<company>/<channel>/
```

公司目录拥有官网 URL、请求体、响应 Schema、深链和字段映射。共享分页器只负责编排请求、覆盖度与诊断，通过回调接收逐来源解析和规范化规则。公司和来源 UUID 保留在 `sources.ts` 的同一条记录中，避免跨文件或平行数组按下标关联。

同一公司多个渠道复用完全相同的官网协议时，公司根目录可以保留内部共享实现，但 `social`、`intern`、`campus` 等渠道必须各有公开入口；包根继续从兼容入口导出既有名称。

## 兼容迁移

迁移采用静态 TypeScript 导入，不做动态加载。包根 `src/index.ts` 继续暴露原有公共名称；catalog 与 Registry 分文件后由 `catalog/index.ts` 汇总。现有 UUID 与 key 原样迁移，测试保存迁移前的稳定字段快照。

## 新来源

| 来源 | 渠道       | 入口                                                    | 协议                       | 初始状态       |
| ---- | ---------- | ------------------------------------------------------- | -------------------------- | -------------- |
| 小米 | internship | `hr.xiaomi.com/website/opportunities.html?project=实习` | GET 分页 JSON，详情内联    | supported 候选 |
| vivo | social     | `hr.vivo.com/jobs`                                      | POST 分页 JSON，详情内联   | supported 候选 |
| OPPO | internship | `careers.oppo.com/university/oppo/campus/post`          | POST 分页 JSON，project 29 | supported 候选 |
| 360  | social     | `hr.360.cn/hr/list`                                     | 浏览器会话内 JSON          | experimental   |
| 网易 | mixed      | `hr.163.com/job-list.html`                              | POST 分页 JSON，详情内联   | supported 候选 |

以上状态仍以实现后的定向在线门禁为准。360 裸 HTTP 在当前环境返回 500，而正常匿名浏览器会话返回列表，因此只允许浏览器采集；未闭合详情和分页前不得默认启用。

## 分页与完整性

直接 JSON 来源读取响应声明的 total/pages/pageCount，并同时验证：每页长度不超过配置、总数跨页稳定、external ID 唯一、抓取页数达到预期且唯一记录数等于 total。失败时保留已发现记录并报告 partial。

## 测试

每个来源保存两页或一页加终止边界的脱敏 fixture，运行公共来源契约、Schema 漂移、重复 ID、总数变化、类别和官方 URL 测试。在线 Smoke 使用真实匿名 HTTP 或 Worker 浏览器装配，默认跳过。
