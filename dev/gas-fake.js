'use strict';
/**
 * 假的 Apps Script 環境（記憶體裡的試算表），讓 src/ 的伺服器程式可以在 Node 測試與本機預覽。
 * 刻意模擬 Google 試算表會「自動轉型」的行為：沒加 ' 的電話會變數字、日期字串會變 Date、
 * 公式字串會被執行（這裡直接丟錯），用來抓出寫入前沒處理好的資料。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const TZ = 'Asia/Taipei';

function tzParts(date, tz) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  return parts;
}

function formatDate(date, tz, pattern) {
  const p = tzParts(date, tz);
  const map = { yyyy: p.year, MM: p.month, dd: p.day, HH: p.hour, mm: p.minute, ss: p.second };
  return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, (t) => map[t]);
}

function zonedDate(y, m, d, hh, mi, ss, tz) {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mi, ss));
  const p = tzParts(guess, tz);
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess.getTime();
  return new Date(guess.getTime() - offset);
}

/** 模擬使用者輸入時 Google 試算表的自動判斷 */
function convertInput(v, isTextCol, tz) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  if (isTextCol || v === '') return v;
  const s = v.trim();
  if (/^[=+\-@]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) {
    throw new Error('假試算表：寫入了會被當成公式的字串 ' + JSON.stringify(v));
  }
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  let m;
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) {
    return zonedDate(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), tz);
  }
  if ((m = /^(\d{1,2})-(\d{1,2})-(\d{1,2})$/.exec(s))) return zonedDate(2000 + +m[3], +m[1], +m[2], 0, 0, 0, tz);
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(s))) return zonedDate(1899, 12, 30, +m[1], +m[2], 0, tz);
  return v;
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet.cell(this.row, this.col); }
  setValues(values) {
    if (values.length !== this.numRows || values.some((line) => line.length !== this.numCols)) {
      throw new Error(`假試算表：資料大小與範圍不符（範圍 ${this.numRows}x${this.numCols}）`);
    }
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.write(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.write(this.row, this.col, v); return this; }
  setNumberFormat(fmt) {
    if (fmt === '@') for (let c = 0; c < this.numCols; c++) this.sheet.textCols.add(this.col + c);
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class FakeSheet {
  constructor(ss, name) {
    this.ss = ss;
    this.name = name;
    this.data = [];
    this.textCols = new Set();
    this.maxRows = 1000;
    this.maxCols = 26;
  }
  getName() { return this.name; }
  cell(r, c) {
    const line = this.data[r - 1];
    return line && line[c - 1] !== undefined ? line[c - 1] : '';
  }
  write(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const line = this.data[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = convertInput(v, this.textCols.has(c), this.ss.tz);
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if (this.data[r - 1].some((v) => v !== '')) return r;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach((line) => line.forEach((v, i) => { if (v !== '' && i + 1 > max) max = i + 1; }));
    return max;
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  insertColumnsAfter(after, n) { this.maxCols += n; }
  getRange(row, col, numRows = 1, numCols = 1) {
    if (row < 1 || col < 1 || numRows < 1 || numCols < 1 ||
        row + numRows - 1 > this.maxRows || col + numCols - 1 > this.maxCols) {
      throw new Error(`假試算表：範圍超出工作表 (${row},${col},${numRows},${numCols})`);
    }
    return new FakeRange(this, row, col, numRows, numCols);
  }
  getDataRange() {
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }
  deleteRows(row, n) { this.data.splice(row - 1, n); this.maxRows -= n; }
  deleteRow(row) { this.deleteRows(row, 1); }
  setFrozenRows() {}
  setColumnWidth() {}

  /** 測試用：模擬使用者在試算表手動輸入（會自動轉型） */
  typeRow(values) {
    const r = this.getLastRow() + 1;
    values.forEach((v, i) => this.write(r, i + 1, v));
  }
  /** 測試用：以標題列轉成物件 */
  objects() {
    const [header, ...rows] = this.data;
    return rows.filter((l) => l.some((v) => v !== '')).map((l) => Object.fromEntries(header.map((h, i) => [h, l[i] === undefined ? '' : l[i]])));
  }
}

class FakeSpreadsheet {
  constructor(tz) { this.tz = tz; this.sheets = []; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) || null; }
  insertSheet(name) {
    if (this.getSheetByName(name)) throw new Error('工作表已存在：' + name);
    const s = new FakeSheet(this, name);
    this.sheets.push(s);
    return s;
  }
  getId() { return 'fake-spreadsheet'; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/fake-spreadsheet/edit'; }
}

class FakeProps {
  constructor() { this.map = {}; }
  getProperty(k) { return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null; }
  setProperty(k, v) { this.map[k] = String(v); return this; }
  deleteProperty(k) { delete this.map[k]; return this; }
}

class FakeCache {
  constructor() { this.map = {}; }
  get(k) { return Object.prototype.hasOwnProperty.call(this.map, k) ? this.map[k] : null; }
  put(k, v) { this.map[k] = String(v); }
  remove(k) { delete this.map[k]; }
}

/** Apps Script 的 HMAC 回傳有正負號的 byte 陣列 */
function hmacSha256Bytes(value, key) {
  return Array.from(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b));
}

/** 寄信：記錄寄出的信，模擬每日額度 */
function createMailApp(outbox) {
  const state = { quota: 100 };
  return {
    state,
    getRemainingDailyQuota: () => state.quota,
    sendEmail(message) {
      if (typeof message !== 'object') throw new Error('假 MailApp 只支援物件參數');
      if (state.quota <= 0) throw new Error('Service invoked too many times for one day: email.');
      if (!/@/.test(message.to || '')) throw new Error('Invalid email: ' + message.to);
      state.quota -= 1;
      outbox.push(JSON.parse(JSON.stringify(message)));
    }
  };
}

/** 外部 API：測試可以設定 handler(url, options) 回傳 { code, body } */
function createUrlFetchApp(requests) {
  const api = {
    handler: () => ({ code: 200, body: '{}' }),
    fetch(url, options) {
      const opts = options || {};
      requests.push({ url, method: (opts.method || 'get').toLowerCase(), headers: opts.headers || {}, payload: opts.payload || '' });
      const res = api.handler(url, opts) || { code: 200, body: '{}' };
      if (res.code >= 400 && !opts.muteHttpExceptions) throw new Error('Request failed for ' + url + ' returned code ' + res.code);
      return { getResponseCode: () => res.code, getContentText: () => (typeof res.body === 'string' ? res.body : JSON.stringify(res.body)) };
    }
  };
  return api;
}

/** 觸發器：只記錄建立與刪除 */
function createTriggerStore() {
  const triggers = [];
  let seq = 0;
  const builder = (handler) => {
    const spec = { handler, every: 0 };
    const chain = {
      timeBased: () => chain,
      everyHours: (n) => { spec.every = n; return chain; },
      create: () => {
        const t = { id: 't' + (++seq), getHandlerFunction: () => handler, getUniqueId: () => 't' + seq, spec };
        triggers.push(t);
        return t;
      }
    };
    return chain;
  };
  return {
    triggers,
    getProjectTriggers: () => triggers.slice(),
    newTrigger: builder,
    deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); }
  };
}

/**
 * 建立假環境並載入 src/*.js。
 * order: 'normal' | 'reverse'（檔案載入順序，用來確認沒有載入順序的相依）
 * url: 網頁應用程式網址，可以是字串或回傳字串的函式
 */
function createServer({ srcDir = path.join(__dirname, '..', 'src'), order = 'normal', url = 'https://script.google.com/macros/s/fake/exec' } = {}) {
  const ss = new FakeSpreadsheet(TZ);
  const scriptProps = new FakeProps();
  const cache = new FakeCache();
  const outbox = [];
  const requests = [];
  const mail = createMailApp(outbox);
  const urlFetch = createUrlFetchApp(requests);
  const triggerStore = createTriggerStore();
  const env = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ss,
      flush() {},
      getUi() { throw new Error('網頁環境沒有試算表 UI'); }
    },
    PropertiesService: { getScriptProperties: () => scriptProps, getUserProperties: () => new FakeProps() },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: hmacSha256Bytes
    },
    Session: { getScriptTimeZone: () => TZ },
    ScriptApp: {
      getService: () => ({ getUrl: () => (typeof url === 'function' ? url() : url) }),
      getProjectTriggers: triggerStore.getProjectTriggers,
      newTrigger: triggerStore.newTrigger,
      deleteTrigger: triggerStore.deleteTrigger
    },
    MailApp: mail,
    UrlFetchApp: urlFetch,
    ContentService: {
      MimeType: { TEXT: 'text/plain', JSON: 'application/json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent() { return this.text; } })
    },
    console: { log() {}, error() {} }
  };
  const ctx = vm.createContext(env);
  let files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).sort();
  if (order === 'reverse') files = files.reverse();
  files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(srcDir, f), 'utf8'), ctx, { filename: f }));

  /** 固定「現在時間」，例如 '2026-10-08T07:05:00+08:00' */
  function setNow(iso) {
    ctx.nowDate_ = iso ? () => new Date(iso) : () => new Date();
  }

  /** 模擬 google.script.run：參數與回傳值都經過 JSON，且回傳值不能含 Date（Apps Script 的限制） */
  function call(fn, ...args) {
    const result = ctx[fn](...JSON.parse(JSON.stringify(args)));
    assertNoDate(result, fn);
    return JSON.parse(JSON.stringify(result === undefined ? null : result));
  }

  function api(action, data, token) {
    return call('apiCall', { action, data: data || {}, token: token || '' });
  }

  /** 模擬從試算表選單建立帳號（不經過網頁） */
  function createAccount(fields) {
    vm.runInContext('Db.reset()', ctx); // Db 是 const，不在全域物件上
    return JSON.parse(JSON.stringify(ctx.createAccount_(fields)));
  }

  /** 登入並回傳 token；失敗直接丟錯 */
  function login(username, password) {
    const res = api('auth.login', { username, password });
    if (!res.ok) throw new Error(res.error);
    return res.data.token;
  }

  return {
    ctx, ss, scriptProps, cache, setNow, call, api, createAccount, login,
    outbox, mail: mail.state, requests, urlFetch, triggers: triggerStore.triggers
  };
}

function assertNoDate(value, where) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    throw new Error(`${where} 回傳了 Date 物件，google.script.run 無法傳回`);
  }
  if (value && typeof value === 'object') Object.keys(value).forEach((k) => assertNoDate(value[k], where + '.' + k));
}

module.exports = { createServer, formatDate, convertInput, TZ };
