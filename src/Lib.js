/**
 * 純邏輯工具：不呼叫任何 Apps Script 服務，所以也能在 Node 直接測試。
 * PALMS 報表解析、例會日期推算、簽到判定、寫入試算表前的文字保護都在這裡。
 */

/** PALMS 欄位（依 BNI Connect 報表順序） */
const PALMS_FIELDS = ['P', 'A', 'L', 'M', 'S', 'RGI', 'RGO', 'RRI', 'RRO', 'V', '121', 'TYFCB', 'CEU', 'T'];

const PALMS_LABELS = {
  P: '出席', A: '缺席', L: '遲到', M: '病假', S: '代理',
  RGI: '內部引薦(給)', RGO: '外部引薦(給)', RRI: '內部引薦(收)', RRO: '外部引薦(收)',
  V: '來賓', '121': '一對一', TYFCB: '感謝成交', CEU: '教育學分', T: '見證'
};

/** 報表標題列可能出現的寫法（比對前會轉小寫、去掉空白與符號） */
const PALMS_HEADER_ALIASES = {
  firstName: ['First Name', 'First', '名', '名字'],
  lastName: ['Last Name', 'Last', '姓', '姓氏'],
  name: ['Name', 'Member', 'Member Name', 'Full Name', '姓名', '會員', '會員姓名'],
  P: ['P', 'Present', '出席'],
  A: ['A', 'Absent', '缺席'],
  L: ['L', 'Late', '遲到'],
  M: ['M', 'Medical', '病假', '醫療'],
  S: ['S', 'Substitute', '代理'],
  RGI: ['RGI', 'Referrals Given Inside', '內部引薦給予'],
  RGO: ['RGO', 'Referrals Given Outside', '外部引薦給予'],
  RRI: ['RRI', 'Referrals Received Inside', '內部引薦收到'],
  RRO: ['RRO', 'Referrals Received Outside', '外部引薦收到'],
  V: ['V', 'Visitor', 'Visitors', '來賓'],
  '121': ['1-2-1', '1-2-1s', 'One to One', 'One-to-Ones', '一對一'],
  TYFCB: ['TYFCB', 'Thank You For Closed Business', '感謝成交', '感謝成交金額'],
  CEU: ['CEU', 'CEUs', 'Chapter Education Units', '教育學分'],
  T: ['T', 'Testimonial', 'Testimonials', '見證']
};

function normalizeHeader(value) {
  return String(value == null ? '' : value).toLowerCase().replace(/[\s\-_.:：()（）\/#'’]+/g, '');
}

const PALMS_HEADER_LOOKUP = (function () {
  const lookup = {};
  Object.keys(PALMS_HEADER_ALIASES).forEach(function (key) {
    PALMS_HEADER_ALIASES[key].forEach(function (alias) {
      lookup[normalizeHeader(alias)] = key;
    });
  });
  return lookup;
})();

function toNumber(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  const n = parseFloat(String(value == null ? '' : value).replace(/[^\d.\-]/g, ''));
  return isFinite(n) ? n : 0;
}

const CJK_RE = /[㐀-鿿豈-﫿]/;

/** BNI Connect 把姓名拆成 First / Last：中文名合併成「姓+名」，英文名維持「First Last」 */
function joinName(first, last) {
  first = String(first == null ? '' : first).trim();
  last = String(last == null ? '' : last).trim();
  if (!first || !last) return first || last;
  if (!CJK_RE.test(first + last)) return first + ' ' + last;
  return first.indexOf(last) === 0 ? first : last + first;
}

/** 比對姓名用：忽略空白與大小寫 */
function nameKey(name) {
  return String(name == null ? '' : name).replace(/\s+/g, '').toLowerCase();
}

// ---------- 日期 ----------

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function isoDate(y, m, d) {
  y = Number(y);
  m = Number(m);
  d = Number(d);
  if (!(y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return '';
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}

// 2026-10-08、2026/10/8、2026年10月8日，或美式 10/8/2026
const DATE_PATTERN_ = '(\\d{4})\\s*[\\/\\-.年]\\s*(\\d{1,2})\\s*[\\/\\-.月]\\s*(\\d{1,2})\\s*日?' +
  '|(\\d{1,2})\\s*[\\/\\-.]\\s*(\\d{1,2})\\s*[\\/\\-.]\\s*(\\d{4})';
const PERIOD_FROM_RE_ = new RegExp('(?:from|start|起|開始)[^\\d\\n]{0,12}(?:' + DATE_PATTERN_ + ')', 'i');
const PERIOD_TO_RE_ = new RegExp('(?:\\bto\\b|end|迄|至|結束|~|～)[^\\d\\n]{0,12}(?:' + DATE_PATTERN_ + ')', 'i');

function matchToIso_(m) {
  if (m[1]) return isoDate(m[1], m[2], m[3]);
  let month = Number(m[4]);
  let day = Number(m[5]);
  if (month > 12 && day <= 12) { // 日/月/年
    const t = month;
    month = day;
    day = t;
  }
  return isoDate(m[6], month, day);
}

function parseDateLoose(value) {
  const m = new RegExp(DATE_PATTERN_).exec(String(value == null ? '' : value));
  return m ? matchToIso_(m) : '';
}

function findDates_(text) {
  const re = new RegExp(DATE_PATTERN_, 'g');
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const iso = matchToIso_(m);
    if (iso && found.indexOf(iso) < 0) found.push(iso);
  }
  return found;
}

function orderedPeriod_(a, b) {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

function periodFromText_(text) {
  const fromMatch = PERIOD_FROM_RE_.exec(text);
  const toMatch = PERIOD_TO_RE_.exec(text);
  const from = fromMatch ? matchToIso_(fromMatch) : '';
  const to = toMatch ? matchToIso_(toMatch) : '';
  if (from && to) return orderedPeriod_(from, to);
  const dates = findDates_(text);
  if (dates.length === 1) return { from: dates[0], to: dates[0] };
  if (dates.length === 2) return orderedPeriod_(dates[0], dates[1]);
  return null;
}

/** 從報表標題區（或檔名）找出 PALMS 期間；找不到回傳 null，由使用者手動填 */
function findPeriod(rows, fileName) {
  const text = rows.map(function (r) { return r.join(' '); }).join('\n');
  return periodFromText_(text) || (fileName ? periodFromText_(String(fileName)) : null);
}

// ---------- PALMS 報表 ----------

function findPalmsHeader_(grid) {
  let best = null;
  const limit = Math.min(grid.length, 50);
  for (let r = 0; r < limit; r++) {
    const map = {};
    const unknown = [];
    grid[r].forEach(function (cell, i) {
      if (!cell) return;
      const key = PALMS_HEADER_LOOKUP[normalizeHeader(cell)];
      if (!key) unknown.push(cell);
      else if (map[key] === undefined) map[key] = i;
    });
    const hasName = map.name !== undefined || map.firstName !== undefined || map.lastName !== undefined;
    const score = PALMS_FIELDS.filter(function (f) { return map[f] !== undefined; }).length;
    if (hasName && score >= 5 && (!best || score > best.score)) {
      best = { row: r, map: map, unknown: unknown, score: score };
    }
  }
  return best;
}

function isTotalName_(name) {
  return /^(total|totals|grand ?total)\b/i.test(name) || /^(合計|總計|小計|總和)/.test(name);
}

/**
 * 解析 PALMS 報表（二維陣列，例如 Excel 第一個工作表）。
 * 會自動找標題列，標題列上方的文字用來判斷期間。
 */
function parsePalms(rows, fileName) {
  const grid = (Array.isArray(rows) ? rows : []).map(function (row) {
    return (Array.isArray(row) ? row : []).map(function (cell) {
      return cell == null ? '' : String(cell).trim();
    });
  });
  const header = findPalmsHeader_(grid);
  if (!header) {
    throw new Error('找不到 PALMS 欄位標題（需要姓名欄與 P、A、L 等欄位），請確認上傳的是 PALMS 報表');
  }
  const map = header.map;
  const members = [];
  const skipped = [];
  for (let r = header.row + 1; r < grid.length; r++) {
    const row = grid[r];
    const name = map.name !== undefined ? row[map.name] || '' : joinName(row[map.firstName], row[map.lastName]);
    if (!name) continue;
    if (isTotalName_(name)) {
      skipped.push(name);
      continue;
    }
    const rec = { name: name };
    PALMS_FIELDS.forEach(function (f) {
      rec[f] = map[f] === undefined ? 0 : toNumber(row[map[f]]);
    });
    members.push(rec);
  }
  if (!members.length) throw new Error('PALMS 報表裡沒有會員資料');
  return {
    period: findPeriod(grid.slice(0, header.row), fileName),
    members: members,
    columns: PALMS_FIELDS.filter(function (f) { return map[f] !== undefined; }),
    missing: PALMS_FIELDS.filter(function (f) { return map[f] === undefined; }),
    unknown: header.unknown,
    skipped: skipped
  };
}

function roundMoney_(n) {
  return Math.round(n * 100) / 100;
}

/** 依姓名加總多期 PALMS，並標出缺席達提醒次數的會員 */
function summarizePalms(records, absenceAlert) {
  const byKey = {};
  const order = [];
  const periodMap = {};
  (records || []).forEach(function (r) {
    const key = nameKey(r.name);
    if (!key) return;
    if (!byKey[key]) {
      byKey[key] = { name: String(r.name).trim(), periods: 0 };
      PALMS_FIELDS.forEach(function (f) { byKey[key][f] = 0; });
      order.push(key);
    }
    const m = byKey[key];
    m.periods += 1;
    PALMS_FIELDS.forEach(function (f) { m[f] += toNumber(r[f]); });
    if (r.from && r.to) periodMap[r.from + '|' + r.to] = { from: r.from, to: r.to };
  });
  const totals = { referralsGiven: 0 };
  PALMS_FIELDS.forEach(function (f) { totals[f] = 0; });
  const members = order.map(function (key) {
    const m = byKey[key];
    m.TYFCB = roundMoney_(m.TYFCB);
    m.referralsGiven = m.RGI + m.RGO;
    m.alert = absenceAlert > 0 && m.A >= absenceAlert;
    PALMS_FIELDS.forEach(function (f) { totals[f] += m[f]; });
    totals.referralsGiven += m.referralsGiven;
    return m;
  });
  totals.TYFCB = roundMoney_(totals.TYFCB);
  const periods = Object.keys(periodMap).sort().map(function (k) { return periodMap[k]; });
  return { members: members, totals: totals, periods: periods, overlaps: findOverlaps(periods) };
}

/** 期間互相重疊時（例如同時匯入週報與半年報），加總會重複計算 */
function findOverlaps(periods) {
  const sorted = periods.slice().sort(function (a, b) {
    return a.from < b.from ? -1 : a.from > b.from ? 1 : 0;
  });
  const overlaps = [];
  for (let i = 1; i < sorted.length; i++) {
    for (let j = 0; j < i; j++) {
      if (sorted[i].from <= sorted[j].to) overlaps.push([sorted[j], sorted[i]]);
    }
  }
  return overlaps;
}

function formatNumber(n) {
  return String(Math.round(toNumber(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function topMembers_(members, key, n) {
  return members.filter(function (m) { return m[key] > 0; })
    .sort(function (a, b) { return b[key] - a[key]; })
    .slice(0, n);
}

/** 可直接貼到 LINE 群組的 PALMS 週報 */
function buildPalmsLineText(chapterName, from, to, summary) {
  const t = summary.totals;
  const days = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;
  const lines = [
    '【' + chapterName + '｜PALMS ' + (days <= 7 ? '週報' : '報告') + '】',
    '期間：' + (from === to ? from : from + ' ～ ' + to),
    '',
    '✅ 出席 ' + t.P + '｜遲到 ' + t.L + '｜代理 ' + t.S + '｜病假 ' + t.M + '｜缺席 ' + t.A,
    '🤝 引薦 ' + formatNumber(t.referralsGiven) + ' 筆（內部 ' + formatNumber(t.RGI) + '／外部 ' + formatNumber(t.RGO) + '）',
    '🙋 來賓 ' + formatNumber(t.V) + ' 位',
    '☕ 一對一 ' + formatNumber(t['121']) + ' 次',
    '💰 感謝成交 NT$' + formatNumber(t.TYFCB),
    '📚 教育學分 ' + formatNumber(t.CEU) + '｜見證 ' + formatNumber(t.T)
  ];
  const stars = [
    ['引薦', 'referralsGiven', ''],
    ['一對一', '121', ''],
    ['來賓', 'V', ''],
    ['感謝成交', 'TYFCB', 'NT$']
  ].map(function (s) {
    const top = topMembers_(summary.members, s[1], 3);
    return top.length ? s[0] + '：' + top.map(function (m) {
      return m.name + ' ' + s[2] + formatNumber(m[s[1]]);
    }).join('、') : '';
  }).filter(Boolean);
  if (stars.length) {
    lines.push('', '🏆 本期之星');
    stars.forEach(function (l) { lines.push(l); });
  }
  return lines.join('\n');
}

// ---------- 例會與簽到 ----------

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

/** 「四」「星期四」「週四」「4」「Thu」都可以；無法辨識回傳 -1 */
function parseWeekday(value) {
  const s = String(value == null ? '' : value).trim().toLowerCase().replace(/^(星期|週|周|禮拜)/, '');
  const zh = { '日': 0, '天': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
  if (Object.prototype.hasOwnProperty.call(zh, s)) return zh[s];
  if (/^[0-7]$/.test(s)) return Number(s) % 7;
  return s.length >= 3 ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(s.slice(0, 3)) : -1;
}

function weekdayOf(iso) {
  return new Date(iso + 'T00:00:00Z').getUTCDay();
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

/** 今天就是例會日則回傳今天 */
function nextMeetingDate(todayIso, weekday) {
  if (!(weekday >= 0 && weekday <= 6)) return todayIso;
  return addDays(todayIso, (weekday - weekdayOf(todayIso) + 7) % 7);
}

function upcomingMeetings(todayIso, weekday, count) {
  const first = nextMeetingDate(todayIso, weekday);
  const list = [];
  for (let i = 0; i < count; i++) list.push(addDays(first, i * 7));
  return list;
}

function normalizeTime(value) {
  const m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(String(value == null ? '' : value));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return '';
  return pad2_(Number(m[1])) + ':' + m[2];
}

/** 超過遲到判定時間才簽到記為 L，否則 P */
function checkinStatus(nowTime, lateAfter) {
  const now = normalizeTime(nowTime);
  const limit = normalizeTime(lateAfter);
  return now && limit && now > limit ? 'L' : 'P';
}

// ---------- 試算表讀寫 ----------

/**
 * 寫進試算表的文字前面加 ' 強制成純文字：
 * 避免電話開頭的 0 被吃掉、日期被自動轉換、或來賓輸入的內容被當成公式執行。
 */
function toSheetText(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s === '') return '';
  if (/^[=+\-@']/.test(s) || /^[\d\s\/.:,()%$+\-]+$/.test(s) || /^(true|false)$/i.test(s)) return "'" + s;
  return s;
}

/** 在試算表手動輸入手機時，09 開頭的 0 常被吃掉 */
function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(Math.round(value)) : String(value).trim();
  return /^9\d{8}$/.test(s) ? '0' + s : s;
}

function isActiveMember(status) {
  return !/(離會|退會|停權|暫停|休會|inactive|left)/i.test(String(status == null ? '' : status));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PALMS_FIELDS, PALMS_LABELS, WEEKDAY_LABELS,
    normalizeHeader, toNumber, joinName, nameKey, isoDate, parseDateLoose, findPeriod, parsePalms,
    summarizePalms, findOverlaps, formatNumber, buildPalmsLineText,
    parseWeekday, weekdayOf, addDays, nextMeetingDate, upcomingMeetings, normalizeTime, checkinStatus,
    toSheetText, normalizePhone, isActiveMember
  };
}
