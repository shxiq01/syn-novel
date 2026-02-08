# Userscript 安装说明

## 1. 前置条件
- 浏览器安装 Tampermonkey
- 登录私域后台：`https://18.foxaholic.com/wp-admin/`
- 登录 NovelUpdates：`https://www.novelupdates.com/`

## 2. 推荐安装方式（单文件优先）
1. 安装并启用：`userscripts/foxaholic-helper.user.js`
2. 安装并启用：`userscripts/novelupdates-helper.user.js`

> 说明：两个主脚本已支持“单文件模式”，即使未单独安装 `userscripts/shared/*.js` 也可运行。

## 3. 可选：高级 shared 模式（非必需）

如果你希望复用统一 shared 模块（例如多脚本协同调试），可额外安装：

1. `userscripts/shared/constants.js`
2. `userscripts/shared/logger.js`
3. `userscripts/shared/contracts.js`
4. `userscripts/shared/storage.js`
5. `userscripts/shared/parser.js`
6. `userscripts/shared/dom.js`
7. `userscripts/shared/ui.js`

主脚本会优先使用外部 shared；如果外部 shared 不完整，会自动回退到单文件内置模块。

## 4. 私域脚本使用流程

### 3.1 小说列表页批量扫描
- 进入 `/wp-admin/edit.php?post_type=wp-manga`
- 勾选小说后点击 `扫描选中`
- 扫描结果会写入 `synNovelData.novels`

### 3.2 小说编辑页映射配置
- 进入某本小说编辑页 `/wp-admin/post.php?post=<id>&action=edit`
- 点击 `配置映射`
- 填写 `nuSeriesName` / `nuGroupName` / `releaseFormat`

### 3.3 Text Chapter 页导入填充
- 点击 `导入章节`，选择 `_split.txt`
- 在弹窗勾选要处理的章节并点击 `开始填充`
- 每次填充后手动点击平台 `Create Chapter`
- 再点击 `填充下一章` 继续

## 5. 数据位置
- `GM storage key`: `synNovelData`
- 核心结构：`novels` / `novelConfigs` / `publishedReleases` / `meta`

## 6. 故障排查
- 面板未显示：确认脚本匹配地址正确、共享模块已先加载
- 扫描为空：检查登录状态和后台章节 DOM 是否变更
- 填充失败：检查 Text Chapter 表单字段选择器是否变化

## 7. 快速自检（页面无任何按钮时）

1. 打开 Tampermonkey 管理页面，确认主脚本已启用：
   - `userscripts/foxaholic-helper.user.js`
   - `userscripts/novelupdates-helper.user.js`
2. 确认当前地址命中脚本范围：
   - Fox：`https://18.foxaholic.com/wp-admin/*`
   - NU：`https://www.novelupdates.com/*`
3. 打开浏览器控制台执行：`window.SynNovelShared`
   - 输出对象且包含 `Storage/UI/Dom`（Fox 侧还应有 `Parser`）即为正常
4. 刷新页面后重试
   - 单文件模式下会自动注入内置 shared，右下角会提示 `SynNovel 单文件模式已启用`

## 8. 最小手工回归清单

### 8.1 Foxaholic（`https://18.foxaholic.com/wp-admin/*`）
1. 小说列表页：进入 `/wp-admin/edit.php?post_type=wp-manga`
   - 预期：右下角出现 `SynNovel 扫描助手`
   - 预期：列表行出现可勾选框
2. 小说编辑页：进入 `/wp-admin/post.php?post=<id>&action=edit`
   - 预期：右下角出现 `SynNovel 当前小说`
   - 预期：可点击 `配置映射` 与 `立即扫描`
3. Text Chapter 页：进入章节编辑/创建页面
   - 预期：右下角出现 `SynNovel 上传助手`
   - 预期：可点击 `导入章节` 并选择 `_split.txt`

### 8.2 NovelUpdates（`https://www.novelupdates.com/*`）
1. 任意页面（已登录）
   - 预期：右下角出现 `NovelUpdates 同步助手`
   - 预期：可点击 `同步已发布`
2. Add Release 页面：进入 `/add-release`
   - 预期：出现 `待发布章节` 面板
   - 预期：每条待发布项显示 `填充` 按钮

### 8.3 单文件模式验证
1. 仅启用两个主脚本（禁用/不安装 `userscripts/shared/*.js`）
   - 预期：上述 Fox/NU 面板仍可显示
2. 控制台执行 `window.SynNovelShared`
   - 预期：返回对象，并包含 `Storage/UI/Dom`（Fox 侧包含 `Parser`）
