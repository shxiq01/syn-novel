import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('nu script should not keep common panel or submit watcher hooks', () => {
  const src = fs.readFileSync('userscripts/novelupdates-helper.user.js', 'utf8');
  assert.equal(src.includes('const initCommonPanel ='), false);
  assert.equal(src.includes('const installSubmitWatcher ='), false);
});
