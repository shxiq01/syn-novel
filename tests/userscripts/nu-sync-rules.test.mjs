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

test('missing nuSlug must fail hard', () => {
  const result = rules.validateSyncInput({ nuSlug: '' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'MISSING_NU_SLUG');
});
