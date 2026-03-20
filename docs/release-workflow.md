# NovelUpdates 发布流程

## 1. 前置准备
- 在 Fox 小说列表页完成批量映射：每本都必须配置 `nuSlug`
- 在 Fox 列表页执行 `扫描选中`，确保 `novels` 最新
- 已登录 NovelUpdates

## 2. Add Release 页面同步已发布
1. 打开 `https://www.novelupdates.com/add-release/`
2. 点击面板 `📡 同步已发布`
3. 脚本按映射的 `nuSlug` 请求系列页，并且只使用 `show all chapters` 结果作为“真实已发布”来源
4. 同步成功后写入 `publishedReleases.<slug>.releases`

## 3. 严格阻断规则
- 任一本小说同步失败（例如缺少 `nuSlug`、403、无法获取 `show all chapters`）
- 本轮会被全局阻断：不落盘本轮发布结果，不生成待发布列表
- 修复问题后重新点击 `📡 同步已发布`

## 4. Add Release 发布
1. 面板仅展示：`私域已解锁` 且 `NU 未真实发布` 的章节
2. 点击 `填充` 自动填写 Series / Release / Link / Group
3. 手动检查后点击 Submit
4. 提交后再次点击 `📡 同步已发布` 做最终确认

## 5. 去重与准确性标准
- 已解锁且真实已发布：不能重复发布
- 已解锁且未真实发布：必须进入待发布
- 未解锁：不能进入待发布
- “真实已发布”唯一判定来源：`show all chapters`

## 6. 常见问题
- 待发布为空且提示阻断：先看同步失败原因（通常是 `nuSlug` 缺失或站点风控）
- 同步 403：等待一段时间后重试，确认 NU 登录态有效
- 自动填表失败：检查 Add Release 页面 DOM 是否变化，手动点选 Series/Group 后再提交
