#!/usr/bin/env node
'use strict';
/**
 * 打包成「在瀏覽器複製貼上就能部署」的 4 個檔案，不用安裝 Node 或 clasp：
 *   dist/1-Code.gs.txt          所有伺服器程式（src/*.js 依檔名順序合併）→ 貼到 Code.gs
 *   dist/2-appsscript.json.txt  專案設定 → 貼到 appsscript.json
 *   dist/3-App.html.txt         管理系統（Styles、各功能頁等 include 已內嵌）→ 新增 HTML 檔 App
 *   dist/4-Register.html.txt    報名頁 → 新增 HTML 檔 Register
 * 用 .txt 是因為瀏覽器、Mac 文字編輯會把 .html 顯示成網頁，沒辦法複製原始碼。
 *
 *   npm run bundle
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { renderTemplate } = require('./server');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function version() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (e) {
    return '未知版本';
  }
}

/** 回傳 { 檔名: 內容 }；HTML 內嵌後不能再有 Apps Script 的模板標籤 */
function buildBundle() {
  const stamp = 'BNI 分會管理系統｜打包版本 ' + version() + '（' + new Date().toISOString().slice(0, 10) + '）';
  const js = fs.readdirSync(SRC).filter((f) => f.endsWith('.js')).sort().map((f) =>
    '// ===== ' + f + ' =====\n' + fs.readFileSync(path.join(SRC, f), 'utf8').trim() + '\n');
  const html = (name) => {
    const out = renderTemplate(name);
    if (/<\?/.test(out)) throw new Error(name + '.html 內嵌後還有模板標籤 <?，打包版無法使用');
    return out.trimEnd() + '\n<!-- ' + stamp + '：由 npm run bundle 產生，請勿直接修改 -->\n'; // 放最後，DOCTYPE 要在最前面
  };
  return {
    '1-Code.gs.txt': '// ' + stamp + '：由 npm run bundle 產生，請勿直接修改\n\n' + js.join('\n'),
    '2-appsscript.json.txt': fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'),
    '3-App.html.txt': html('App'),
    '4-Register.html.txt': html('Register')
  };
}

function writeBundle(outDir) {
  const files = buildBundle();
  fs.mkdirSync(outDir, { recursive: true });
  Object.keys(files).forEach((name) => fs.writeFileSync(path.join(outDir, name), files[name]));
  return Object.keys(files).map((name) => path.join(outDir, name));
}

if (require.main === module) {
  const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
  writeBundle(out).forEach((f) => console.log(path.relative(ROOT, f) + '（' + Math.round(fs.statSync(f).size / 1024) + ' KB）'));
}

module.exports = { buildBundle, writeBundle };
