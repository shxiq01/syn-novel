# NU 同步准确性重构 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Fox -> NU 发布链路收敛为“批量映射 + 批量扫描 + Add Release 发布”的最小可用流程，并以“准确无误”为唯一判定标准（强制 `nuSlug`、仅 `show all chapters`、任一失败全局阻断）。

**Architecture:** Fox 脚本仅保留首页批量能力与 Text Chapter 的 `SynNovel 上传助手`，移除编辑页单本能力。NU 脚本仅在 Add Release 页工作，移除非必要入口与自动猜测逻辑。同步阶段先全量验证后再生成待发布，保证“解锁且已发布不重复、解锁未发布必出现、未解锁不出现”。

**Tech Stack:** Tampermonkey Userscript（原生 JS + DOM API + GM 存储）；Node.js 内置测试运行器（`node --test`）用于规则函数单测；手工浏览器回归。

---

## File Structure Map

- Modify: `userscripts/foxaholic-helper.user.js`
- Modify: `userscripts/novelupdates-helper.user.js`
- Modify: `README.md`
- Modify: `docs/release-workflow.md`
- Create: `userscripts/shared/nu-sync-rules.js`
- Create: `tests/userscripts/nu-sync-rules.test.mjs`

说明：
- `userscripts/shared/nu-sync-rules.js` 仅承载“可测试的纯规则函数”（是否阻断、候选过滤、差集计算），避免业务判断散落在 UI 逻辑里。
- NU 主脚本调用规则模块，测试直接验证规则模块，保证准确性约束可回归。

---

## Chunk 1: 精简范围与入口收敛

### Task 1: 清理 Fox 单本流程，保留批量与上传助手

**Files:**
- Modify: `userscripts/foxaholic-helper.user.js`（`openConfigForCurrentNovel`、`autoScanCurrentNovel`、`initEditPage` 相关段落）
- Reference: `docs/superpowers/specs/2026-03-20-nu-sync-accuracy-design.md`

- [ ] **Step 1: 写失败测试（行为快照）**

创建 `tests/userscripts/fox-entry-regression.test.mjs`（可临时文件，后续合并到统一测试）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('fox script should not expose single-edit config entry', () => {
  const src = fs.readFileSync('userscripts/foxaholic-helper.user.js', 'utf8');
  assert.equal(src.includes('⚙️ 配置映射'), false);
  assert.equal(src.includes('🔄 立即扫描'), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/userscripts/fox-entry-regression.test.mjs`  
Expected: FAIL（当前仍存在编辑页单本入口文案）

- [ ] **Step 3: 最小实现**

- 删除 `openConfigForCurrentNovel` 调用入口
- 删除 `initEditPage` 与 `isNovelEditPage()` 的挂载分支
- 保留 `initListPage`（批量映射/扫描）与 `initTextChapterPage`（上传助手）

- [ ] **Step 4: 再跑测试确认通过**

Run: `node --test tests/userscripts/fox-entry-regression.test.mjs`  
Expected: PASS

- [ ] **Step 5: 语法校验**

Run: `node --check userscripts/foxaholic-helper.user.js`  
Expected: 无输出（exit code 0）

- [ ] **Step 6: Commit**

```bash
git add userscripts/foxaholic-helper.user.js tests/userscripts/fox-entry-regression.test.mjs
git commit -m "refactor(fox): remove single-edit mapping/scan entrypoints"
```

---

### Task 2: NU 只保留 Add Release 入口，移除非必要自动推断

**Files:**
- Modify: `userscripts/novelupdates-helper.user.js`（`initCommonPanel`、`installSubmitWatcher`、`registerPendingSubmitOnForm`、`reconcilePendingSubmitAfterSuccess` 链路）
- Test: `tests/userscripts/nu-entry-regression.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('nu script should not keep common panel or submit watcher hooks', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('const initCommonPanel ='), false);
  assert.equal(src.includes('const installSubmitWatcher ='), false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/userscripts/nu-entry-regression.test.mjs`  
Expected: FAIL

- [ ] **Step 3: 最小实现**

- 删除 `initCommonPanel` 与 `else initCommonPanel()` 分支
- 删除提交成功猜测链：`hasSubmitSuccessHint`、`hasSubmitErrorHint`、`registerPendingSubmitOnForm`、`installSubmitWatcher`、`reconcileAfterSubmitAttempt`、`reconcilePendingSubmitAfterSuccess`
- 保留 Add Release 页面上的 `renderPendingPanel` 和手动填充功能

- [ ] **Step 4: 测试通过**

Run: `node --test tests/userscripts/nu-entry-regression.test.mjs`  
Expected: PASS

- [ ] **Step 5: 语法校验**

Run: `node --check userscripts/novelupdates-helper.user.js`  
Expected: 无输出（exit code 0）

- [ ] **Step 6: Commit**

```bash
git add userscripts/novelupdates-helper.user.js tests/userscripts/nu-entry-regression.test.mjs
git commit -m "refactor(nu): keep add-release only and remove auto submit inference"
```

---

## Chunk 2: 准确性规则收敛（强制 nuSlug + show-all + 全局阻断）

### Task 3: 建立可测试规则模块

**Files:**
- Create: `userscripts/shared/nu-sync-rules.js`
- Create: `tests/userscripts/nu-sync-rules.test.mjs`

- [ ] **Step 1: 写失败测试（先写约束）**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../../userscripts/shared/nu-sync-rules.js';

test('block entire run when any item failed', () => {
  const blocked = rules.shouldBlockRun([
    { slug: 'a', ok: true },
    { slug: 'b', ok: false, reason: 'SHOW_ALL_UNAVAILABLE' }
  ]);
  assert.equal(blocked, true);
});

test('pending only includes unlocked and unpublished', () => {
  const pending = rules.buildPendingReleaseKeys({
    unlockedKeys: ['c1', 'c2', 'c3'],
    publishedKeys: ['c2']
  });
  assert.deepEqual(pending, ['c1', 'c3']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/userscripts/nu-sync-rules.test.mjs`  
Expected: FAIL（模块尚未存在）

- [ ] **Step 3: 实现最小规则模块**

`userscripts/shared/nu-sync-rules.js` 最小导出：

```js
function shouldBlockRun(items) {
  return items.some((item) => !item.ok);
}

function buildPendingReleaseKeys({ unlockedKeys, publishedKeys }) {
  const unlocked = new Set(unlockedKeys || []);
  const published = new Set((publishedKeys || []).map((k) => String(k).toLowerCase()));
  return [...unlocked].filter((k) => !published.has(String(k).toLowerCase())).sort();
}

module.exports = { shouldBlockRun, buildPendingReleaseKeys };
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test tests/userscripts/nu-sync-rules.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add userscripts/shared/nu-sync-rules.js tests/userscripts/nu-sync-rules.test.mjs
git commit -m "test(sync): add executable rules for block and pending diff"
```

---

### Task 4: 强制 nuSlug + 仅 show-all 扫描

**Files:**
- Modify: `userscripts/novelupdates-helper.user.js`（`resolveScanTarget`、`scanNovelSeries`、`syncPublishedStatus`）
- Test: `tests/userscripts/nu-sync-rules.test.mjs`（追加失败码映射与阻断场景）

- [ ] **Step 1: 扩展失败测试**

追加测试用例：

```js
test('missing nuSlug must fail hard', () => {
  const result = rules.validateSyncInput({ nuSlug: '' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_NU_SLUG');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/userscripts/nu-sync-rules.test.mjs`  
Expected: FAIL

- [ ] **Step 3: 最小实现**

- `resolveScanTarget`：移除按名称匹配/猜测路径；无 `nuSlug` 直接失败
- `scanNovelSeries`：只允许 show-all 成功后返回 `ok: true`；任意 show-all 异常返回失败码
- 失败码限定：
  - `MISSING_NU_SLUG`
  - `SHOW_ALL_UNAVAILABLE`
  - `SERIES_ACCESS_DENIED`
  - `PARSER_FAILED`

- [ ] **Step 4: 运行测试通过**

Run: `node --test tests/userscripts/nu-sync-rules.test.mjs`  
Expected: PASS

- [ ] **Step 5: 语法校验**

Run:
- `node --check userscripts/novelupdates-helper.user.js`
- `node --check userscripts/shared/nu-sync-rules.js`

Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add userscripts/novelupdates-helper.user.js userscripts/shared/nu-sync-rules.js tests/userscripts/nu-sync-rules.test.mjs
git commit -m "refactor(nu): enforce nuSlug and show-all as single source of truth"
```

---

### Task 5: 全局阻断待发布生成（任何失败即不展示）

**Files:**
- Modify: `userscripts/novelupdates-helper.user.js`（`syncPublishedStatus`、`buildPendingList`、`renderPendingPanel`）
- Test: `tests/userscripts/nu-blocking-regression.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../../userscripts/shared/nu-sync-rules.js';

test('global block hides pending generation when any scan failed', () => {
  const blocked = rules.shouldBlockRun([
    { ok: true },
    { ok: false, reason: 'PARSER_FAILED' }
  ]);
  assert.equal(blocked, true);
});
```

- [ ] **Step 2: 运行测试确认失败（若规则未接入）**

Run: `node --test tests/userscripts/nu-blocking-regression.test.mjs`  
Expected: FAIL 或未覆盖当前实现

- [ ] **Step 3: 最小实现**

- `syncPublishedStatus` 产出 run-level 状态：`meta.syncRun = { runId, blocked, failures[] }`
- `buildPendingList` 开头读取 `meta.syncRun.blocked`
  - 若 `true`，直接返回空列表
- `renderPendingPanel` 显示阻断原因摘要（失败数量 + reasonCode）

- [ ] **Step 4: 运行测试通过**

Run:
- `node --test tests/userscripts/nu-sync-rules.test.mjs`
- `node --test tests/userscripts/nu-blocking-regression.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add userscripts/novelupdates-helper.user.js tests/userscripts/nu-blocking-regression.test.mjs
git commit -m "feat(nu): block pending list globally when sync has any failure"
```

---

## Chunk 3: 文档与契约同步

### Task 6: 更新 README 与发布流程文档

**Files:**
- Modify: `README.md`
- Modify: `docs/release-workflow.md`
- Reference: `docs/superpowers/specs/2026-03-20-nu-sync-accuracy-design.md`

- [ ] **Step 1: 写失败检查（文档关键句）**

创建临时检查脚本（可放 `tests/userscripts/docs-consistency.test.mjs`）：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('release workflow should mention global blocking and show-all-only', () => {
  const text = fs.readFileSync('docs/release-workflow.md', 'utf8');
  assert.equal(text.includes('仅 show all chapters'), true);
  assert.equal(text.includes('任意一本失败'), true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/userscripts/docs-consistency.test.mjs`  
Expected: FAIL

- [ ] **Step 3: 更新文档**

- `README.md` 删除单本配置/单本扫描描述，补充“仅 Add Release 入口 + 全局阻断”
- `docs/release-workflow.md` 明确：
  - 强制 `nuSlug`
  - 仅 show-all
  - 任一失败阻断待发布

- [ ] **Step 4: 再跑测试**

Run: `node --test tests/userscripts/docs-consistency.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add README.md docs/release-workflow.md tests/userscripts/docs-consistency.test.mjs
git commit -m "docs: align release workflow with strict accuracy policy"
```

---

## Chunk 4: 端到端验收与交付

### Task 7: 本地验证矩阵执行

**Files:**
- Reference only: `userscripts/foxaholic-helper.user.js`, `userscripts/novelupdates-helper.user.js`

- [ ] **Step 1: 静态验证**

Run:
- `node --check userscripts/foxaholic-helper.user.js`
- `node --check userscripts/novelupdates-helper.user.js`
- `node --test tests/userscripts/*.test.mjs`

Expected: 全通过

- [ ] **Step 2: 手工场景回归（浏览器）**

1. 全量成功：待发布正确  
2. 缺 `nuSlug`：全局阻断  
3. show-all 不可用：全局阻断  
4. 403/未登录：全局阻断  
5. 未解锁章节：不进入待发布

Expected: 与 spec 完全一致

- [ ] **Step 3: 结果记录**

在 PR 描述或变更说明中记录：
- 每个场景结果
- 若失败，附控制台日志摘要（reasonCode）

- [ ] **Step 4: 最终 Commit（如仍有未提交变更）**

```bash
git add -A
git commit -m "refactor: simplify fox->nu flow with strict accuracy guarantees"
```

---

## Review Loop Notes

- 每个 Chunk 完成后执行一次计划/实现自审：
  - 对照 spec：`docs/superpowers/specs/2026-03-20-nu-sync-accuracy-design.md`
  - 对照本计划当前 chunk 的验收点
- 若出现偏差，先修正再进入下一 chunk。
- 如测试失败，优先使用 `@superpowers/systematic-debugging` 的流程定位根因，再改代码。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-20-nu-sync-accuracy-refactor-plan.md`. Ready to execute?

