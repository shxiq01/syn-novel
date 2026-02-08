# NovelUpdates 发布流程

## 1. 前置准备
- 私域脚本已完成小说扫描（`novels` 已写入）
- 每本小说已配置映射（`novelConfigs`）
- 已登录 NovelUpdates

## 2. 同步已发布状态
1. 打开任意 NovelUpdates 页面
2. 点击浮动按钮 `同步已发布`
3. 脚本会遍历 `novels`，请求 `/series/{slug}/` 并提取 `cN` 发布标识
4. 数据写入 `publishedReleases.<slug>`

## 3. Add Release 页面发布
1. 进入 `https://www.novelupdates.com/add-release/`
2. 面板显示待发布章节（规则：私域已解锁 - NU已发布）
3. 点击某条 `填充`：自动填写 Series / Release / Link / Group
4. 手动检查后点击 Submit

## 4. 去重策略
- 每次点击 `填充` 会先写入 `publishedReleases.<slug>.releases`
- 避免同章节重复显示在待发布列表
- 如误填可手动编辑 GM storage 清理对应 `cN`

## 5. 常见问题
- 无待发布：检查私域章节 `unlocked` 是否为 true
- 同步为空：检查 NU 登录态或 `nuSlug` 配置
- 自动填表失败：检查 Add Release 页面表单结构是否变化
