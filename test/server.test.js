'use strict';
/**
 * 以假的 Apps Script 環境跑完整後端流程：報名 → 簽到 → 列印資料 → PALMS 匯入與統計。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../dev/gas-fake');

const PIN = '2468';

function setup(order) {
  const s = createServer({ order });
  s.setNow('2026-10-08T06:50:00+08:00'); // 週四 例會當天
  s.scriptProps.setProperty('ADMIN_PIN', PIN);
  s.admin = (action, data) => {
    const res = s.api(action, data, PIN);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  return s;
}

function addMembersByHand(s) {
  s.admin('auth.check'); // 讓工作表建立
  s.api('public.bootstrap');
  const sheet = s.ss.getSheetByName('會員名單');
  // 模擬秘書直接在試算表打字：沒有會員ID、手機開頭 0 被吃掉
  sheet.typeRow(['', '王小明', '小明設計', '室內設計', '0912345678', 'ming@example.com', '', '']);
  sheet.typeRow(['', '陳大華', '大華保險', '保險規劃', '', '', '', '']);
  sheet.typeRow(['', '林美麗', '美麗花藝', '花藝', '', '', '', '']);
  sheet.typeRow(['', '張離開', '', '', '', '', '離會', '']);
}

const PALMS_ROWS = [
  ['PALMS Summary Report'],
  ['From: 9/24/2026 To: 9/30/2026'],
  ['First Name', 'Last Name', 'P', 'A', 'L', 'M', 'S', 'RGI', 'RGO', 'RRI', 'RRO', 'V', '1-2-1', 'TYFCB', 'CEU', 'T'],
  ['小明', '王', '1', '0', '0', '0', '0', '2', '1', '0', '0', '1', '2', '30,000', '1', '0'],
  ['大華', '陳', '0', '1', '0', '0', '0', '0', '0', '2', '0', '0', '1', '0', '0', '0'],
  ['新人', '黃', '1', '0', '0', '0', '0', '1', '0', '0', '0', '0', '0', '0', '0', '0'],
  ['Total', '', '2', '1', '0', '0', '0', '3', '1', '2', '0', '1', '3', '30000', '1', '0']
];

for (const order of ['normal', 'reverse']) {
  test(`伺服器程式不依賴檔案載入順序（${order}）`, () => {
    const s = setup(order);
    const res = s.api('public.bootstrap');
    assert.equal(res.ok, true, res.error);
    assert.equal(res.data.chapterName, 'BNI ○○分會');
    assert.deepEqual(res.data.meetings.slice(0, 2).map((m) => m.label), ['2026-10-08（四）', '2026-10-15（四）']);
  });
}

test('管理功能需要正確的管理密碼', () => {
  const s = createServer();
  assert.match(s.api('auth.check', {}, '1234').error, /尚未設定管理密碼/);
  s.scriptProps.setProperty('ADMIN_PIN', PIN);
  assert.match(s.api('checkin.board', { date: '2026-10-08' }, '0000').error, /管理密碼錯誤/);
  assert.equal(s.api('auth.check', {}, PIN).ok, true);
  assert.match(s.api('nope', {}, PIN).error, /未知的操作/);
});

test('會員名單：自動補會員ID、修正手機、排除離會', () => {
  const s = setup();
  addMembersByHand(s);
  const board = s.admin('checkin.board', { date: '2026-10-08' });
  assert.deepEqual(board.members.map((m) => [m.id, m.name]), [['M001', '王小明'], ['M002', '陳大華'], ['M003', '林美麗']]);
  const sheetRows = s.ss.getSheetByName('會員名單').objects();
  assert.equal(sheetRows[3]['會員ID'], 'M004');
  const pub = s.api('public.bootstrap').data;
  assert.deepEqual(pub.members.map((m) => m.name), ['王小明', '陳大華', '林美麗']);
});

test('來賓報名：存成文字、擋重複與機器人、日期要合理', () => {
  const s = setup();
  addMembersByHand(s);
  const ok = s.api('guest.register', {
    date: '2026-10-08', name: '來賓甲', company: '=HYPERLINK("http://x")', category: '室內設計',
    phone: '0922000111', email: 'a@example.com', inviter: '王小明'
  });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.data.duplicate, false);
  const dup = s.api('guest.register', { date: '2026-10-08', name: '來賓 甲', category: '室內設計', phone: '0922-000-111' });
  assert.equal(dup.data.duplicate, true);
  assert.match(s.api('guest.register', { date: '2026-10-08', name: 'bot', category: 'x', website: 'spam' }).error, /送出失敗/);
  assert.match(s.api('guest.register', { date: '2027-12-01', name: '太遠', category: 'x' }).error, /例會日期/);
  assert.match(s.api('guest.register', { date: '2026-10-08', name: '沒行業' }).error, /專業別/);

  const row = s.ss.getSheetByName('來賓名單').objects()[0];
  assert.equal(row['手機'], '0922000111');
  assert.equal(row['公司'], '=HYPERLINK("http://x")');
  assert.equal(row['例會日期'], '2026-10-08');
  const list = s.admin('guest.list', { date: '2026-10-08' });
  assert.equal(list.length, 1);
  assert.equal(list[0].phone, '0922000111');
});

test('會員簽到：準時 P、遲到 L、代理、清除、未簽到記缺席', () => {
  const s = setup();
  addMembersByHand(s);
  const date = '2026-10-08';
  assert.equal(s.admin('checkin.member', { date, memberId: 'M001', status: 'auto' }).status, 'P');
  s.setNow('2026-10-08T07:05:00+08:00');
  const late = s.admin('checkin.member', { date, memberId: 'M002', status: 'auto' });
  assert.equal(late.status, 'L');
  assert.equal(late.checkedInAt, '2026-10-08 07:05:00');
  const sub = s.admin('checkin.member', { date, memberId: 'M003', status: 'S', substitute: '代理人乙' });
  assert.equal(sub.substitute, '代理人乙');
  s.admin('checkin.member', { date, memberId: 'M002', status: '' });
  assert.equal(s.admin('checkin.markAbsent', { date }).count, 1);

  const board = s.admin('checkin.board', { date });
  assert.deepEqual(board.members.map((m) => m.status), ['P', 'A', 'S']);
  assert.equal(board.isToday, true);
  const rows = s.ss.getSheetByName('會員出席').objects();
  assert.equal(rows.length, 3);
  assert.equal(rows[0]['例會日期'], '2026-10-08');
  assert.match(s.api('checkin.member', { date, memberId: 'M999', status: 'P' }, PIN).error, /找不到這位會員/);
  assert.match(s.api('checkin.member', { date, memberId: 'M001', status: 'X' }, PIN).error, /不正確的出席狀態/);
  // 不是當天：補登一律記 P、不寫簽到時間
  const past = s.admin('checkin.member', { date: '2026-10-01', memberId: 'M001', status: 'auto' });
  assert.deepEqual([past.status, past.checkedInAt], ['P', '']);
});

test('現場來賓、簽到繳費、刪除', () => {
  const s = setup();
  const date = '2026-10-08';
  const walk = s.admin('guest.walkin', { date, name: '現場丙', category: '律師', paid: true });
  assert.equal(walk.guest.source, '現場');
  assert.equal(walk.guest.paid, true);
  assert.ok(walk.guest.checkedInAt);
  const reg = s.api('guest.register', { date, name: '報名丁', category: '會計' }).data.guest;
  const updated = s.admin('guest.update', { id: reg.id, patch: { checkedIn: true, paid: true, company: '丁事務所' } });
  assert.equal(updated.paid, true);
  assert.equal(updated.company, '丁事務所');
  assert.equal(updated.checkedInAt, '2026-10-08 06:50:00');
  assert.equal(s.admin('guest.update', { id: reg.id, patch: { checkedIn: false } }).checkedInAt, '');
  assert.match(s.api('guest.update', { id: reg.id, patch: { name: ' ' } }, PIN).error, /不能空白/);
  s.admin('guest.delete', { id: walk.guest.id });
  assert.deepEqual(s.admin('guest.list', { date }).map((g) => g.name), ['報名丁']);
});

test('列印資料：在籍會員與當天來賓', () => {
  const s = setup();
  addMembersByHand(s);
  s.api('guest.register', { date: '2026-10-08', name: '來賓甲', category: '設計', inviter: '王小明' });
  s.api('guest.register', { date: '2026-10-15', name: '下週來賓', category: '設計' });
  const data = s.admin('print.data', { date: '2026-10-08' });
  assert.equal(data.dateLabel, '2026-10-08（四）');
  assert.equal(data.members.length, 3);
  assert.deepEqual(data.guests.map((g) => g.name), ['來賓甲']);
  assert.equal(data.settings.badgeWidth, 90);
});

test('PALMS：預覽、儲存、重新匯入覆蓋、統計、LINE 週報、刪除', () => {
  const s = setup();
  addMembersByHand(s);
  const preview = s.admin('palms.preview', { rows: PALMS_ROWS, fileName: 'palms.xls' });
  assert.deepEqual(preview.period, { from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual(preview.newNames, ['黃新人']);

  const saved = s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual([saved.count, saved.replaced, saved.addedMembers], [3, false, ['黃新人']]);
  const again = s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-09-24', to: '2026-09-30' });
  assert.equal(again.replaced, true);
  assert.deepEqual(again.addedMembers, []);
  assert.equal(s.ss.getSheetByName('PALMS').objects().length, 3);
  assert.equal(s.ss.getSheetByName('PALMS').objects()[0]['1-2-1'], 2);

  s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-10-01', to: '2026-10-07' });
  const periods = s.admin('palms.periods');
  assert.deepEqual(periods.map((p) => p.from), ['2026-10-01', '2026-09-24']);
  assert.equal(periods[0].totals.TYFCB, 30000);

  const summary = s.admin('palms.summary', { from: '2026-09-01', to: '2026-10-31' });
  const wang = summary.members.find((m) => m.name === '王小明');
  assert.deepEqual([wang.periods, wang.P, wang.TYFCB, wang.referralsGiven], [2, 2, 60000, 6]);
  assert.equal(summary.absenceAlert, 3);

  const text = s.admin('palms.lineText', { from: '2026-09-24', to: '2026-09-30' });
  assert.match(text, /PALMS 週報/);
  assert.match(text, /感謝成交 NT\$30,000/);

  assert.equal(s.admin('palms.delete', { from: '2026-09-24', to: '2026-09-30' }).count, 3);
  assert.deepEqual(s.admin('palms.periods').map((p) => p.from), ['2026-10-01']);
  assert.match(s.api('palms.save', { rows: PALMS_ROWS, from: '', to: '' }, PIN).error, /請填寫 PALMS 期間/);
  assert.match(s.api('palms.lineText', { from: '2025-01-01', to: '2025-01-31' }, PIN).error, /沒有 PALMS 資料/);
});

test('工作表列數用完時自動加列', () => {
  const s = setup();
  s.admin('palms.periods'); // 建立 PALMS 工作表
  s.ss.getSheetByName('PALMS').maxRows = 3;
  s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-09-24', to: '2026-09-30', syncMembers: false });
  assert.equal(s.ss.getSheetByName('PALMS').objects().length, 3);
});

test('設定：儲存後影響例會日期與遲到判定', () => {
  const s = setup();
  addMembersByHand(s);
  const saved = s.admin('settings.save', { chapterName: 'BNI 示範分會', meetingWeekday: '星期三', lateAfter: '6:45', guestFee: '500' });
  assert.equal(saved.chapterName, 'BNI 示範分會');
  assert.equal(saved.meetingWeekdayLabel, '三');
  assert.equal(saved.lateAfter, '06:45');
  assert.equal(s.ss.getSheetByName('設定').objects()[3]['內容'], '06:45');
  assert.equal(s.admin('admin.bootstrap').nextMeeting, '2026-10-14');
  assert.equal(s.admin('checkin.member', { date: '2026-10-08', memberId: 'M001', status: 'auto' }).status, 'L');
  assert.match(s.api('settings.save', { meetingWeekday: '八' }, PIN).error, /例會星期/);
  assert.match(s.api('settings.save', { lateAfter: 'abc' }, PIN).error, /遲到判定時間/);
});
