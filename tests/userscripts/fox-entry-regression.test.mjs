import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('fox script should not expose single-edit config entry', () => {
  const src = fs.readFileSync('userscripts/foxaholic-helper.user.js', 'utf8');
  assert.equal(src.includes('⚙️ 配置映射'), false);
  assert.equal(src.includes('🔄 立即扫描'), false);
});
