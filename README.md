# syn-novel 使用手册

`syn-novel` 包含两部分能力：
- Python 章节划分工具：把 TXT 章节标准化并输出 `_split.txt`
- Tampermonkey 自动化脚本：私域扫描与 NovelUpdates 发布辅助

## 1. 环境准备

- Python 3.11+
- Node.js（仅用于本地脚本语法检查，可选）
- Tampermonkey（浏览器扩展）

安装依赖：

```bash
uv sync --dev
```

## 2. Python 章节划分工具

### 2.1 快速试跑

```bash
uv run python -m chapter_splitter.main tests/fixtures/chinese_sample.txt --dry-run
```

### 2.2 正式执行

```bash
uv run python -m chapter_splitter.main tests/fixtures/chinese_sample.txt
```

默认输出为同目录下 `*_split.txt`，例如：
- 输入：`tests/fixtures/chinese_sample.txt`
- 输出：`tests/fixtures/chinese_sample_split.txt`

### 2.3 指定配置与参数覆盖

```bash
uv run python -m chapter_splitter.main tests/fixtures/english_sample.txt \
  --config config/examples/english-novel.yaml \
  --target-chars 900
```

### 2.4 运行测试

```bash
uv run pytest
```

## 3. Userscript（浏览器自动化）

详细安装步骤见：
- `docs/userscript-install.md`
- `docs/release-workflow.md`

### 3.1 私域脚本 A（Foxaholic）

脚本文件：`userscripts/foxaholic-helper.user.js`

主要能力：
- 小说列表页批量扫描章节状态
- 小说编辑页配置 NU 映射
- Text Chapter 页导入 `_split.txt` 并队列填充

### 3.2 NU 脚本 B（NovelUpdates）

脚本文件：`userscripts/novelupdates-helper.user.js`

主要能力：
- 同步系列已发布章节
- Add Release 页面展示待发布差集
- 点击“填充”自动写入 Series/Release/Link/Group

## 4. 数据结构

共享存储键：`synNovelData`

核心结构：
- `novels`
- `novelConfigs`
- `publishedReleases`
- `meta`

详细契约见：`docs/contracts.md`

## 5. 常见问题

### 5.1 `pytest` 命令不可用
先执行：

```bash
uv add --dev pytest
```

### 5.2 油猴面板没出现
- 检查 URL 是否匹配脚本 `@match`
- 确认主脚本已启用：`userscripts/foxaholic-helper.user.js` / `userscripts/novelupdates-helper.user.js`
- 当前版本支持单文件模式：未安装 `userscripts/shared/*.js` 也可运行
- 控制台可执行 `window.SynNovelShared` 自检模块加载情况

### 5.3 NU 自动填表失败
- 目标页面 DOM 可能变更，优先检查下拉框选择器
- 确认已登录 NovelUpdates
