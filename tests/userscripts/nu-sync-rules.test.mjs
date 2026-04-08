import test from 'node:test';
import assert from 'node:assert/strict';
import rules from '../../userscripts/shared/nu-sync-rules.js';

test('sync rules should not expose global block helper', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(rules, 'shouldBlockRun'), false);
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
