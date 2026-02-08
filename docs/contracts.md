# syn-novel 跨模块契约（Contract）

## 元信息
- 契约版本：`1.0.0`
- 生效日期：`2026-02-08`
- 适用模块：`chapter_splitter`（Python） + `userscripts`（Tampermonkey）
- 变更策略：
  - `major`：字段含义或结构破坏性变更
  - `minor`：向后兼容字段新增
  - `patch`：文档描述或默认值修订

## Contract A：章节输出格式

### 文本结构
- 单章包裹格式：`===<title>===\n<content>`
- 章节间空行：默认 2 行（可配置）
- 文件编码：`utf-8`

### 规范示例
```text
===第1章：初入江湖 (1/3)===
这是正文第一部分...


===第2章：初入江湖 (2/3)===
这是正文第二部分...
```

## Contract B：章节号提取规则

### 支持格式（按优先级）
1. 中文：`第N章` / `第N节` / `第N回`
2. 英文：`Chapter N`
3. 短格式：`cN`
4. 数字前缀：`N. xxx` / `N xxx`

### 统一输出
- 结果类型：`integer | null`
- 提取失败返回 `null`
- 仅允许正整数章节号

## Contract C：章节 URL 组装规则

### 模板
`https://18.foxaholic.com/novel/{slug}/chapter-{num}/`

### 输入
- `slug`: 私域小说 slug
- `num`: 章节号（正整数）

### 输出
- 标准章节链接字符串

## Contract D：共享存储模型（GM storage）

### key
- 存储键：`synNovelData`

### Schema
```json
{
  "novels": {
    "<novelSlug>": {
      "id": 0,
      "title": "",
      "slug": "",
      "baseUrl": "",
      "group": "",
      "lastScanned": "",
      "chapters": [
        {
          "id": 0,
          "index": 1,
          "name": "",
          "unlocked": false,
          "unlockTime": "",
          "url": ""
        }
      ]
    }
  },
  "novelConfigs": {
    "<novelSlug>": {
      "nuSeriesName": "",
      "nuGroupName": "",
      "releaseFormat": "chapter"
    }
  },
  "publishedReleases": {
    "<novelSlug>": {
      "nuSlug": "",
      "lastScanned": "",
      "releases": ["c1", "c2"]
    }
  },
  "meta": {
    "version": "1.0.0",
    "lastUpdated": ""
  }
}
```

## 一致性约束
- `novels.<slug>.slug` 必须与键名一致。
- `chapters[].index` 与 URL `chapter-{num}` 章节号一致。
- `releaseFormat` 仅允许：`chapter` / `c`。
- 写入必须同步刷新 `meta.lastUpdated`。

## 向后兼容规则
- 新增字段必须提供默认值。
- 删除字段前必须经历至少一个 `minor` 周期的兼容桥接。
- 脚本读取未知字段时应忽略而非抛错。
