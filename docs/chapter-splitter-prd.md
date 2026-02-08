# 章节划分模块 - 需求与设计文档

> 模块名称：Chapter Splitter
> 版本：v1.1
> 状态：待审核
> 更新：优化 LLM 调用策略，控制 Token 消耗

---

## 目录

1. [项目背景](#1-项目背景)
2. [需求概述](#2-需求概述)
3. [功能设计](#3-功能设计)
4. [Token 消耗控制](#4-token-消耗控制)
5. [配置设计](#5-配置设计)
6. [技术方案](#6-技术方案)
7. [输入输出规范](#7-输入输出规范)
8. [异常处理](#8-异常处理)
9. [后续迭代](#9-后续迭代)

---

## 1. 项目背景

### 1.1 业务场景

小说平台运营人员需要将本地小说上架到私域平台，再同步发布到 NovelUpdates。由于不同小说的章节划分差异大，需要先进行标准化处理。

### 1.2 当前痛点

- 章节划分不统一：有的章节过长，有的没有章节
- 章节命名格式混乱：第一章、第1章、Chapter 1、01、番外等
- 多语言小说：中文、英文等，需要不同的处理规则
- 人工处理耗时且容易出错

### 1.3 目标

开发一个 Python 本地脚本，实现：
- 自动识别章节
- 按目标字数范围智能重划分
- 借助 LLM 统一章节标题格式
- 支持多语言（中文、英文等）

---

## 2. 需求概述

### 2.1 核心需求

| 需求 | 描述 | 优先级 |
|------|------|--------|
| 章节识别 | 识别各种格式的章节标记 | P0 |
| 智能分割 | 按目标字数范围分割长章节 | P0 |
| 标题统一 | LLM 统一章节标题格式 | P0 |
| 多语言支持 | 支持中文、英文等 | P0 |
| 可配置 | 字数范围、LLM 等可配置 | P0 |

### 2.2 用户故事

```
作为小说平台运营人员，
我希望能够将格式混乱的小说自动重新划分章节，
以便后续统一上架到平台。
```

### 2.3 约束条件

- 技术栈：Python
- LLM：Grok / DeepSeek（API 调用）
- 输入格式：TXT 纯文本
- 输出格式：单文件，章节用分隔符标记

---

## 3. 功能设计

### 3.1 处理流程

```
┌─────────────────────────────────────────────────────────────────┐
│                         输入 TXT 文件                            │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ [1] 语言检测（采样 500 字，单次 LLM 调用）                         │
│     - 采样文本开头 500 字                                         │
│     - LLM 判断主要语言（zh/en/...）                               │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ [2] 章节识别（分层策略，详见 3.2）                                 │
│     - 第一层：正则匹配（零 Token）                                 │
│     - 第二层：LLM 模式识别（采样 6000 字，仅正则失败时）            │
│     - 第三层：降级按段落/句子分割（零 Token）                      │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ [3] 章节分析与分割决策                                            │
│     - 计算每章字符数                                              │
│     - 判断是否需要分割：                                          │
│       · 字数 ≤ max → 保留原样                                    │
│       · 字数 > max → 进入分割流程                                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ [4] 智能分割（针对超长章节）                                       │
│     - 计算分割数量                                                │
│     - 在段落边界或句子边界处分割                                   │
│     - 避免硬切（不在句子中间断开）                                 │
│     - 均匀分配，避免尾章过短                                       │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ [5] 标题格式化（LLM 批量处理）                                     │
│     - 每批 20-30 个标题，单次 LLM 调用                            │
│     - LLM 统一格式：                                              │
│       · 中文：第{n}章：{title} ({part}/{total})                   │
│       · 英文：Chapter {n}: {title} (part {part})                 │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│ [6] 生成输出文件                                                  │
│     - 按分隔符组装章节                                            │
│     - 写入输出文件                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 章节识别规则（分层策略）

> **核心原则：LLM 只用于「识别模式」，不用于「逐个识别章节」**

#### 3.2.1 第一层：正则匹配（零 Token 消耗）

内置 20+ 种常见章节格式正则，覆盖约 95% 场景：

| 语言 | 模式 | 示例 |
|------|------|------|
| 中文 | `^第[一二三四五六七八九十百千\d]+[章节篇回]` | 第一章、第10章、第三节 |
| 中文 | `^[一二三四五六七八九十百千]+[、.]` | 一、xxx |
| 中文 | `^序[章篇]?\|^楔子\|^番外` | 序章、楔子、番外 |
| 英文 | `^Chapter\s*\d+` | Chapter 1, Chapter 10 |
| 英文 | `^Part\s*\d+` | Part 1 |
| 英文 | `^Prologue\|^Epilogue` | Prologue, Epilogue |
| 通用 | `^\d+[.\s]` | 1. xxx, 1 xxx |

**匹配到章节 → 直接使用，跳过第二层**

#### 3.2.2 第二层：LLM 模式识别（仅正则失败时触发）

当正则匹配到 **0 个章节** 时，触发 LLM 模式识别：

```
1. 采样文本：
   - 开头 2000 字
   - 中间 2000 字（50% 位置）
   - 结尾 2000 字
   - 共约 6000 字

2. LLM 分析样本，输出「章节模式」：
   - 返回识别到的章节标记正则表达式
   - 或返回章节标记的文本特征

3. 用识别出的模式匹配全文（正则/字符串匹配）
```

**Token 消耗：约 6000 字 ≈ 3000-4000 tokens（单次调用）**

#### 3.2.3 第三层：降级处理（零 Token 消耗）

如果 LLM 模式识别仍无法识别章节：

1. **按段落分割**：以连续空行 `\n\n` 为边界
2. **按句子分割**：以句号为边界（最后备选）

### 3.3 智能分割算法

#### 3.3.1 分割数量计算

```python
def calculate_split_count(char_count: int, target: int, min_ratio: float, max_ratio: float) -> int:
    """
    计算需要分割成多少个子章节

    目标：每个子章节的字数尽量接近 target，且在 [target*min_ratio, target*max_ratio] 范围内
    """
    min_chars = int(target * min_ratio)
    max_chars = int(target * max_ratio)

    # 计算分割数量，使每个子章节字数尽量接近 target
    split_count = max(1, round(char_count / target))

    # 验证分割后每个子章节是否在范围内
    chars_per_part = char_count / split_count

    if chars_per_part > max_chars:
        split_count += 1

    return split_count
```

#### 3.3.2 分割点选择

优先级：
1. **段落边界**：连续换行符 `\n\n`
2. **句子边界**：句号 `。` `.` `!` `?` `！` `？`
3. **逗号**：作为最后备选

```python
def find_split_point(text: str, target_pos: int, search_range: int = 200) -> int:
    """
    在 target_pos 附近寻找最佳分割点

    search_range: 前后搜索范围（字符数）
    """
    start = max(0, target_pos - search_range)
    end = min(len(text), target_pos + search_range)

    # 1. 优先找段落边界
    para_breaks = find_all_positions(text[start:end], '\n\n')
    if para_breaks:
        return start + closest_to_center(para_breaks, target_pos - start)

    # 2. 其次找句子边界
    sentence_ends = find_all_positions(text[start:end], r'[。.!?！？]')
    if sentence_ends:
        return start + closest_to_center(sentence_ends, target_pos - start) + 1

    # 3. 最后找逗号
    comma_pos = find_all_positions(text[start:end], r'[,，]')
    if comma_pos:
        return start + closest_to_center(comma_pos, target_pos - start) + 1

    # 4. 实在没有，只能硬切（几乎不会发生）
    return target_pos
```

### 3.4 标题格式化（批量处理）

> **优化：批量调用 LLM，减少 API 请求次数**

#### 3.4.1 批量处理策略

- 每批处理 20-30 个标题
- 100 个章节 ≈ 4-5 次 API 调用（而非 100 次）
- 减少延迟，Token 更可控

#### 3.4.2 输入输出示例

| 原标题 | 语言 | 是否分割 | 输出 |
|--------|------|----------|------|
| 第一章 初入江湖 | zh | 是 (1/3) | 第1章：初入江湖 (1/3) |
| Chapter 1: The Beginning | en | 是 (1/2) | Chapter 1: The Beginning (part 1) |
| 第10章：剑意初成 | zh | 否 | 第10章：剑意初成 |
| 10. New Dawn | en | 否 | Chapter 10: New Dawn |
| 番外 | zh | 否 | 番外：（由LLM补充标题或保留） |

#### 3.4.3 LLM Prompt 设计（批量版）

```
你是一个小说章节标题格式化助手。

任务：将以下章节标题批量统一为标准格式。

规则：
1. 语言：{language}
2. 格式要求：
   - 中文：第{n}章：{title}
   - 英文：Chapter {n}: {title}
3. 如果是分割章节，添加分割标记：
   - 中文：(1/3)
   - 英文：(part 1)
4. 保留原标题的核心内容，只做格式统一
5. 对于「番外」「序章」等特殊章节，保留原名

输入标题列表（JSON 格式）：
{titles_json}

请以 JSON 数组格式输出格式化后的标题，保持顺序一致。
```

---

## 4. Token 消耗控制

### 4.1 设计原则

**LLM 只用于「识别模式」和「格式化标题」，不对全文进行处理**

### 4.2 LLM 调用点汇总

| 调用点 | 输入大小 | 调用次数 | 场景 |
|--------|----------|----------|------|
| 语言检测 | ~500 字 | 1 次 | 每次处理 |
| 章节模式识别 | ~6000 字 | 0-1 次 | 仅正则失败时 |
| 标题格式化 | ~2000 字/批 | N/20 次 | 批量处理 |

### 4.3 Token 消耗估算

以一本 **100 章、50 万字** 的小说为例：

| 场景 | 章节识别 | 标题格式化 | 总计 |
|------|----------|------------|------|
| 正则匹配成功（95%） | 0 | ~2500 tokens | ~2500 tokens |
| 需要 LLM 模式识别（5%） | ~4000 tokens | ~2500 tokens | ~6500 tokens |

**成本估算**（以 DeepSeek 为例，约 ¥0.001/1K tokens）：
- 正常情况：约 ¥0.003
- 最坏情况：约 ¥0.007

### 4.4 配置项

```yaml
llm:
  # 章节识别策略
  chapter_detection:
    # 是否启用 LLM 辅助识别（仅在正则失败时生效）
    enable_llm_fallback: true
    # 采样大小（字符数）
    sample_size: 2000
    # 采样位置数量
    sample_count: 3  # 开头、中间、结尾

  # 标题格式化
  title_formatting:
    # 批量处理数量
    batch_size: 20
```

---

## 5. 配置设计

### 5.1 配置文件结构

```yaml
# config.yaml

# ============================================================
# LLM 配置
# ============================================================
llm:
  # 提供商：deepseek / grok
  provider: deepseek

  # API 配置（敏感信息建议使用环境变量）
  api_key: ${DEEPSEEK_API_KEY}
  base_url: https://api.deepseek.com/v1

  # 模型名称
  model: deepseek-chat

  # 重试配置
  retry:
    max_attempts: 3
    delay_seconds: 2

  # 请求超时（秒）
  timeout: 30

  # 章节识别策略
  chapter_detection:
    # 是否启用 LLM 辅助识别（仅在正则失败时生效）
    enable_llm_fallback: true
    # 采样大小（字符数）
    sample_size: 2000
    # 采样位置数量（开头、中间、结尾）
    sample_count: 3

  # 标题格式化
  title_formatting:
    # 批量处理数量（每次 LLM 调用处理多少个标题）
    batch_size: 20

# ============================================================
# 分割配置
# ============================================================
splitter:
  # 目标字数
  target_chars: 1000

  # 字数范围系数
  min_ratio: 0.7  # 最小字数 = target * min_ratio
  max_ratio: 1.3  # 最大字数 = target * max_ratio

  # 章节分隔符
  separator: "==="

  # 分割点搜索范围（字符数）
  split_search_range: 200

# ============================================================
# 章节标题格式
# ============================================================
formats:
  # 中文格式
  # 可用变量：{num} 章节序号, {title} 标题, {part} 当前部分, {total} 总部分数
  zh: "第{num}章：{title} ({part}/{total})"
  zh_no_split: "第{num}章：{title}"

  # 英文格式
  en: "Chapter {num}: {title} (part {part})"
  en_no_split: "Chapter {num}: {title}"

# ============================================================
# 降级策略
# ============================================================
fallback:
  # 无法识别章节时的处理方式：paragraph / sentence
  no_chapter_detected: paragraph

  # LLM 失败时是否保留原标题
  llm_failure_keep_original: true

# ============================================================
# 输出配置
# ============================================================
output:
  # 输出文件编码
  encoding: utf-8

  # 章节之间的空行数
  blank_lines_between_chapters: 2
```

### 5.2 环境变量

```bash
# .env 文件（不提交到版本控制）

# DeepSeek API
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Grok API
GROK_API_KEY=xai-xxxxxxxxxxxxxxxx
GROK_BASE_URL=https://api.x.ai/v1

# 或火山引擎的 DeepSeek
VOLC_DEEPSEEK_API_KEY=xxxxxxxxxxxxxxxx
VOLC_DEEPSEEK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
```

### 5.3 多配置切换

支持不同场景的配置预设：

```bash
# 使用默认配置
python split.py input.txt

# 使用指定配置
python split.py input.txt --config config/english-novel.yaml

# 覆盖单个参数
python split.py input.txt --target-chars 800
```

---

## 6. 技术方案

### 6.1 项目结构

```
syn-novel/
├── src/
│   └── chapter_splitter/
│       ├── __init__.py
│       ├── main.py              # CLI 入口
│       ├── config.py            # 配置加载
│       ├── detector.py          # 语言检测
│       ├── parser.py            # 章节识别解析
│       ├── splitter.py          # 分割逻辑
│       ├── formatter.py         # 标题格式化
│       ├── llm/
│       │   ├── __init__.py
│       │   ├── client.py        # LLM 客户端封装
│       │   ├── deepseek.py      # DeepSeek 适配器
│       │   └── grok.py          # Grok 适配器
│       └── utils/
│           ├── __init__.py
│           └── text.py          # 文本处理工具
│
├── config/
│   ├── default.yaml             # 默认配置
│   └── examples/                # 配置示例
│       ├── chinese-novel.yaml
│       └── english-novel.yaml
│
├── tests/
│   ├── __init__.py
│   ├── test_parser.py
│   ├── test_splitter.py
│   └── fixtures/                # 测试用例文件
│       ├── chinese_sample.txt
│       └── english_sample.txt
│
├── .env.example                 # 环境变量示例
├── requirements.txt
├── pyproject.toml
└── README.md
```

### 6.2 核心依赖

```txt
# requirements.txt

# LLM 客户端
openai>=1.0.0          # OpenAI 兼容接口（DeepSeek/Grok 都支持）

# 配置管理
pyyaml>=6.0
python-dotenv>=1.0.0

# CLI
click>=8.0.0

# 工具
regex>=2023.0.0        # 增强正则（比 re 更强大）

# 开发依赖
pytest>=7.0.0
black>=23.0.0
```

### 6.3 核心类设计

```python
# 配置类
@dataclass
class SplitterConfig:
    target_chars: int
    min_ratio: float
    max_ratio: float
    separator: str
    formats: dict[str, str]

# 章节数据结构
@dataclass
class Chapter:
    original_title: str      # 原标题
    content: str             # 内容
    char_count: int          # 字符数

@dataclass
class SplitChapter:
    formatted_title: str     # 格式化后的标题
    content: str             # 内容
    chapter_num: int         # 章节序号
    part: int                # 分割部分（1-based）
    total_parts: int         # 总分割数

# 处理器接口
class ChapterSplitter:
    def __init__(self, config: SplitterConfig, llm_client: LLMClient): ...
    def process(self, input_path: str, output_path: str) -> ProcessResult: ...
```

---

## 7. 输入输出规范

### 7.1 输入格式

- 格式：TXT 纯文本
- 编码：UTF-8（自动检测）
- 内容：小说正文，可能包含或不包含章节标记

### 7.2 输出格式

```
===第1章：初入江湖 (1/3)===
这是第一章的第一部分内容...
（约 700-1300 字）

===第2章：初入江湖 (2/3)===
这是第一章的第二部分内容...
（约 700-1300 字）

===第3章：初入江湖 (3/3)===
这是第一章的第三部分内容...
（约 700-1300 字）

===第4章：剑意初成===
这是第二章的完整内容，因为字数在范围内不需要分割...
（约 700-1300 字）
```

### 7.3 命名规则

输出文件命名：
```
{原文件名}_split.txt

例：
input: 斗破苍穹.txt
output: 斗破苍穹_split.txt
```

---

## 8. 异常处理

### 8.1 异常类型与处理策略

| 异常场景 | 处理策略 |
|----------|----------|
| LLM 调用失败 | 重试 3 次，间隔 2 秒；全部失败后保留原标题 |
| 章节过短（< min） | 保留原样，不合并 |
| 无法识别任何章节 | 降级为按段落分割；若段落也不明显，按句子分割 |
| 文件编码错误 | 尝试自动检测编码（chardet） |
| 配置文件缺失 | 使用内置默认配置 |
| API Key 缺失 | 报错并提示配置方法 |

### 8.2 日志记录

```python
# 日志级别
INFO:  处理进度、章节统计
WARN:  降级处理、重试
ERROR: 处理失败

# 日志示例
[INFO] 开始处理: 斗破苍穹.txt
[INFO] 检测语言: 中文
[INFO] 识别到 120 个章节
[INFO] 章节 1 (3500字) -> 分割为 3 部分
[WARN] 章节 15: LLM 调用失败，重试 1/3
[INFO] 章节 15: 重试成功
[INFO] 处理完成: 共 180 个输出章节
[INFO] 输出文件: 斗破苍穹_split.txt
```

---

## 9. 后续迭代

### 9.1 下一迭代：私域平台上架

待本模块完成后，进入第二阶段：
- 油猴脚本 / Browser Extension
- 自动填充小说信息
- 批量上传章节

### 9.2 第三迭代：NovelUpdates 同步

- 监控私域平台章节解锁状态
- 自动同步到 NovelUpdates
- 定期检查与发布

### 9.3 可能的优化方向

- [ ] 支持更多输入格式（docx、epub）
- [ ] 支持更多 LLM 提供商
- [ ] Web UI 界面
- [ ] 批量处理多个小说
- [ ] 章节预览与手动调整

---

## 审核确认

请审核以上设计，确认后我将开始实现。

**需要确认的点**：
1. 配置文件结构是否满足需求？
2. 输出格式是否正确？
3. 处理流程是否有遗漏？
4. 是否有其他需要补充的需求？
