'use strict';
/**
 * 打包版（複製貼上部署用）：合併成單一 Code.gs 後要能獨立執行，HTML 不能留下模板標籤。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildBundle } = require('../dev/bundle');
const { createServer } = require('../dev/gas-fake');

test('打包版：單一 Code.gs 可以獨立執行，HTML 已內嵌所有 include', () => {
  const files = buildBundle();
  assert.deepEqual(Object.keys(files), ['1-Code.gs.txt', '2-appsscript.json.txt', '3-App.html.txt', '4-Register.html.txt']);
  for (const name of ['3-App.html.txt', '4-Register.html.txt']) {
    assert.ok(!/<\?/.test(files[name]), name + ' 不能有模板標籤');
    assert.ok(files[name].startsWith('<!DOCTYPE html>'), name + ' 要以 DOCTYPE 開頭');
  }
  assert.match(files['3-App.html.txt'], /App\.registerPage\('line'/);
  assert.match(files['4-Register.html.txt'], /id="reg-title"/);
  assert.equal(JSON.parse(files['2-appsscript.json.txt']).webapp.access, 'ANYONE_ANONYMOUS');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bni-bundle-'));
  fs.writeFileSync(path.join(dir, 'Code.js'), files['1-Code.gs.txt']);
  const s = createServer({ srcDir: dir });
  s.createAccount({ username: 'joy', displayName: 'Joy', roles: '系統管理員', password: 'joy-pass-123' });
  const token = s.login('joy', 'joy-pass-123');
  const boot = s.api('app.bootstrap', {}, token);
  assert.equal(boot.ok, true, boot.error);
  assert.equal(boot.data.settings.chapterName, 'BNI 台中市中心區湧泉分會');
  for (const action of ['home.data', 'finance.page', 'mail.page', 'line.page', 'members.list']) {
    const res = s.api(action, {}, token);
    assert.equal(res.ok, true, action + '：' + res.error);
  }
  assert.equal(s.api('public.bootstrap').ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
