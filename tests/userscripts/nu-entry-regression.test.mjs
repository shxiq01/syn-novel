import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('nu script should not keep common panel entry', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('const initCommonPanel ='), false);
});

test('nu script should expose per-series sync action', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('const syncSingleSeriesStatus ='), true);
  assert.equal(src.includes('同步本条'), true);
});

test('pull from fox should clear previous sync state', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('importDataFromFoxBridge({ clearSyncState: true })'), true);
  assert.equal(src.includes('syncDiagnostics = {}'), true);
  assert.equal(src.includes('publishedReleases: clearSyncState'), true);
});

test('synced series button should be disabled with clear label', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes("syncButtonText = !canSync"), true);
  assert.equal(src.includes("'已同步'"), true);
  assert.equal(src.includes('btn.disabled = !item.canSync'), true);
});

test('series sync list should hide synced items', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('const syncableSeriesRows = seriesRows.filter((item) => item.canSync);'), true);
  assert.equal(src.includes('syncableSeriesRows.forEach((item) => {'), true);
  assert.equal(src.includes('全部系列已同步'), true);
});

test('pending-submit workflow should gray on fill and remove on submit click', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('const PENDING_SUBMIT_PATH ='), true);
  assert.equal(src.includes('const SUBMIT_DISMISSED_PATH ='), true);
  assert.equal(src.includes('await setPendingSubmit(item);'), true);
  assert.equal(src.includes('dismissPendingSubmitOnSubmitAttempt'), true);
  assert.equal(src.includes('addSubmitDismissed'), true);
  assert.equal(src.includes('installReleaseSubmitWatcher'), true);
  assert.equal(src.includes('待提交'), true);
  assert.equal(src.includes('已从待发布移除（已点击 Submit）'), true);
  assert.equal(src.includes('verifyPendingSubmitBySeriesScan'), false);
});
