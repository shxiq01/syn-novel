# 网页自动化模块 - 需求与设计文档

> 模块名称：Web Automation (Tampermonkey Scripts)
> 版本：v1.1
> 状态：待审核
> 更新：优化扫描策略，支持批量扫描和选择性扫描

---

## 目录

1. [项目背景](#1-项目背景)
2. [需求概述](#2-需求概述)
3. [平台分析](#3-平台分析)
4. [功能设计](#4-功能设计)
5. [数据同步机制](#5-数据同步机制)
6. [配置设计](#6-配置设计)
7. [技术方案](#7-技术方案)
8. [用户界面设计](#8-用户界面设计)
9. [异常处理](#9-异常处理)

---

## 1. 项目背景

### 1.1 业务场景

小说平台运营人员需要：
1. 将小说章节上传到私域平台（WordPress + WP-Manga）
2. 定期将已解锁的章节同步发布到 NovelUpdates

### 1.2 当前痛点

- 手动逐章上传到私域平台，效率低
- 需要手动对比两个平台的章节状态
- NovelUpdates 表单填写重复性高
- 容易遗漏已解锁但未发布的章节

### 1.3 目标

开发两个油猴脚本：
- **脚本 A**：私域平台辅助脚本（章节上传 + 状态扫描）
- **脚本 B**：NovelUpdates 辅助脚本（自动填充发布表单）

---

## 2. 需求概述

### 2.1 核心需求

| 需求 | 描述 | 优先级 |
|------|------|--------|
| 章节批量上传 | 从本地文件读取章节，辅助上传到私域平台 | P0 |
| 解锁状态扫描 | 自动识别私域平台已解锁的章节 | P0 |
| 跨站数据同步 | 私域状态数据共享给 NovelUpdates 脚本 | P0 |
| 表单自动填充 | 在 NovelUpdates 自动填充发布表单 | P0 |
| 已发布对比 | 对比 NovelUpdates 已发布章节，识别待发布 | P1 |
| 小说配置管理 | 管理多本小说的映射关系和翻译小组 | P1 |

### 2.2 用户故事

```
作为小说平台运营人员，
我希望能够快速将章节上传到私域平台，
并在章节解锁后一键发布到 NovelUpdates。
```

### 2.3 技术约束

- 实现方式：油猴脚本（Tampermonkey / Violentmonkey）
- 跨站通信：GM_setValue / GM_getValue
- 触发方式：手动触发
- 浏览器：Chrome / Firefox / Edge

---

## 3. 平台分析

### 3.1 私域平台（WordPress + WP-Manga）

#### 3.1.1 平台信息

| 项目 | 详情 |
|------|------|
| 域名 | `18.foxaholic.com` |
| 后台 | `/wp-admin/` |
| 插件 | WP-Manga / WP Novel |
| 小说列表 | `/wp-admin/edit.php?post_type=wp-manga` |

#### 3.1.2 章节管理页面

**URL 格式**：
```
/wp-admin/post.php?post={novel_id}&action=edit
```

**章节列表结构**（从截图分析）：
```html
<!-- 章节列表区域：WP Novel > Manga Chapters List -->
<div class="chapter-item">
  [121986] Chapter 85 🔒 - Tang Yu's Retreat
  <span class="unlock-time">Unlock on 24-Sep-26 01:09</span>
</div>
```

**解锁状态识别**：
- 🔒 图标存在 = 锁定
- 🔒 图标不存在 = 已解锁
- 或通过 `Unlock on` 时间与当前时间对比

#### 3.1.3 REST API 分析

**结论**：WP-Manga 插件未暴露专用 REST API

经分析 `https://18.foxaholic.com/wp-json/wp/v2/` 返回的数据：
- 只有标准 WordPress REST API 端点
- 无 WP-Manga 相关的自定义端点
- 无法通过 API 直接获取章节数据

**因此采用页面解析方案**：通过 fetch 请求小说编辑页，解析 DOM 获取章节信息。

#### 3.1.5 章节上传页面

**入口**：WP Novel > Text Chapter

**表单字段**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Select scheduled datetime | 日期时间 | 否 | 定时发布 |
| Coin Value | 数字 | 否 | 章节价格 |
| Volume | 下拉 | 否 | 卷 |
| Chapter Name | 文本 | 是 | 章节名称 |
| Name Extend | 文本 | 否 | 扩展名称 |
| Chapter Index | 数字 | 否 | 章节排序 |
| Chapter Content | 富文本 | 是 | 章节内容 |

#### 3.1.6 章节 URL 格式

```
https://18.foxaholic.com/novel/{novel-slug}/chapter-{chapter-num}/

示例：
https://18.foxaholic.com/novel/my-mothers-dual-personality/chapter-77/
```

### 3.2 NovelUpdates

#### 3.2.1 平台信息

| 项目 | 详情 |
|------|------|
| 域名 | `www.novelupdates.com` |
| 发布入口 | `/add-release/` |
| 用户页面 | `/user/{user_id}/{username}/` |

#### 3.2.2 Add Release 表单

**URL**：`https://www.novelupdates.com/add-release/`

**表单字段**：
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| Series | 搜索下拉 | 是 | 小说名称（搜索选择） |
| Release | 文本 | 是 | 章节标识（如 `c85` 或章节名） |
| Link to Release | URL | 是 | 私域章节 URL |
| Group | 搜索下拉 | 是 | 翻译小组（搜索选择） |
| Release Date | 日期 | 否 | 发布日期 |

#### 3.2.3 小说章节列表页

用于对比已发布章节：
```
https://www.novelupdates.com/series/{novel-slug}/
```

**章节列表获取**：
- 页面默认显示分页的 "Latest Release" 列表
- 点击 "show all chapters" 按钮可打开 "Chapter Listing" 弹窗
- 弹窗中显示所有已发布章节（如：c76, c75, c74...）
- **注意**：需要登录才能查看完整列表

**弹窗结构**（从截图分析）：
```html
<div class="chapter-listing-modal">
  <a href="...">c76</a>
  <a href="...">c75</a>
  <a href="...">c74</a>
  ...
</div>
```

---

## 4. 功能设计

### 4.1 脚本 A：私域平台辅助脚本

#### 4.1.1 功能列表

| 功能 | 触发方式 | 页面 |
|------|----------|------|
| 批量章节扫描 | 手动（选择小说后） | 小说列表页 |
| 单本小说扫描 | 自动 | 小说编辑页 |
| 章节批量上传辅助 | 手动 | Text Chapter 页 |
| 小说配置管理 | 手动 | 任意页面 |

#### 4.1.2 批量章节扫描（核心功能）

> **注意**：经过 API 分析，WP-Manga 插件未暴露 REST API，因此采用页面解析方式扫描。

**入口页面**：小说列表页 `/wp-admin/edit.php?post_type=wp-manga`

**操作流程**：
```
1. 用户在小说列表页看到所有小说
2. 脚本在列表中添加勾选框
3. 用户勾选要扫描的小说（可多选）
4. 用户点击"扫描选中小说"按钮
5. 脚本依次处理每本小说：
   a. 通过 fetch 请求小说编辑页
   b. 解析章节列表（DOM 解析）
   c. 提取章节状态信息
   d. 更新进度条
6. 扫描完成，存储到 GM storage
7. 显示扫描结果摘要
```

**选中小说缓存**：
- 用户选中的小说列表会被缓存
- 下次打开页面，自动恢复上次的选择
- 方便日常只扫描"活跃"的小说

**UI 设计**：
```
┌────────────────────────────────────────────────────────────────────┐
│ Novel 列表                              [🔄 扫描选中] [⚙️ 设置]     │
├────────────────────────────────────────────────────────────────────┤
│ ☑ My Mother's Dual Personality    | Active  | 上次扫描: 2小时前   │
│ ☑ Your Mother's Lease Is Due      | Finished| 上次扫描: 1天前     │
│ ☐ Stealing a Mother's Love        | Finished| 未扫描              │
│ ...                                                                 │
├────────────────────────────────────────────────────────────────────┤
│ 已选择 2 本小说                    [全选活跃] [清除选择]            │
└────────────────────────────────────────────────────────────────────┘

扫描进度：
┌────────────────────────────────────────────────────────────────────┐
│ 正在扫描: My Mother's Dual Personality (1/2)                       │
│ ████████████████████░░░░░░░░░░░░░░░░░░░░ 50%                       │
│                                                                    │
│ 已完成：                                                            │
│ ✅ My Mother's Dual Personality - 85章 (已解锁: 77, 锁定: 8)       │
└────────────────────────────────────────────────────────────────────┘
```

#### 4.1.3 单本小说扫描（自动触发）

**触发条件**：打开某本小说的编辑页面时自动执行

**用途**：
- 上传新章节后自动更新该小说的章节数据
- 无需回到列表页重新扫描

**数据结构**：
```javascript
{
  "novels": {
    "my-mothers-dual-personality": {
      "id": 190258,
      "title": "My Mother's Dual Personality",
      "slug": "my-mothers-dual-personality",
      "baseUrl": "https://18.foxaholic.com/novel/my-mothers-dual-personality/",
      "group": "Foxaholic",  // 翻译小组
      "lastScanned": "2026-02-08T10:00:00Z",
      "chapters": [
        {
          "id": 121986,
          "index": 85,
          "name": "Chapter 85 - Tang Yu's Retreat",
          "unlocked": false,
          "unlockTime": "2026-09-24T01:09:00Z",
          "url": "https://18.foxaholic.com/novel/my-mothers-dual-personality/chapter-85/"
        },
        // ...
      ]
    }
  }
}
```

#### 4.1.3 章节批量上传辅助

**功能**：
1. 读取本地章节文件（章节划分模块的输出）
2. 解析章节标题和内容
3. 自动填充到 Text Chapter 表单
4. 用户确认后提交

**操作流程**：
```
1. 用户点击"导入章节"按钮
2. 选择本地文件（_split.txt）
3. 脚本解析文件，显示章节列表
4. 用户选择要上传的章节
5. 脚本自动填充表单：
   - Chapter Name = 章节标题
   - Chapter Index = 章节序号
   - Chapter Content = 章节内容
6. 用户确认，点击"Create Chapter"
7. 重复直到所有章节上传完成
```

#### 4.1.4 小说配置管理

**功能**：配置小说与 NovelUpdates 的映射关系

**配置项**：
```javascript
{
  "novelConfigs": {
    "my-mothers-dual-personality": {
      "nuSeriesName": "My Mother's Dual Personality",  // NU 搜索名称
      "nuGroupName": "Foxaholic",  // 翻译小组名称
      "releaseFormat": "chapter"  // chapter / c{num}
    }
  }
}
```

### 4.2 脚本 B：NovelUpdates 发布辅助脚本

#### 4.2.1 功能列表

| 功能 | 触发方式 | 页面 |
|------|----------|------|
| 批量扫描已发布 | 手动（提前执行） | 任意 NU 页面 |
| 待发布章节列表 | 自动显示 | Add Release 页 |
| 表单自动填充 | 点击章节 | Add Release 页 |

#### 4.2.2 批量扫描已发布章节（提前执行）

> **策略**：在发布前提前批量扫描所有相关小说的已发布章节，确保数据准确。

**操作流程**：
```
1. 用户点击"同步已发布状态"按钮
2. 脚本读取 GM storage 中的私域小说列表
3. 对每本小说：
   a. 请求 NU 小说详情页
   b. 点击 "show all chapters" 按钮（需要登录）
   c. 解析 Chapter Listing 弹窗内容
   d. 提取所有已发布的 Release 标识
   e. 更新进度条
4. 存储到 GM storage
5. 显示同步结果
```

**注意**：需要用户已登录 NovelUpdates，否则可能无法访问完整章节列表。

**UI 设计**：
```
┌────────────────────────────────────────────────────────────────────┐
│ NovelUpdates 同步助手                                              │
├────────────────────────────────────────────────────────────────────┤
│ [🔄 同步已发布状态]  上次同步: 3小时前                              │
│                                                                    │
│ 同步进度：                                                          │
│ ████████████████████████████░░░░░░░░░░░░ 70% (7/10)                │
│                                                                    │
│ ✅ My Mother's Dual Personality - 76 章已发布                      │
│ ✅ Your Mother's Lease Is Due - 45 章已发布                        │
│ 🔄 Stealing a Mother's Love - 扫描中...                            │
│ ⏳ Another Novel - 等待中                                          │
└────────────────────────────────────────────────────────────────────┘
```

#### 4.2.3 待发布章节列表

**触发条件**：打开 Add Release 页面时

**处理流程**：
```
1. 读取 GM storage 中的私域章节数据
2. 读取 GM storage 中的已发布记录
3. 过滤出待发布章节：
   - 已解锁 = true
   - 未在已发布记录中
4. 按小说分组显示列表
5. 用户点击章节 → 自动填充表单
```

#### 4.2.4 已发布章节数据结构

```javascript
{
  "publishedReleases": {
    "my-mothers-dual-personality": {
      "nuSlug": "my-mother-my-teacher",  // NU 上的小说 slug
      "lastScanned": "2026-02-08T10:00:00Z",
      "releases": ["c1", "c2", "c3", ..., "c76"]
    }
  }
}
```

#### 4.2.5 表单自动填充

**点击待发布章节时**：
```
1. 读取小说配置（nuSeriesName, nuGroupName）
2. 填充 Series 字段（触发搜索 → 选择）
3. 填充 Release 字段（如 "Chapter 85" 或 "c85"）
4. 填充 Link to Release 字段（私域章节 URL）
5. 填充 Group 字段（触发搜索 → 选择）
6. 用户确认，点击 Submit
7. 提交成功后，记录到已发布列表
```

---

## 5. 数据同步机制

### 5.1 存储方案

使用 Tampermonkey 的 `GM_setValue` / `GM_getValue`：
- 数据存储在浏览器本地
- 同一浏览器的不同脚本可共享

### 5.2 数据结构总览

```javascript
// GM storage key: "synNovelData"
{
  // 私域小说数据（脚本 A 写入）
  "novels": { ... },

  // 小说配置（脚本 A 管理）
  "novelConfigs": { ... },

  // 已发布记录（脚本 B 写入）
  "publishedReleases": { ... },

  // 元数据
  "meta": {
    "version": "1.0",
    "lastUpdated": "2026-02-08T10:00:00Z"
  }
}
```

### 5.3 同步流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户操作流程                              │
└─────────────────────────────────────────────────────────────────┘

【第一步：私域平台扫描】
1. 访问私域后台小说列表页
   └─→ 脚本 A 显示小说列表（带勾选框）
   └─→ 用户勾选要扫描的小说（选择会被缓存）
   └─→ 点击"扫描选中小说"
   └─→ 脚本依次请求每本小说的编辑页，解析章节状态
   └─→ 存储到 GM storage

【第二步：配置小说映射】（首次使用时）
2. 在私域后台配置每本小说的 NU 映射
   └─→ 设置 NU 小说名称、翻译小组
   └─→ 存储到 GM storage

【第三步：NovelUpdates 扫描】
3. 访问 NovelUpdates 任意页面
   └─→ 点击"同步已发布状态"
   └─→ 脚本根据私域小说列表，依次请求 NU 详情页
   └─→ 点击 "show all chapters"，解析已发布章节
   └─→ 存储到 GM storage

【第四步：发布章节】
4. 打开 NovelUpdates Add Release 页面
   └─→ 脚本 B 读取 GM storage
   └─→ 对比：私域已解锁 - NU 已发布 = 待发布
   └─→ 显示待发布章节列表
   └─→ 用户点击章节 → 自动填充表单
   └─→ 用户确认提交
```

---

## 6. 配置设计

### 6.1 脚本配置面板

通过油猴脚本的配置面板管理：

```javascript
// 全局配置
{
  // 私域平台配置
  "privatePlatform": {
    "domain": "18.foxaholic.com",
    "novelUrlPattern": "/novel/{slug}/chapter-{num}/"
  },

  // NovelUpdates 配置
  "novelUpdates": {
    "domain": "www.novelupdates.com"
  },

  // 默认配置
  "defaults": {
    "releaseFormat": "chapter",  // "chapter" = Chapter 85, "c" = c85
    "autoScan": true  // 自动扫描章节状态
  }
}
```

### 6.2 小说映射配置

每本小说需要配置的映射关系：

```javascript
{
  // 私域 slug → NU 配置
  "my-mothers-dual-personality": {
    "nuSeriesName": "My Mother's Dual Personality",
    "nuGroupName": "Foxaholic",
    "releaseFormat": "chapter"  // 或 "c"
  }
}
```

### 6.3 配置 UI

在私域后台页面添加配置入口：
- 悬浮按钮或菜单项
- 点击打开配置面板
- 支持添加/编辑/删除小说映射

---

## 7. 技术方案

### 7.1 项目结构

```
syn-novel/
├── userscripts/
│   ├── foxaholic-helper.user.js     # 脚本 A：私域平台
│   ├── novelupdates-helper.user.js  # 脚本 B：NovelUpdates
│   └── shared/
│       ├── storage.js               # GM storage 封装
│       ├── parser.js                # 章节文件解析
│       └── ui.js                    # UI 组件
│
├── docs/
│   └── userscript-install.md        # 安装说明
│
└── config/
    └── novel-mappings.example.json  # 配置示例
```

### 7.2 脚本元数据

#### 脚本 A：私域平台辅助

```javascript
// ==UserScript==
// @name         Foxaholic Helper
// @namespace    https://github.com/your-repo/syn-novel
// @version      1.0.0
// @description  私域小说平台辅助工具：章节上传、状态扫描
// @match        https://18.foxaholic.com/wp-admin/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
```

#### 脚本 B：NovelUpdates 辅助

```javascript
// ==UserScript==
// @name         NovelUpdates Release Helper
// @namespace    https://github.com/your-repo/syn-novel
// @version      1.0.0
// @description  NovelUpdates 发布辅助：自动填充表单
// @match        https://www.novelupdates.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
```

### 7.3 核心模块

#### 7.3.1 存储模块

```javascript
// storage.js
const STORAGE_KEY = 'synNovelData';

const Storage = {
  async get() {
    const data = await GM_getValue(STORAGE_KEY, {});
    return data;
  },

  async set(data) {
    await GM_setValue(STORAGE_KEY, data);
  },

  async update(path, value) {
    const data = await this.get();
    // 深度更新 path
    setNestedValue(data, path, value);
    await this.set(data);
  }
};
```

#### 7.3.2 章节解析模块

```javascript
// parser.js
const ChapterParser = {
  // 解析章节划分模块的输出文件
  parseFile(content, separator = '===') {
    const chapters = [];
    const regex = new RegExp(`${separator}(.+?)${separator}\\n([\\s\\S]*?)(?=${separator}|$)`, 'g');

    let match;
    while ((match = regex.exec(content)) !== null) {
      chapters.push({
        title: match[1].trim(),
        content: match[2].trim()
      });
    }

    return chapters;
  },

  // 从标题提取章节序号
  extractChapterNum(title) {
    // 匹配各种格式：第1章、Chapter 1、c1 等
    const match = title.match(/(?:第|Chapter\s*|c)(\d+)/i);
    return match ? parseInt(match[1]) : null;
  }
};
```

### 7.4 DOM 操作封装

```javascript
// 表单填充辅助
const FormHelper = {
  // 填充搜索下拉框（Series / Group）
  async fillSearchDropdown(selector, searchText) {
    const input = document.querySelector(selector);
    input.value = searchText;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // 等待搜索结果
    await this.waitForElement('.dropdown-item');

    // 选择第一个结果
    const firstResult = document.querySelector('.dropdown-item');
    firstResult?.click();
  },

  // 填充普通文本框
  fillInput(selector, value) {
    const input = document.querySelector(selector);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },

  // 等待元素出现
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error('Element not found: ' + selector));
      }, timeout);
    });
  }
};
```

---

## 8. 用户界面设计

### 8.1 脚本 A：私域平台 UI

#### 8.1.1 状态扫描通知

页面右下角浮动通知：
```
┌────────────────────────────────────┐
│ ✅ 章节扫描完成                      │
│                                    │
│ 小说：My Mother's Dual Personality │
│ 总章节：85                          │
│ 已解锁：77                          │
│ 锁定中：8                           │
│                                    │
│ [查看详情]  [关闭]                   │
└────────────────────────────────────┘
```

#### 8.1.2 章节上传面板

点击"导入章节"后的弹窗：
```
┌────────────────────────────────────────────┐
│ 📁 导入章节                                  │
├────────────────────────────────────────────┤
│                                            │
│ [选择文件] novel_split.txt                  │
│                                            │
│ 已解析 50 个章节：                           │
│                                            │
│ ☐ 第1章：初入江湖 (1/3)                     │
│ ☐ 第2章：初入江湖 (2/3)                     │
│ ☐ 第3章：初入江湖 (3/3)                     │
│ ☑ 第4章：剑意初成                           │
│ ☑ 第5章：...                               │
│ ...                                        │
│                                            │
│ [全选] [反选]                               │
│                                            │
│         [取消]  [开始上传]                   │
└────────────────────────────────────────────┘
```

#### 8.1.3 配置面板

```
┌────────────────────────────────────────────┐
│ ⚙️ 小说配置                                 │
├────────────────────────────────────────────┤
│                                            │
│ 当前小说：My Mother's Dual Personality      │
│                                            │
│ NovelUpdates 配置：                         │
│ ┌──────────────────────────────────────┐   │
│ │ 小说名称：[My Mother's Dual Persona] │   │
│ │ 翻译小组：[Foxaholic             ]   │   │
│ │ Release格式：○ Chapter 85  ● c85     │   │
│ └──────────────────────────────────────┘   │
│                                            │
│              [保存]  [取消]                  │
└────────────────────────────────────────────┘
```

### 8.2 脚本 B：NovelUpdates UI

#### 8.2.1 待发布章节面板

Add Release 页面右侧悬浮面板：
```
┌────────────────────────────────────────────┐
│ 📋 待发布章节                                │
├────────────────────────────────────────────┤
│                                            │
│ 🔍 [搜索小说...]                            │
│                                            │
│ ▼ My Mother's Dual Personality (3)         │
│   ├─ Chapter 78 - Title...    [填充]       │
│   ├─ Chapter 79 - Title...    [填充]       │
│   └─ Chapter 80 - Title...    [填充]       │
│                                            │
│ ▼ Another Novel (5)                        │
│   ├─ ...                                   │
│                                            │
│ ─────────────────────────────────          │
│ 💡 提示：点击 [填充] 自动填写表单              │
│ 📊 上次扫描：2 小时前                        │
│                                            │
│ [刷新状态]  [⚙️设置]                         │
└────────────────────────────────────────────┘
```

#### 8.2.2 填充成功提示

```
┌────────────────────────────────────┐
│ ✅ 已自动填充表单                    │
│                                    │
│ Series: My Mother's Dual...        │
│ Release: Chapter 78                │
│ Link: https://18.foxaholic...      │
│ Group: Foxaholic                   │
│                                    │
│ 请检查后点击 Submit                  │
└────────────────────────────────────┘
```

---

## 9. 异常处理

### 9.1 异常类型与处理

| 异常场景 | 处理策略 |
|----------|----------|
| GM storage 读取失败 | 显示错误提示，要求刷新页面 |
| 章节列表解析失败 | 显示警告，提供手动输入选项 |
| 表单元素找不到 | 延迟重试，3次失败后提示用户 |
| 搜索下拉无结果 | 提示用户检查配置名称 |
| 提交失败 | 保留填充数据，提示用户重试 |

### 9.2 日志记录

```javascript
const Logger = {
  info(msg) { console.log(`[SynNovel] ℹ️ ${msg}`); },
  warn(msg) { console.warn(`[SynNovel] ⚠️ ${msg}`); },
  error(msg) { console.error(`[SynNovel] ❌ ${msg}`); }
};
```

---

## 10. 实现优先级

### Phase 1：核心功能
1. 脚本 A：章节状态扫描 + 数据存储
2. 脚本 B：读取数据 + 表单自动填充

### Phase 2：增强功能
3. 脚本 A：章节批量上传辅助
4. 脚本 B：已发布章节扫描对比
5. 配置管理 UI

### Phase 3：优化
6. 错误处理完善
7. UI 美化
8. 性能优化

---

## 审核确认

请审核以上设计，确认后我将开始实现。

**需要确认的点**：
1. UI 设计是否符合预期？
2. 数据结构是否满足需求？
3. 功能优先级是否正确？
4. 是否有遗漏的场景？
