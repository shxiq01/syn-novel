# NU 同步准确性重构设计（保留 SynNovel 上传助手）

日期：2026-03-20  
状态：已确认（待实现）

## 1. 背景与目标

当前业务主链路是：

1. 在 Fox 首页批量配置映射  
2. 在 Fox 首页批量扫描小说解锁状态  
3. 进入 NovelUpdates Add Release 页面  
4. 仅将“已解锁且在 NU 未真实发布”的章节加入待发布并发布

核心质量目标：**准确无误**。

必须满足：

- 已解锁且真实已发布：不能重复发布
- 已解锁且未真实发布：必须进入待发布
- 未解锁：不能进入待发布

## 2. 关键决策（已冻结）

### 2.1 功能边界

- 采用“方案 A：极简强约束”
- 保留 `SynNovel 上传助手`（Fox Text Chapter 页）

### 2.2 系列定位策略

- 强制 `nuSlug`
- 不再使用名称模糊匹配作为自动落库依据

### 2.3 已发布真值来源

- 仅认可 `show all chapters` 扫描结果
- 不使用页面普通列表、历史推断、提交后猜测等来源作为真值

### 2.4 失败策略

- 任意一本小说同步失败 => 本轮 **全局阻断**
- 全局阻断时，不生成待发布列表

### 2.5 入口策略

- NU 侧只保留 Add Release 页面入口
- 移除非 Add Release 页面通用入口

## 3. 保留与删除范围

## 3.1 保留

### Fox（`userscripts/foxaholic-helper.user.js`）

- 列表页批量映射编辑
- 列表页批量扫描解锁状态
- Text Chapter 页 `SynNovel 上传助手`

### NU（`userscripts/novelupdates-helper.user.js`）

- Add Release 页面面板
- “同步已发布”按钮
- 待发布列表与一键填充表单

## 3.2 删除

### Fox 侧删除项

- 编辑页单本配置入口（prompt 配置）
- 编辑页单本立即扫描入口
- 与发布链路无关的单本操作分支

### NU 侧删除项

- 非 Add Release 页面通用面板入口
- 名称模糊匹配自动落库路径
- 多来源回退扫描路径
- “提交后自动推断已发布”路径

## 4. 数据流设计（准确性优先）

## 4.1 输入

- `novels.<slug>.chapters[].unlocked`：解锁状态真值
- `novelConfigs.<slug>.nuSlug`：NU 系列唯一键

## 4.2 同步阶段（NU -> 本地）

每本小说执行：

1. 校验 `nuSlug` 存在
2. 打开 `series/{nuSlug}` 页面
3. 触发/获取 `show all chapters`
4. 解析 `cN` 集合，得到 `publishedReleases.<slug>.releases`

失败条件（任一触发即失败）：

- `nuSlug` 缺失
- `show all chapters` 无法获取
- 页面访问受限（登录/403/风控）
- 解析失败

## 4.3 发布候选阶段（本地）

仅在“本轮同步全成功”时执行：

`pending = unlocked(true) - publishedReleases`

并继续应用本地提交锁去重逻辑。

## 4.4 全局阻断

若任何小说同步失败：

- `SYNC_BLOCKED = true`
- 待发布列表不生成
- 显示失败清单与原因

## 5. 错误分类与可观测性

建议最小失败码集合：

- `MISSING_NU_SLUG`
- `SHOW_ALL_UNAVAILABLE`
- `SERIES_ACCESS_DENIED`
- `PARSER_FAILED`

同步结果面板要求：

- 显示成功数 / 失败数
- 失败小说逐条列出（slug + reasonCode + 建议动作）
- 明确提示“本轮阻断，禁止发布决策”

## 6. 与上传助手的解耦

`SynNovel 上传助手`保留，但与发布真值链路解耦：

- 上传助手只负责章节内容导入/填充
- 不参与 NU 已发布真值判定
- 不自动改写 `publishedReleases` 真值集合

## 7. 实施拆解（文件级）

1. `userscripts/foxaholic-helper.user.js`
- 移除单本配置/单本扫描入口
- 保留批量映射、批量扫描、上传助手

2. `userscripts/novelupdates-helper.user.js`
- 仅保留 Add Release 页面入口
- 删除名称模糊匹配与非 show-all 回退
- 增加全局阻断控制
- 保持待发布生成仅在无失败时执行

3. 文档更新
- `README.md`
- `docs/release-workflow.md`

## 8. 验收标准

通过以下测试即视为达标：

1. 全量成功场景  
- 同步成功，待发布计算正确

2. 任意一本缺 `nuSlug`  
- 本轮阻断，不展示待发布

3. 任意一本 show-all 不可用  
- 本轮阻断，不展示待发布

4. 任意一本访问受限/403  
- 本轮阻断，不展示待发布

5. 未解锁章节验证  
- 未解锁章节永不进入待发布

## 9. 非目标（本轮不做）

- 自动修复 `nuSlug`
- 智能名称匹配纠错
- 失败时“部分可发”策略
- 任何基于猜测的自动发布判定

## 10. 风险与应对

风险：策略严格后，短期“不可发布”提示会变多。  
应对：失败原因清晰化 + 批量映射补全流程强化，优先保证准确率。

