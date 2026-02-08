# Userscript 安装说明

## 1. 前置条件
- 浏览器安装 Tampermonkey
- 登录私域后台：`https://18.foxaholic.com/wp-admin/`
- 登录 NovelUpdates：`https://www.novelupdates.com/`

## 2. 建议安装顺序
1. `userscripts/shared/constants.js`
2. `userscripts/shared/logger.js`
3. `userscripts/shared/contracts.js`
4. `userscripts/shared/storage.js`
5. `userscripts/shared/parser.js`
6. `userscripts/shared/dom.js`
7. `userscripts/shared/ui.js`
8. `userscripts/foxaholic-helper.user.js`
9. `userscripts/novelupdates-helper.user.js`（完成后安装）

## 3. 私域脚本使用流程

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

## 4. 数据位置
- `GM storage key`: `synNovelData`
- 核心结构：`novels` / `novelConfigs` / `publishedReleases` / `meta`

## 5. 故障排查
- 面板未显示：确认脚本匹配地址正确、共享模块已先加载
- 扫描为空：检查登录状态和后台章节 DOM 是否变更
- 填充失败：检查 Text Chapter 表单字段选择器是否变化
