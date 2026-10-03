/**
 * 試算表存取：每張資料表第一列是標題，其餘每列一筆資料。
 *
 * - Db.read 回傳的 table 會帶著工作表與欄位位置，後續的 append / update / softDelete 都用它。
 * - 同一次請求內，同一張表只讀一次（快取）；寫入會同步更新快取。進入 withLock_ 時清空快取，確保鎖內讀到最新資料。
 * - 有「已刪除」欄的表一律軟刪除，Db.read 預設不回傳已刪除的列。
 */

function ss_() {
  if (Db.ss_) return Db.ss_;
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('找不到資料試算表：請在試算表選單執行「BNI 分會工具 → 初始化資料表」');
    ss = SpreadsheetApp.openById(id);
  }
  Db.ss_ = ss;
  return ss;
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Taipei';
}

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function fromCell_(v, type, tz) {
  if (type === 'number') return toNumber(v);
  if (v === null || v === undefined || v === '') return '';
  if (isDate_(v)) {
    if (v.getFullYear() < 1900) return Utilities.formatDate(v, tz, 'HH:mm'); // 只有時間的儲存格
    const time = Utilities.formatDate(v, tz, 'HH:mm:ss');
    return Utilities.formatDate(v, tz, time === '00:00:00' ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  }
  if (typeof v === 'boolean') return v ? '是' : '';
  if (type === 'phone') return normalizePhone(v);
  return String(v).trim();
}

function toCell_(v, type, plainText) {
  if (type === 'number') return toNumber(v);
  if (plainText) return v === null || v === undefined ? '' : String(v);
  return toSheetText(v);
}

function isAlive_(row) {
  return !row.deleted;
}

const Db = {
  cache_: {},
  ss_: null,

  /** 每次請求開始時呼叫（Apps Script 每次執行本來就是新的環境，這是給測試與本機預覽用） */
  reset: function () {
    Db.cache_ = {};
    Db.ss_ = null;
  },

  sheet: function (def) {
    const ss = ss_();
    let sh = ss.getSheetByName(def.name);
    if (!sh) {
      sh = ss.insertSheet(def.name);
      Db.initSheet_(sh, def);
    }
    return sh;
  },

  initSheet_: function (sh, def) {
    const titles = def.columns.map(function (c) { return c.title; });
    if (def.plainText) sh.getRange(1, 1, sh.getMaxRows(), titles.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, titles.length)
      .setValues([titles.map(function (t) { return toCell_(t, 'text', def.plainText); })])
      .setFontWeight('bold')
      .setBackground('#f3f3f3');
    sh.setFrozenRows(1);
    (def.widths || []).forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    const seed = def.seed ? def.seed() : [];
    if (seed.length) {
      sh.getRange(2, 1, seed.length, titles.length).setValues(seed.map(function (row) {
        return row.map(function (v, i) { return toCell_(v, def.columns[i].type, def.plainText); });
      }));
    }
  },

  /** 依標題找欄位；被刪掉的欄位補回最右邊 */
  layout_: function (sh, def) {
    const lastCol = sh.getLastColumn();
    const header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h).trim();
    }) : [];
    let width = header.length;
    while (width > 0 && header[width - 1] === '') width--;
    const col = {};
    const missing = [];
    def.columns.forEach(function (c) {
      const i = header.indexOf(c.title);
      if (i >= 0) col[c.key] = i;
      else missing.push(c);
    });
    if (missing.length) {
      const extraCols = width + missing.length - sh.getMaxColumns();
      if (extraCols > 0) sh.insertColumnsAfter(sh.getMaxColumns(), extraCols);
      sh.getRange(1, width + 1, 1, missing.length)
        .setValues([missing.map(function (c) { return toCell_(c.title, 'text', def.plainText); })])
        .setFontWeight('bold')
        .setBackground('#f3f3f3');
      missing.forEach(function (c, i) { col[c.key] = width + i; });
      width += missing.length;
    }
    return { col: col, width: width };
  },

  load_: function (def) {
    const sh = Db.sheet(def);
    const layout = Db.layout_(sh, def);
    const lastRow = sh.getLastRow();
    const all = [];
    if (lastRow >= 2) {
      const tz = tz_();
      sh.getRange(2, 1, lastRow - 1, layout.width).getValues().forEach(function (values, i) {
        if (values.every(function (v) { return v === '' || v === null; })) return;
        const obj = { _row: i + 2 };
        def.columns.forEach(function (c) {
          obj[c.key] = fromCell_(values[layout.col[c.key]], c.type, tz);
        });
        all.push(obj);
      });
    }
    return { def: def, sheet: sh, layout: layout, all: all };
  },

  /** opts.includeDeleted：連已刪除的列一起回傳 */
  read: function (def, opts) {
    let base = Db.cache_[def.name];
    if (!base) {
      base = Db.load_(def);
      Db.cache_[def.name] = base;
    }
    return {
      def: def,
      sheet: base.sheet,
      layout: base.layout,
      base: base,
      rows: opts && opts.includeDeleted ? base.all.slice() : base.all.filter(isAlive_)
    };
  },

  append: function (table, objs) {
    if (!objs.length) return;
    const def = table.def;
    const layout = table.layout;
    const values = objs.map(function (o) {
      const row = [];
      for (let i = 0; i < layout.width; i++) row.push('');
      def.columns.forEach(function (c) {
        row[layout.col[c.key]] = toCell_(o[c.key], c.type, def.plainText);
      });
      return row;
    });
    const sh = table.sheet;
    const start = sh.getLastRow() + 1;
    // 工作表列數用完時要先加列，否則 getRange 會超出範圍
    const extraRows = start + values.length - 1 - sh.getMaxRows();
    if (extraRows > 0) sh.insertRowsAfter(sh.getMaxRows(), extraRows);
    sh.getRange(start, 1, values.length, layout.width).setValues(values);
    objs.forEach(function (o, i) {
      const obj = { _row: start + i };
      def.columns.forEach(function (c) {
        const v = o[c.key];
        obj[c.key] = c.type === 'number' ? toNumber(v) : (v === null || v === undefined ? '' : String(v));
      });
      table.base.all.push(obj);
      if (isAlive_(obj)) table.rows.push(obj);
    });
  },

  /** 只寫有變動的欄位，不會動到使用者自己加的欄位 */
  update: function (table, rowNum, patch) {
    const cached = table.base.all.filter(function (r) { return r._row === rowNum; })[0];
    table.def.columns.forEach(function (c) {
      if (!Object.prototype.hasOwnProperty.call(patch, c.key)) return;
      table.sheet.getRange(rowNum, table.layout.col[c.key] + 1)
        .setValue(toCell_(patch[c.key], c.type, table.def.plainText));
      if (cached) cached[c.key] = c.type === 'number' ? toNumber(patch[c.key]) : String(patch[c.key] == null ? '' : patch[c.key]);
    });
  },

  /** 軟刪除：標記「已刪除」，資料留在試算表 */
  softDelete: function (table, rowNum) {
    Db.update(table, rowNum, { deleted: '是' });
    table.rows = table.rows.filter(function (r) { return r._row !== rowNum; });
  }
};

/**
 * 寫入前取得鎖，避免多台裝置同時操作時互相覆蓋；鎖內一律重新讀取資料。
 * 已經在鎖內時直接執行（可巢狀呼叫）。
 */
function withLock_(fn) {
  if (withLock_.depth > 0) return fn();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('系統忙碌中，請稍後再試一次');
  withLock_.depth = 1;
  try {
    Db.cache_ = {};
    const result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    withLock_.depth = 0;
    lock.releaseLock();
  }
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}
