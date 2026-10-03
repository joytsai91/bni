'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/Lib.js');

const BNI_EXPORT = [
  ['PALMS Summary Report'],
  ['Chapter:', 'BNI 示範分會'],
  ['Run At: 10/03/2026 09:00'],
  ['From: 9/26/2026 To: 10/2/2026'],
  [],
  ['First Name', 'Last Name', 'P', 'A', 'L', 'M', 'S', 'RGI', 'RGO', 'RRI', 'RRO', 'V', '1-2-1', 'TYFCB', 'CEU', 'T'],
  ['小明', '王', '1', '0', '0', '0', '0', '2', '1', '1', '0', '1', '2', '12,000', '1', '0'],
  ['David', 'Chen', '0', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ['Total', '', '1', '1', '0', '0', '0', '2', '1', '1', '0', '1', '2', '12000', '1', '0']
];

test('joinName：中文姓在前、英文名維持原順序', () => {
  assert.equal(L.joinName('小明', '王'), '王小明');
  assert.equal(L.joinName('David', 'Chen'), 'David Chen');
  assert.equal(L.joinName('王小明', '王'), '王小明');
  assert.equal(L.joinName('', '王'), '王');
  assert.equal(L.joinName('Anna', 'An'), 'Anna An');
});

test('parseDateLoose：常見日期寫法', () => {
  assert.equal(L.parseDateLoose('2026/10/8'), '2026-10-08');
  assert.equal(L.parseDateLoose('10/8/2026'), '2026-10-08');
  assert.equal(L.parseDateLoose('25/12/2026'), '2026-12-25');
  assert.equal(L.parseDateLoose('2026年10月8日'), '2026-10-08');
  assert.equal(L.parseDateLoose('2026/2/30'), '');
  assert.equal(L.parseDateLoose('abc'), '');
});

test('parsePalms：BNI Connect 英文匯出檔', () => {
  const r = L.parsePalms(BNI_EXPORT);
  assert.deepEqual(r.period, { from: '2026-09-26', to: '2026-10-02' });
  assert.deepEqual(r.members.map((m) => m.name), ['王小明', 'David Chen']);
  assert.equal(r.members[0].TYFCB, 12000);
  assert.equal(r.members[0]['121'], 2);
  assert.equal(r.members[1].A, 1);
  assert.deepEqual(r.skipped, ['Total']);
  assert.deepEqual(r.missing, []);
});

test('parsePalms：中文標題、單一姓名欄、缺欄位記 0', () => {
  const r = L.parsePalms([
    ['期間：2026/09/26 ~ 2026/10/02'],
    ['姓名', '出席', '缺席', '遲到', '病假', '代理', '內部引薦給予', '外部引薦給予', '來賓', '一對一', '感謝成交', '教育學分'],
    ['林美麗', '1', '0', '0', '0', '0', '3', '0', '2', '1', 'NT$5,500', '2'],
    ['合計', '1', '0', '0', '0', '0', '3', '0', '2', '1', '5500', '2']
  ]);
  assert.deepEqual(r.period, { from: '2026-09-26', to: '2026-10-02' });
  assert.equal(r.members.length, 1);
  assert.equal(r.members[0].TYFCB, 5500);
  assert.equal(r.members[0].RRI, 0);
  assert.deepEqual(r.missing, ['RRI', 'RRO', 'T']);
  assert.deepEqual(r.skipped, ['合計']);
});

test('parsePalms：報表內沒有期間時改從檔名判斷', () => {
  const rows = BNI_EXPORT.slice(5);
  assert.equal(L.parsePalms(rows).period, null);
  assert.deepEqual(L.parsePalms(rows, 'PALMS_2026-09-26_2026-10-02.xlsx').period, { from: '2026-09-26', to: '2026-10-02' });
});

test('parsePalms：不是 PALMS 報表就報錯', () => {
  assert.throws(() => L.parsePalms([['姓名', '電話'], ['王小明', '0912']]), /找不到 PALMS 欄位標題/);
  assert.throws(() => L.parsePalms(BNI_EXPORT.slice(0, 6)), /沒有會員資料/);
});

test('例會日期與星期', () => {
  assert.equal(L.parseWeekday('四'), 4);
  assert.equal(L.parseWeekday('星期四'), 4);
  assert.equal(L.parseWeekday('週日'), 0);
  assert.equal(L.parseWeekday('7'), 0);
  assert.equal(L.parseWeekday('Thu'), 4);
  assert.equal(L.parseWeekday('x'), -1);
  assert.equal(L.nextMeetingDate('2026-10-03', 4), '2026-10-08'); // 週六 → 下週四
  assert.equal(L.nextMeetingDate('2026-10-08', 4), '2026-10-08'); // 當天就是例會
  assert.deepEqual(L.upcomingMeetings('2026-10-03', 4, 3), ['2026-10-08', '2026-10-15', '2026-10-22']);
  assert.equal(L.addDays('2026-12-30', 3), '2027-01-02');
});

test('簽到判定：超過遲到時間記 L', () => {
  assert.equal(L.checkinStatus('06:59', '07:00'), 'P');
  assert.equal(L.checkinStatus('07:00', '07:00'), 'P');
  assert.equal(L.checkinStatus('07:01', '7:00'), 'L');
  assert.equal(L.checkinStatus('08:00', ''), 'P');
});

test('toSheetText：保護電話、日期與公式', () => {
  assert.equal(L.toSheetText('0912345678'), "'0912345678");
  assert.equal(L.toSheetText('2026-10-08'), "'2026-10-08");
  assert.equal(L.toSheetText('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(L.toSheetText('+886912345678'), "'+886912345678");
  assert.equal(L.toSheetText('王小明'), '王小明');
  assert.equal(L.toSheetText(''), '');
  assert.equal(L.toSheetText(null), '');
  assert.equal(L.normalizePhone(912345678), '0912345678');
});

test('summarizePalms：多期加總、缺席提醒、期間重疊', () => {
  const s = L.summarizePalms([
    { from: '2026-09-17', to: '2026-09-23', name: '王小明', P: 0, A: 1, RGI: 1, RGO: 0, TYFCB: 1000.5 },
    { from: '2026-09-24', to: '2026-09-30', name: '王 小明', P: 0, A: 2, RGI: 2, RGO: 1, TYFCB: 2000.25 },
    { from: '2026-09-24', to: '2026-09-30', name: '陳大華', P: 1, A: 0, '121': 3 }
  ], 3);
  assert.equal(s.members.length, 2);
  assert.equal(s.members[0].A, 3);
  assert.equal(s.members[0].alert, true);
  assert.equal(s.members[0].referralsGiven, 4);
  assert.equal(s.members[0].TYFCB, 3000.75);
  assert.equal(s.members[1].alert, false);
  assert.equal(s.totals.referralsGiven, 4);
  assert.deepEqual(s.overlaps, []);
  const overlap = L.summarizePalms([
    { from: '2026-04-01', to: '2026-09-30', name: 'A' },
    { from: '2026-09-24', to: '2026-09-30', name: 'A' }
  ], 0);
  assert.equal(overlap.overlaps.length, 1);
});

test('LINE 週報文字', () => {
  const s = L.summarizePalms([
    { from: '2026-09-24', to: '2026-09-30', name: '王小明', P: 1, RGI: 3, RGO: 1, V: 1, '121': 2, TYFCB: 1234567 },
    { from: '2026-09-24', to: '2026-09-30', name: '陳大華', P: 1, RGI: 1, '121': 4 }
  ], 3);
  const text = L.buildPalmsLineText('BNI 示範分會', '2026-09-24', '2026-09-30', s);
  assert.match(text, /【BNI 示範分會｜PALMS 週報】/);
  assert.match(text, /引薦 5 筆（內部 4／外部 1）/);
  assert.match(text, /感謝成交 NT\$1,234,567/);
  assert.match(text, /一對一：陳大華 4、王小明 2/);
  assert.equal(L.formatNumber(-1234), '-1,234');
});
