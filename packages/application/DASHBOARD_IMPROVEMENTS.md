# 首页改进实现总结

## 已完成的改进

### 1. 数据层扩展

**packages/application/src/contracts/web.ts**
- 新增 `WebDashboardNextAction` 类型：决策光标数据结构
  - `create_profile`: 提示建立画像
  - `enable_sources`: 提示启用来源
  - `review_matches`: 显示新匹配职位（包含 top job 预览）
  - `handle_failures`: 显示失败任务数量
  - `all_good`: 一切正常状态
  
- 新增 `WebDashboardHighlightJob` 类型：高亮职位卡片数据
  - 包含公司名、职位名、地点、分数、匹配原因、发布时间
  - `isNew` 标记 7 天内新增职位

**packages/db/src/dashboard-read-model.ts**
- 扩展 `snapshot()` 方法，计算下一步行动和高亮职位
- `#computeNextAction()`: 智能决策逻辑
  1. 优先级 1: 没有画像 → 引导建立画像
  2. 优先级 2: 没有启用来源 → 引导启用来源
  3. 优先级 3: 有失败任务 → 提示处理失败
  4. 优先级 4: 有新的高分职位（7天内，≥80分）→ 突出显示待查看数量
  5. 否则: 显示"一切正常"
  
- `#getHighlightJobs()`: 获取最近 7 天内新增或更新的前 5 个职位
  - 按匹配分数降序排序
  - 同时查询匹配原因（前 3 个得分最高的维度）

### 2. 前端组件

**apps/web/app/components/dashboard-next-action.tsx**
- 决策光标组件，用 3px 珊瑚色边框突出显示
- 根据不同 action 类型渲染不同内容
- `review_matches` 类型会预览得分最高的职位
- 响应式设计：移动端垂直布局

**apps/web/app/components/dashboard-highlight-jobs.tsx**
- 值得关注的职位网格
- 每个职位卡片显示：
  - 公司名 + "新"标签（7天内）
  - 匹配分数
  - 职位标题
  - 地点（最多 3 个）
  - 匹配原因标签（经验、技能、学历等）
  - 相对时间（今天、昨天、X天前）
- 响应式网格：桌面 3 列、平板 2 列、手机 1 列
- hover 效果：边框变色、轻微上移、阴影

### 3. 首页布局更新

**apps/web/app/page.tsx**
- 在 Hero 之后立即显示决策光标（如果有）
- 在"工作台概览"之后显示"值得关注的职位"
- 保留原有的指标卡、三步引导、最近同步

**新的视觉层次：**
```
Hero（保持原样）
  ↓
决策光标（珊瑚色 3px 左边框，突出下一步）
  ↓
工作台概览（4 个指标卡）
  ↓
值得关注的职位（最多 5 个卡片）
  ↓
三步引导 | 最近同步（双栏布局）
```

## 设计原则遵守

✅ **决策光标**：珊瑚色只用于标记下一步行动，其余界面保持安静
✅ **档案感**：使用卡片和时间线样式，克制的动效（120ms）
✅ **不用绿色品牌色**：成功状态使用档案靛蓝
✅ **密度平衡**：信息丰富但保持呼吸感
✅ **响应式**：桌面优先，移动端自然降级

## 数据来源

- **下一步行动**：基于画像存在性、来源数量、任务状态、匹配分数智能计算
- **高亮职位**：查询最近 7 天内新增或更新的 active 职位，按匹配分数排序
- **匹配原因**：从 `match_score_components` 表提取得分最高的 3 个维度

## SQL 查询性能

- 使用 CTE（Common Table Expressions）优化复杂查询
- 所有查询都使用索引字段（status, is_current, first_seen_at, updated_at）
- 限制返回数量（top 1, top 5）控制数据量

## 下一步建议（可选）

1. **画像完成度**：如果画像字段不完整，显示提示
2. **最近活动流**：替代单一的"最近同步"，显示 5-8 条时间线
3. **Hero 精简**：减少 Hero 高度到 1/3，提升信息密度
4. **三步引导可收起**：完成后自动收起或允许手动折叠

## 验证步骤

运行以下命令验证实现：

```bash
# 类型检查
pnpm typecheck

# 构建
pnpm build

# 运行 Web 开发服务器
pnpm --filter @jobhunter/web dev

# 访问 http://127.0.0.1:3210/ 查看效果
```

## 技术细节

- TypeScript 严格模式通过
- Zod schema 验证确保类型安全
- Next.js Server Components（RSC）
- CSS Modules 实现样式隔离
- 遵循项目现有的命名和目录约定
