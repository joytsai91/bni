#!/usr/bin/env node
'use strict';
/**
 * 本機預覽：用假的 Apps Script 環境（記憶體裡的試算表）執行 src/，並模擬 google.script.run，
 * 不用部署就能在瀏覽器操作完整畫面。資料只存在記憶體，關掉就清空。
 *
 *   npm run dev                     → http://127.0.0.1:8080（管理密碼 1234，含示範資料）
 *   http://127.0.0.1:8080/exec?page=register → 來賓報名頁
 *   DEV_NOW=2026-10-08T07:05:00+08:00 npm run dev → 固定「現在時間」測試遲到判定
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createServer: createGas } = require('./gas-fake');
const { seed } = require('./seed');

const SRC = path.join(__dirname, '..', 'src');
const XLSX_FILE = path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js');

function renderTemplate(name) {
  return fs.readFileSync(path.join(SRC, name + '.html'), 'utf8')
    .replace(/<\?!=\s*include\('([^']+)'\)\s*\?>/g, (_, inc) => renderTemplate(inc));
}

function devPage(name) {
  return renderTemplate(name)
    .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g, '')
    .replace('<head>', '<head><script src="/__dev/shim.js"></script>')
    .replace(/https:\/\/cdn\.sheetjs\.com\/[^'"]+/g, '/__dev/xlsx.js')
    .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcodejs\/[^'"]+/g, '/__dev/qrcode.js');
}

// 模擬 google.script.run 與 google.script.url
const SHIM = `(function () {
  function runner(success, failure) {
    return new Proxy({}, {
      get: function (_, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return runner(fn, failure); };
        if (prop === 'withFailureHandler') return function (fn) { return runner(success, fn); };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          fetch('/__rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fn: prop, args: args }) })
            .then(function (r) { return r.json(); })
            .then(function (res) {
              setTimeout(function () {
                if (res.error) { if (failure) failure(new Error(res.error)); }
                else if (success) success(res.value);
              }, 80);
            })
            .catch(function (err) { if (failure) failure(err); });
        };
      }
    });
  }
  var params = {};
  new URLSearchParams(location.search).forEach(function (v, k) { params[k] = v; });
  window.google = { script: { run: runner(null, null), url: { getLocation: function (cb) { cb({ parameter: params, parameters: {}, hash: '' }); } } } };
})();`;

const QR_STUB = `window.QRCode = function (el, o) {
  var d = document.createElement('div');
  d.textContent = 'QR：' + o.text;
  d.style.cssText = 'font-size:10px;word-break:break-all;border:1px dashed #999;width:132px;height:132px;overflow:hidden;padding:4px';
  el.appendChild(d);
};
window.QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };`;

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function start({ port = 8080, now = process.env.DEV_NOW, withSeed = true } = {}) {
  let actualPort = port;
  const gas = createGas({ url: () => `http://127.0.0.1:${actualPort}/exec` });
  if (now) gas.setNow(now);
  const seeded = withSeed ? seed(gas) : null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST' && url.pathname === '/__rpc') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { fn, args } = JSON.parse(body);
            if (fn !== 'apiCall') throw new Error('本機預覽只開放 apiCall');
            send(res, 200, 'application/json', JSON.stringify({ value: gas.call(fn, ...args) }));
          } catch (err) {
            send(res, 200, 'application/json', JSON.stringify({ error: err.message }));
          }
        });
        return;
      }
      if (url.pathname === '/' || url.pathname === '/exec') {
        return send(res, 200, 'text/html', devPage(url.searchParams.get('page') === 'register' ? 'Register' : 'App'));
      }
      if (url.pathname === '/__dev/shim.js') return send(res, 200, 'text/javascript', SHIM);
      if (url.pathname === '/__dev/qrcode.js') return send(res, 200, 'text/javascript', QR_STUB);
      if (url.pathname === '/__dev/xlsx.js') return send(res, 200, 'text/javascript', fs.readFileSync(XLSX_FILE));
      send(res, 404, 'text/plain', 'not found');
    } catch (err) {
      send(res, 500, 'text/plain', err.stack);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      resolve({ server, gas, seeded, url: `http://127.0.0.1:${actualPort}` });
    });
  });
}

if (require.main === module) {
  const portArg = process.argv.indexOf('--port');
  start({ port: portArg > 0 ? Number(process.argv[portArg + 1]) : 8080 }).then(({ url, seeded }) => {
    console.log(`管理系統：${url}/exec（管理密碼 ${seeded.pin}）`);
    console.log(`來賓報名：${url}/exec?page=register`);
  });
}

module.exports = { start };
