'use strict';
/**
 * 以假的 Apps Script 環境跑完整後端流程：帳號權限、活動、報名、簽到、列印、PALMS、首頁。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../dev/gas-fake');

const ADMIN = { username: 'joy', displayName: 'Joy', roles: '系統管理員', password: 'joy-pass-123' };
const MTG = 'MTG-2026-10-08'; // 2026-10-08 是週四（預設例會日）

function setup(order) {
  const s = createServer({ order });
  s.setNow('2026-10-08T06:50:00+08:00');
  s.createAccount(ADMIN);
  s.token = s.login(ADMIN.username, ADMIN.password);
  s.as = (token) => (action, data) => {
    const res = s.api(action, data, token);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  s.admin = s.as(s.token);
  return s;
}

function addMembersByHand(s) {
  s.admin('members.list'); // 讓工作表建立
  const sheet = s.ss.getSheetByName('會員名單');
  // 模擬秘書直接在試算表打字：沒有會員ID、手機開頭 0 被吃掉
  sheet.typeRow(['', '王小明', '小明設計', '室內設計', '', '', '0912345678']);
  sheet.typeRow(['', '陳大華', '大華保險', '保險規劃']);
  sheet.typeRow(['', '林美麗', '美麗花藝', '花藝']);
  sheet.typeRow(['', '張離開', '', '', '', '', '', '', '', '', '', '', '離會']);
}

function rowsOf(s, name) {
  return s.ss.getSheetByName(name).objects();
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
    assert.deepEqual(res.data.events.slice(0, 2).map((e) => e.id), ['MTG-2026-10-08', 'MTG-2026-10-15']);
  });
}

test('帳號：第一次使用要先建立管理員、密碼不存明碼、登入失敗鎖定', () => {
  const s = createServer();
  assert.equal(s.api('auth.status').data.needsSetup, true);
  s.createAccount(ADMIN);
  assert.equal(s.api('auth.status').data.needsSetup, false);
  const stored = Object.entries(s.scriptProps.map).filter(([k]) => k.startsWith('PWD_'));
  assert.equal(stored.length, 1);
  assert.ok(!stored[0][1].includes(ADMIN.password));
  assert.ok(!JSON.stringify(rowsOf(s, '帳號')).includes(ADMIN.password));

  assert.match(s.api('auth.login', { username: 'joy', password: 'wrong-pass' }).error, /帳號或密碼錯誤/);
  assert.match(s.api('auth.login', { username: 'nobody', password: 'wrong-pass' }).error, /帳號或密碼錯誤/);
  for (let i = 0; i < 4; i++) s.api('auth.login', { username: 'JOY', password: 'wrong-pass' });
  assert.match(s.api('auth.login', ADMIN).error, /15 分鐘後再試/);
  assert.throws(() => s.createAccount({ ...ADMIN, displayName: '重複' }), /已經有人使用/);
  assert.throws(() => s.createAccount({ ...ADMIN, username: 'x' }), /帳號需/);
  assert.throws(() => s.createAccount({ ...ADMIN, username: 'short', password: '1234' }), /至少 8 碼/);
});

test('帳號：token 驗證、過期、改密碼與停用都會讓舊登入失效', () => {
  const s = setup();
  assert.equal(s.api('home.data', {}, '').code, 'AUTH');
  const parts = s.token.split('.');
  const forged = [parts[0], String(Number(parts[1]) + 999999), parts[2], parts[3]].join('.');
  assert.equal(s.api('home.data', {}, forged).code, 'AUTH');
  assert.equal(s.api('home.data', {}, s.token).ok, true);

  const changed = s.admin('auth.changePassword', { currentPassword: ADMIN.password, newPassword: 'new-pass-456' });
  assert.equal(s.api('home.data', {}, s.token).code, 'AUTH');
  assert.equal(s.api('home.data', {}, changed.token).ok, true);
  assert.match(s.api('auth.changePassword', { currentPassword: 'nope', newPassword: 'whatever-1' }, changed.token).error, /目前的密碼不正確/);

  const admin = s.as(changed.token);
  const staff = admin('accounts.create', { username: 'amy', displayName: 'Amy', roles: ['來賓接待'], password: 'amy-pass-123' });
  const amyToken = s.login('amy', 'amy-pass-123');
  assert.equal(s.api('home.data', {}, amyToken).ok, true);
  admin('accounts.update', { id: staff.id, displayName: 'Amy', roles: ['來賓接待'], status: '停用' });
  assert.equal(s.api('home.data', {}, amyToken).code, 'AUTH');
  assert.match(s.api('auth.login', { username: 'amy', password: 'amy-pass-123' }).error, /帳號或密碼錯誤/);

  s.setNow('2026-10-23T07:00:00+08:00'); // 15 天後
  assert.equal(s.api('home.data', {}, changed.token).code, 'AUTH');
});

test('權限：依角色限制功能，且至少保留一位管理員', () => {
  const s = setup();
  const me = s.admin('app.bootstrap').account;
  s.admin('accounts.create', { username: 'amy', displayName: 'Amy', title: '來賓接待', roles: '來賓接待', password: 'amy-pass-123' });
  s.admin('accounts.create', { username: 'ben', displayName: 'Ben', roles: ['主席團'], password: 'ben-pass-123' });
  s.admin('accounts.create', { username: 'cara', displayName: 'Cara', roles: ['財務'], password: 'cara-pass-123' });
  const amy = s.login('amy', 'amy-pass-123');
  const ben = s.login('ben', 'ben-pass-123');
  const cara = s.login('cara', 'cara-pass-123');

  const amyBoot = s.api('app.bootstrap', {}, amy).data;
  assert.ok(amyBoot.perms.includes('checkin.attendance.manage'));
  assert.ok(!amyBoot.perms.includes('palms.report.view'));
  assert.equal(s.api('checkin.board', { eventId: MTG }, amy).ok, true);
  assert.match(s.api('palms.periods', {}, amy).error, /沒有使用這個功能的權限/);
  assert.match(s.api('members.list', {}, amy).error, /權限/);
  assert.equal(s.api('settings.get', {}, ben).ok, true);
  assert.match(s.api('accounts.list', {}, ben).error, /權限/);
  assert.equal(s.api('members.list', {}, cara).ok, true);
  assert.match(s.api('members.save', { name: '新人' }, cara).error, /權限/);
  assert.match(s.api('checkin.board', { eventId: MTG }, cara).error, /權限/);

  assert.match(s.api('accounts.update', { id: me.id, displayName: 'Joy', roles: ['系統管理員'], status: '停用' }, s.token).error, /不能停用自己/);
  assert.match(s.api('accounts.update', { id: me.id, displayName: 'Joy', roles: ['主席團'] }, s.token).error, /至少要保留一位/);
  assert.match(s.api('accounts.delete', { id: me.id }, s.token).error, /不能刪除自己/);
  const list = s.admin('accounts.list');
  assert.deepEqual(list.accounts.map((a) => a.username), ['joy', 'amy', 'ben', 'cara']);
  assert.ok(list.roles.some((r) => r.name === '會員委員會'));
  const benId = list.accounts.find((a) => a.username === 'ben').id;
  s.admin('accounts.delete', { id: benId });
  assert.equal(s.api('home.data', {}, ben).code, 'AUTH');
  assert.equal(rowsOf(s, '帳號').find((r) => r['帳號'] === 'ben')['已刪除'], '是');
  s.admin('accounts.resetPassword', { id: list.accounts.find((a) => a.username === 'cara').id, password: 'cara-new-123' });
  assert.equal(s.api('home.data', {}, cara).code, 'AUTH');
  assert.ok(s.login('cara', 'cara-new-123'));
});

test('會員名冊：自動補ID、修正手機、排除離會、新增修改、軟刪除、到期提醒', () => {
  const s = setup();
  addMembersByHand(s);
  const list = s.admin('members.list');
  assert.deepEqual(list.map((m) => [m.id, m.name]), [['M001', '王小明'], ['M002', '陳大華'], ['M003', '林美麗']]);
  assert.equal(list[0].phone, '0912345678');
  assert.equal(s.admin('members.list', { includeInactive: true }).length, 4);
  const created = s.admin('members.save', { name: '黃新人', category: '律師', expiryDate: '2026/11/01', joinDate: '2025-11-01' });
  assert.equal(created.id, 'M005');
  assert.equal(created.expiryDate, '2026-11-01');
  assert.match(s.api('members.save', { name: '王小明' }, s.token).error, /已經有/);
  assert.match(s.api('members.save', { name: '錯日期', expiryDate: 'abc' }, s.token).error, /到期日格式/);
  s.admin('members.save', { id: 'M002', name: '陳大華', category: '保險規劃', expiryDate: '2026-09-30' });
  const home = s.admin('home.data');
  assert.deepEqual(home.cards.expiring.members.map((m) => [m.name, m.daysLeft]), [['陳大華', -8], ['黃新人', 24]]);
  s.admin('members.delete', { id: 'M003' });
  assert.deepEqual(s.admin('members.list').map((m) => m.id), ['M001', 'M002', 'M005']);
  assert.equal(rowsOf(s, '會員名單').find((r) => r['會員ID'] === 'M003')['已刪除'], '是');
});

test('活動：每週例會自動產生、例會覆寫與停會、其他活動新增與軟刪除', () => {
  const s = setup();
  const oct = s.admin('events.list', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(oct.map((e) => e.date), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
  assert.equal(oct[1].timeLabel, '07:00–09:00');
  assert.equal(oct[1].isMeeting, true);

  const meeting = s.admin('events.save', { id: 'MTG-2026-10-15', place: '暮溢共享空間', startTime: '06:30', endTime: '09:00', description: '換場地' });
  assert.deepEqual([meeting.place, meeting.timeLabel, meeting.name], ['暮溢共享空間', '06:30–09:00', '例會']);
  assert.equal(s.admin('events.status', { id: 'MTG-2026-10-22', cancelled: true }).cancelled, true);
  assert.equal(s.admin('events.status', { id: 'MTG-2026-10-22', cancelled: false }).cancelled, false);
  assert.match(s.api('events.delete', { id: 'MTG-2026-10-22' }, s.token).error, /不能刪除/);

  const ev = s.admin('events.save', { type: '共識會議', name: '共識會議', date: '2026-10-16', startTime: '06:30', endTime: '09:00', place: '暮溢共享空間', openRegistration: false });
  assert.ok(ev.id.startsWith('E'));
  assert.equal(ev.isMeeting, false);
  assert.match(s.api('events.save', { type: '培訓', date: '2026-10-20', fee: 'abc' }, s.token).error, /費用請填數字/);
  assert.match(s.api('events.save', { type: '培訓', date: '2026-10-20', startTime: '10:00', endTime: '09:00' }, s.token).error, /結束時間/);
  const after = s.admin('events.list', { from: '2026-10-01', to: '2026-10-31' });
  assert.deepEqual(after.map((e) => e.date), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-16', '2026-10-22', '2026-10-29']);
  s.admin('events.delete', { id: ev.id });
  assert.equal(s.admin('events.list', { from: '2026-10-16', to: '2026-10-16' }).length, 0);
  assert.equal(rowsOf(s, '活動').find((r) => r['活動ID'] === ev.id)['已刪除'], '是');
  const opts = s.admin('events.options', {});
  assert.equal(opts.defaultId, MTG);
});

test('報名：例會來賓、資料存成文字、重複與機器人、停會與名額、會員報名其他活動', () => {
  const s = setup();
  addMembersByHand(s);
  s.admin('settings.save', { guestFee: '500' });
  const ok = s.api('public.register', {
    eventId: MTG, name: '來賓甲', company: '=HYPERLINK("http://x")', category: '室內設計', phone: '0922000111', inviter: '王小明'
  });
  assert.equal(ok.ok, true, ok.error);
  assert.equal(ok.data.duplicate, false);
  assert.equal(s.api('public.register', { eventId: MTG, name: '來賓 甲', category: '室內設計', phone: '0922-000-111' }).data.duplicate, true);
  assert.match(s.api('public.register', { eventId: MTG, name: 'bot', category: 'x', website: 'spam' }).error, /送出失敗/);
  assert.match(s.api('public.register', { eventId: MTG, name: '沒行業' }).error, /專業別/);
  assert.match(s.api('public.register', { eventId: 'MTG-2026-10-01', name: '過期', category: 'x' }).error, /不開放報名/);
  assert.match(s.api('public.register', { eventId: 'MTG-2026-10-09', name: '編造日期', category: 'x' }).error, /找不到這場例會/);
  assert.match(s.api('public.register', { eventId: 'E-NOPE', name: '不存在', category: 'x' }).error, /找不到這場活動/);
  assert.match(s.api('events.status', { id: 'MTG-2026-10-09', cancelled: true }, s.token).error, /找不到這場例會/);
  s.admin('events.status', { id: 'MTG-2026-10-15', cancelled: true });
  assert.match(s.api('public.register', { eventId: 'MTG-2026-10-15', name: '停會', category: 'x' }).error, /已取消/);

  const row = rowsOf(s, '報名名單')[0];
  assert.deepEqual([row['手機'], row['公司'], row['活動日期'], row['身分']], ['0922000111', '=HYPERLINK("http://x")', '2026-10-08', '來賓']);

  const ev = s.admin('events.save', { type: '聯誼', name: '中秋聯誼', date: '2026-10-20', openRegistration: true, fee: '800', capacity: '2' });
  const coerced = s.api('public.register', { eventId: MTG, role: '會員', memberId: 'M001', name: '假會員', category: '測試' }).data.registration;
  assert.equal(coerced.role, '來賓', '例會的公開報名一律算來賓');
  const member = s.api('public.register', { eventId: ev.id, role: '會員', memberId: 'M001' }).data.registration;
  assert.deepEqual([member.role, member.name, member.category], ['會員', '王小明', '室內設計']);
  assert.equal(s.api('public.register', { eventId: ev.id, name: '朋友A', category: '設計' }).ok, true);
  assert.match(s.api('public.register', { eventId: ev.id, name: '朋友B', category: '設計' }).error, /名額已滿/);
  const pub = s.api('public.bootstrap').data;
  assert.ok(!pub.events.some((e) => e.id === ev.id), '額滿的活動不出現在報名頁');
  assert.ok(!pub.events.some((e) => e.id === 'MTG-2026-10-15'), '停會的例會不出現在報名頁');
  const added = s.admin('registrations.add', { eventId: ev.id, name: '幹部代登', category: '顧問' });
  assert.equal(added.registration.source, '代登');
  assert.match(s.api('registrations.add', { eventId: MTG, role: '會員', memberId: 'M001' }, s.token).error, /簽到/);
});

test('簽到：準時 P、遲到 L、代理、清除、未簽到記缺席、來賓簽到繳費', () => {
  const s = setup();
  addMembersByHand(s);
  s.admin('settings.save', { guestFee: '500' });
  assert.equal(s.admin('checkin.member', { eventId: MTG, memberId: 'M001', status: 'auto' }).status, 'P');
  s.setNow('2026-10-08T07:05:00+08:00');
  const late = s.admin('checkin.member', { eventId: MTG, memberId: 'M002', status: 'auto' });
  assert.deepEqual([late.status, late.checkedInAt], ['L', '2026-10-08 07:05:00']);
  assert.equal(s.admin('checkin.member', { eventId: MTG, memberId: 'M003', status: 'S', substitute: '代理人乙' }).substitute, '代理人乙');
  s.admin('checkin.member', { eventId: MTG, memberId: 'M002', status: '' });
  assert.equal(s.admin('checkin.markAbsent', { eventId: MTG }).count, 1);
  const board = s.admin('checkin.board', { eventId: MTG });
  assert.deepEqual(board.members.map((m) => m.status), ['P', 'A', 'S']);
  assert.equal(rowsOf(s, '會員出席').length, 3, '清除只清狀態，不刪列');
  assert.match(s.api('checkin.member', { eventId: MTG, memberId: 'M999', status: 'P' }, s.token).error, /找不到這位會員/);
  assert.match(s.api('checkin.member', { eventId: MTG, memberId: 'M001', status: 'X' }, s.token).error, /不正確的出席狀態/);
  const past = s.admin('checkin.member', { eventId: 'MTG-2026-10-01', memberId: 'M001', status: 'auto' });
  assert.deepEqual([past.status, past.checkedInAt], ['P', '']);

  const walk = s.admin('registrations.walkin', { eventId: MTG, name: '現場丙', category: '律師', paid: true });
  assert.deepEqual([walk.registration.source, walk.registration.paid, walk.registration.paidAmount], ['現場', true, 500]);
  assert.ok(walk.registration.checkedInAt);
  const reg = s.api('public.register', { eventId: MTG, name: '報名丁', category: '會計' }).data.registration;
  const updated = s.admin('registrations.update', { id: reg.id, patch: { checkedIn: true, paid: true, company: '丁事務所' } });
  assert.deepEqual([updated.paid, updated.company, updated.checkedInAt], [true, '丁事務所', '2026-10-08 07:05:00']);
  assert.equal(s.admin('registrations.update', { id: reg.id, patch: { checkedIn: false } }).checkedInAt, '');
  assert.match(s.api('registrations.update', { id: reg.id, patch: { name: ' ' } }, s.token).error, /不能空白/);
  s.admin('registrations.delete', { id: walk.registration.id });
  assert.deepEqual(s.admin('registrations.list', { eventId: MTG }).map((g) => g.name), ['報名丁']);
  assert.equal(rowsOf(s, '報名名單').length, 2, '刪除是軟刪除');

  const ev = s.admin('events.save', { type: '培訓', name: '新會員培訓', date: '2026-10-08', openRegistration: true });
  assert.equal(s.admin('checkin.board', { eventId: ev.id }).members.length, 0);
  assert.match(s.api('checkin.member', { eventId: ev.id, memberId: 'M001', status: 'P' }, s.token).error, /只在例會/);
});

test('列印資料：例會有在籍會員與當天來賓，活動只有報名名單', () => {
  const s = setup();
  addMembersByHand(s);
  s.api('public.register', { eventId: MTG, name: '來賓甲', category: '設計', inviter: '王小明' });
  s.api('public.register', { eventId: 'MTG-2026-10-15', name: '下週來賓', category: '設計' });
  const data = s.admin('print.data', { eventId: MTG });
  assert.equal(data.dateLabel, '2026-10-08（四）');
  assert.equal(data.members.length, 3);
  assert.deepEqual(data.registrations.map((g) => g.name), ['來賓甲']);
  assert.equal(data.settings.badgeWidth, 90);
});

test('PALMS：預覽、儲存、重新匯入以軟刪除覆蓋、統計、LINE 週報、刪除', () => {
  const s = setup();
  addMembersByHand(s);
  const preview = s.admin('palms.preview', { rows: PALMS_ROWS, fileName: 'palms.xls' });
  assert.deepEqual(preview.period, { from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual(preview.newNames, ['黃新人']);
  const saved = s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual([saved.count, saved.replaced, saved.addedMembers], [3, false, ['黃新人']]);
  const again = s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-09-24', to: '2026-09-30' });
  assert.deepEqual([again.replaced, again.addedMembers], [true, []]);
  const sheetRows = rowsOf(s, 'PALMS');
  assert.equal(sheetRows.length, 6);
  assert.equal(sheetRows.filter((r) => r['已刪除'] === '是').length, 3);
  assert.equal(sheetRows[3]['1-2-1'], 2);

  s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-10-01', to: '2026-10-07' });
  assert.deepEqual(s.admin('palms.periods').map((p) => p.from), ['2026-10-01', '2026-09-24']);
  const summary = s.admin('palms.summary', { from: '2026-09-01', to: '2026-10-31' });
  const wang = summary.members.find((m) => m.name === '王小明');
  assert.deepEqual([wang.periods, wang.P, wang.TYFCB, wang.referralsGiven], [2, 2, 60000, 6]);
  assert.match(s.admin('palms.lineText', { from: '2026-09-24', to: '2026-09-30' }), /感謝成交 NT\$30,000/);
  assert.equal(s.admin('palms.delete', { from: '2026-09-24', to: '2026-09-30' }).count, 3);
  assert.deepEqual(s.admin('palms.periods').map((p) => p.from), ['2026-10-01']);
});

test('工作表列數用完時自動加列', () => {
  const s = setup();
  s.admin('palms.periods'); // 建立 PALMS 工作表
  s.ss.getSheetByName('PALMS').maxRows = 3;
  s.admin('palms.save', { rows: PALMS_ROWS, from: '2026-09-24', to: '2026-09-30', syncMembers: false });
  assert.equal(rowsOf(s, 'PALMS').length, 3);
});

test('設定與每週提醒', () => {
  const s = setup();
  const saved = s.admin('settings.save', {
    chapterName: 'BNI 震宇分會', meetingWeekday: '星期五', meetingTime: '6:30', meetingEndTime: '09:00', lateAfter: '6:45', meetingPlace: '暮溢共享空間', guestFee: '500'
  });
  assert.deepEqual([saved.meetingWeekdayLabel, saved.meetingTime, saved.lateAfter, saved.guestFee], ['五', '06:30', '06:45', 500]);
  assert.equal(rowsOf(s, '設定').find((r) => r['項目'] === '遲到判定時間')['內容'], '06:45');
  assert.match(s.api('settings.save', { meetingWeekday: '八' }, s.token).error, /例會星期/);
  assert.match(s.api('settings.save', { guestFee: '五百' }, s.token).error, /來賓費用請填數字/);
  assert.match(s.api('settings.save', { replyTo: 'abc' }, s.token).error, /回覆信箱/);

  const page = s.admin('settings.get');
  assert.deepEqual(page.reminders.map((r) => [r.weekdayLabel, r.time, r.content]), [['三', '12:00', 'BNI Connect 登錄截止']]);
  const r = s.admin('reminders.save', { weekday: '四', time: '20:00', content: '明天{{例會時間}}例會，地點：{{例會地點}}', pushLine: true });
  assert.equal(r.pushLine, true);
  s.admin('reminders.save', { id: page.reminders[0].id, weekday: '四', time: '12:00', content: 'BNI Connect 登錄截止' });
  const home = s.admin('home.data');
  const thu = home.days.find((d) => d.weekday === '四');
  assert.deepEqual(thu.items.map((i) => i.title), ['BNI Connect 登錄截止', '明天06:30–09:00例會，地點：暮溢共享空間']);
  s.admin('reminders.delete', { id: r.id });
  assert.equal(s.admin('settings.get').reminders.length, 1);
});

test('首頁：這一週、下一場例會與活動、報名人數', () => {
  const s = setup();
  addMembersByHand(s);
  s.api('public.register', { eventId: MTG, name: '來賓甲', category: '設計' });
  s.admin('events.save', { type: '共識會議', name: '共識會議', date: '2026-10-16', startTime: '06:30', endTime: '09:00', place: '暮溢共享空間' });
  const home = s.admin('home.data');
  assert.deepEqual(home.days.map((d) => d.day), [8, 9, 10, 11, 12, 13, 14]);
  assert.deepEqual(home.days[0].items.map((i) => i.title), ['例會']);
  assert.deepEqual(home.days[6].items.map((i) => i.title), ['BNI Connect 登錄截止']);
  assert.equal(home.nextMeeting.id, MTG);
  assert.equal(home.nextMeeting.counts.guests, 1);
  assert.equal(home.nextEvent.name, '共識會議');
  s.setNow('2026-10-08T09:30:00+08:00'); // 例會已結束
  assert.equal(s.admin('home.data').nextMeeting.id, 'MTG-2026-10-15');
});

test('活動管理頁與報名儀表板：各場人數、邀請排行榜、本月來賓', () => {
  const s = setup();
  addMembersByHand(s);
  s.setNow('2026-10-01T07:30:00+08:00');
  const back = s.api('public.register', { eventId: 'MTG-2026-10-01', name: '回訪來賓', category: '室內設計', phone: '0933000111', inviter: '王小明' }).data.registration;
  s.admin('registrations.update', { id: back.id, patch: { checkedIn: true } });
  s.setNow('2026-10-08T06:50:00+08:00');
  s.api('public.register', { eventId: MTG, name: '回訪來賓', category: '室內設計', phone: '0933-000-111', inviter: '王小明' });
  s.setNow('2026-10-08T06:51:00+08:00');
  s.api('public.register', { eventId: MTG, name: '新來賓', category: '花藝', inviter: '陳大華' });
  const ev = s.admin('events.save', { type: '培訓', name: '新會員培訓', date: '2026-10-20', openRegistration: true });

  const page = s.admin('events.page', {});
  assert.equal(page.events[0].id, MTG);
  assert.equal(page.events.find((e) => e.id === MTG).counts.guests, 2);
  assert.ok(page.events.some((e) => e.id === ev.id));
  assert.ok(!page.events.some((e) => e.date < '2026-10-08'));
  assert.ok(s.admin('events.page', { past: true }).events.some((e) => e.id === 'MTG-2026-10-01'));

  const dash = s.admin('events.dashboard');
  assert.deepEqual(dash.upcoming.map((e) => e.id).slice(0, 3), [MTG, 'MTG-2026-10-15', ev.id]);
  assert.deepEqual(dash.leaderboard.map((b) => [b.name, b.invited, b.attended]), [['王小明', 2, 1], ['陳大華', 1, 0]]);
  assert.deepEqual(dash.month, { guests: 3, attended: 1 });
  assert.deepEqual(dash.recent.map((r) => [r.name, r.eventName]), [['新來賓', '例會'], ['回訪來賓', '例會'], ['回訪來賓', '例會']]);
});

test('來賓速覽與幸運轉盤：來訪次數、同業會員、抽獎名單與紀錄、權限', () => {
  const s = setup();
  addMembersByHand(s);
  s.setNow('2026-10-01T07:30:00+08:00');
  const back = s.api('public.register', { eventId: 'MTG-2026-10-01', name: '回訪來賓', category: '室內設計', phone: '0933000111' }).data.registration;
  s.admin('registrations.update', { id: back.id, patch: { checkedIn: true } });
  s.setNow('2026-10-08T06:50:00+08:00');
  s.api('public.register', { eventId: MTG, name: '回訪來賓', category: '室內設計', phone: '0933000111', inviter: '王小明' });
  const fresh = s.api('public.register', { eventId: MTG, name: '新來賓', category: '花藝設計', inviter: '陳大華' }).data.registration;

  const show = s.admin('meeting.showcase', { eventId: MTG });
  assert.deepEqual(show.guests.map((g) => [g.name, g.visits, g.lastVisit]), [['回訪來賓', 1, '2026-10-01'], ['新來賓', 0, '']]);
  assert.deepEqual(show.guests[0].sameCategory, [{ name: '王小明', category: '室內設計' }]);
  assert.deepEqual(show.guests[1].sameCategory, [{ name: '林美麗', category: '花藝' }]);

  s.admin('checkin.member', { eventId: MTG, memberId: 'M001', status: 'P' });
  s.admin('checkin.member', { eventId: MTG, memberId: 'M002', status: 'L' });
  s.admin('checkin.member', { eventId: MTG, memberId: 'M003', status: 'M' });
  s.admin('registrations.update', { id: fresh.id, patch: { checkedIn: true } });
  const wheel = s.admin('meeting.wheel', { eventId: MTG });
  assert.deepEqual(wheel.pools, { arrivedGuests: ['新來賓'], arrivedMembers: ['王小明', '陳大華'], allMembers: ['王小明', '陳大華', '林美麗'] });
  const rec = s.admin('meeting.wheelRecord', { eventId: MTG, prize: '咖啡券', winner: '新來賓', poolSize: 3 });
  s.admin('meeting.wheelRecord', { eventId: MTG, prize: '咖啡券', winner: '王小明', poolSize: 2 });
  assert.deepEqual(s.admin('meeting.wheel', { eventId: MTG }).history.map((h) => h.winner), ['王小明', '新來賓']);
  assert.match(s.api('meeting.wheelRecord', { eventId: MTG, winner: ' ' }, s.token).error, /沒有得獎者/);
  s.admin('meeting.wheelDelete', { id: rec.id });
  assert.deepEqual(s.admin('meeting.wheel', { eventId: MTG }).history.map((h) => h.winner), ['王小明']);
  assert.equal(rowsOf(s, '抽獎紀錄').length, 2);

  s.admin('accounts.create', { username: 'amy', displayName: 'Amy', roles: '來賓接待', password: 'amy-pass-123' });
  s.admin('accounts.create', { username: 'cara', displayName: 'Cara', roles: '財務', password: 'cara-pass-123' });
  const amy = s.login('amy', 'amy-pass-123');
  const cara = s.login('cara', 'cara-pass-123');
  assert.equal(s.api('meeting.showcase', { eventId: MTG }, amy).ok, true);
  assert.equal(s.api('meeting.wheel', { eventId: MTG }, amy).ok, true);
  assert.match(s.api('events.dashboard', {}, amy).error, /權限/);
  assert.match(s.api('meeting.wheel', { eventId: MTG }, cara).error, /權限/);
  assert.equal(s.api('events.page', {}, cara).data.events[0].counts.guests, 2, '財務可以看活動來賓人數');
});

test('評議與追蹤：簽到自動建立、來訪累計與取消、階段紀錄、轉會員、我的待辦、權限', () => {
  const s = setup();
  addMembersByHand(s);
  const me = s.admin('app.bootstrap').account;
  s.admin('accounts.update', { id: me.id, displayName: 'Joy', roles: ['系統管理員'], memberId: 'M001' });

  s.setNow('2026-10-01T07:30:00+08:00');
  const r1 = s.api('public.register', { eventId: 'MTG-2026-10-01', name: '潛力來賓', company: 'A公司', category: '律師', phone: '0955000111', inviter: '王小明' }).data.registration;
  s.admin('registrations.update', { id: r1.id, patch: { checkedIn: true } });
  let list = s.admin('followup.list');
  assert.equal(list.me, '王小明');
  assert.deepEqual(list.leads.map((l) => [l.name, l.stage, l.visits, l.owner, l.firstVisit]), [['潛力來賓', '新來賓', 1, '王小明', '2026-10-01']]);

  s.setNow('2026-10-08T06:50:00+08:00');
  const r2 = s.api('public.register', { eventId: MTG, name: '潛力 來賓', category: '律師', phone: '0955-000-111', inviter: '王小明' }).data.registration;
  s.admin('registrations.update', { id: r2.id, patch: { checkedIn: true } });
  assert.deepEqual([s.admin('followup.list').leads[0].visits, s.admin('followup.list').leads[0].lastVisit], [2, '2026-10-08']);
  s.admin('registrations.update', { id: r2.id, patch: { checkedIn: false } });
  assert.equal(s.admin('followup.list').leads[0].visits, 1);
  s.admin('registrations.update', { id: r2.id, patch: { checkedIn: true } });
  assert.equal(s.admin('followup.list').leads[0].visits, 2);

  const walk = s.admin('registrations.walkin', { eventId: MTG, name: '路過來賓', category: '餐飲' }).registration;
  assert.equal(s.admin('followup.list').leads.length, 2);
  s.admin('registrations.update', { id: walk.id, patch: { checkedIn: false } });
  assert.equal(s.admin('followup.list').leads.length, 1, '只靠這場建立的新追蹤，取消簽到就刪除');
  assert.equal(rowsOf(s, '追蹤名單').find((r) => r['姓名'] === '路過來賓')['已刪除'], '是');

  const lead = s.admin('followup.list').leads[0];
  s.admin('followup.update', { id: lead.id, stage: '有意願', note: '電話聯繫，下週約一對一', nextDate: '2026-10-09' });
  const detail = s.admin('followup.get', { id: lead.id });
  assert.deepEqual([detail.lead.stage, detail.lead.latest, detail.lead.nextDate], ['有意願', '電話聯繫，下週約一對一', '2026-10-09']);
  assert.deepEqual(detail.logs.map((l) => l.content).slice(0, 2), ['電話聯繫，下週約一對一', '階段：新來賓 → 有意願']);
  assert.ok(detail.logs.some((l) => l.content === '第一次來訪：2026-10-01'));
  assert.match(s.api('followup.update', { id: lead.id, stage: '亂填' }, s.token).error, /不正確的階段/);

  const home = s.admin('home.data');
  assert.deepEqual([home.cards.followups.me, home.cards.followups.total, home.cards.followups.leads[0].name], ['王小明', 1, '潛力來賓']);
  s.setNow('2026-10-10T09:00:00+08:00');
  assert.equal(s.admin('followup.list').leads[0].overdue, true);

  const conv = s.admin('followup.convert', { id: lead.id });
  assert.deepEqual([conv.member.id, conv.member.sponsor, conv.member.joinDate, conv.lead.stage], ['M005', '王小明', '2026-10-10', '已入會']);
  assert.match(s.api('followup.convert', { id: lead.id }, s.token).error, /已經轉為會員/);

  const manual = s.admin('followup.create', { name: '介紹人選', category: '牙醫', inviter: '陳大華' });
  assert.deepEqual([manual.owner, manual.visits, manual.stage], ['陳大華', 0, '新來賓']);
  assert.match(s.api('followup.create', { name: '介紹人選' }, s.token).error, /已經在追蹤名單/);
  s.admin('followup.delete', { id: manual.id });
  assert.ok(!s.admin('followup.list').leads.some((l) => l.id === manual.id));

  s.admin('accounts.create', { username: 'amy', displayName: 'Amy', roles: '來賓接待', password: 'amy-pass-123' });
  s.admin('accounts.create', { username: 'mike', displayName: 'Mike', roles: '會員委員會', password: 'mike-pass-123' });
  assert.match(s.api('followup.list', {}, s.login('amy', 'amy-pass-123')).error, /權限/);
  const mike = s.login('mike', 'mike-pass-123');
  assert.equal(s.api('followup.update', { id: lead.id, note: '委員會面談完成' }, mike).ok, true);
  assert.equal(s.api('industry.analysis', {}, mike).ok, true);
});

test('產業分析：產業群組、重複專業別、招募目標缺口、來賓撞行業', () => {
  const s = setup();
  s.admin('members.save', { name: '王小明', category: '室內設計', industryGroup: '建築居家' });
  s.admin('members.save', { name: '陳大華', category: '保險規劃', industryGroup: '金融保險' });
  s.admin('members.save', { name: '林美麗', category: '室內設計師' });
  s.admin('members.save', { name: '張志強', category: '律師', industryGroup: '專業服務' });
  s.admin('industry.saveTarget', { category: '會計師', priority: '高' });
  const lawyer = s.admin('industry.saveTarget', { category: '律師', priority: '中' });
  assert.match(s.api('industry.saveTarget', { category: ' 會計師 ' }, s.token).error, /已經有/);
  s.api('public.register', { eventId: MTG, name: '撞業來賓', category: '保險' });
  s.api('public.register', { eventId: MTG, name: '補位來賓', category: '會計' });
  s.api('public.register', { eventId: MTG, name: '一般來賓', category: '花藝' });

  const a = s.admin('industry.analysis');
  assert.equal(a.memberCount, 4);
  assert.deepEqual(a.groups.map((g) => [g.group, g.members.length]), [['建築居家', 1], ['金融保險', 1], ['專業服務', 1], ['未分類', 1]]);
  assert.deepEqual(a.duplicates.map((d) => [d.a.name, d.b.name]), [['王小明', '林美麗']]);
  assert.deepEqual(a.targets.map((t) => [t.category, t.filled, t.filledBy]), [['會計師', false, []], ['律師', true, ['張志強']]]);
  assert.equal(a.gapCount, 1);
  const status = Object.fromEntries(a.prospects.map((p) => [p.name, p.status]));
  assert.deepEqual(status, { 撞業來賓: 'conflict', 補位來賓: 'gap', 一般來賓: 'open' });
  assert.deepEqual(a.prospects.find((p) => p.name === '撞業來賓').conflicts, [{ name: '陳大華', category: '保險規劃' }]);
  assert.match(a.prospects[0].source, /10\/8 例會/);
  s.admin('members.save', { name: '一般來賓', category: '花藝' });
  assert.ok(!s.admin('industry.analysis').prospects.some((p) => p.name === '一般來賓'), '已經是會員就不列入來賓檢查');
  s.admin('industry.deleteTarget', { id: lawyer.id });
  assert.deepEqual(s.admin('industry.analysis').targets.map((t) => t.category), ['會計師']);
});

test('財務：報名繳費自動入帳、取消與刪除自動作廢、手動記帳、作廢連動報名、月結與餘額', () => {
  const s = setup();
  addMembersByHand(s);
  s.admin('settings.save', { guestFee: '500', openingBalance: '10000' });

  const self = s.api('public.register', { eventId: MTG, name: '自己標繳費', category: '會計', paid: true }).data.registration;
  assert.equal(self.paid, false, '公開報名頁不能自己標記已繳費');

  const walk = s.admin('registrations.walkin', { eventId: MTG, name: '現場丙', category: '律師', paid: true }).registration;
  let ledger = rowsOf(s, '收支帳');
  assert.equal(ledger.length, 1, '只有幹部標記的繳費會入帳');
  assert.deepEqual(
    ['類型', '科目', '金額', '對象', '關聯ID', '經手人', '狀態', '日期'].map((k) => ledger[0][k]),
    ['收入', '來賓費', 500, '現場丙', walk.id, 'Joy', '正常', '2026-10-08']
  );
  assert.equal(rowsOf(s, '報名名單').find((r) => r['姓名'] === '現場丙')['帳目ID'], ledger[0]['帳目ID']);
  s.admin('registrations.update', { id: walk.id, patch: { paid: false } });
  assert.equal(rowsOf(s, '報名名單').find((r) => r['姓名'] === '現場丙')['帳目ID'], '');
  s.admin('registrations.update', { id: walk.id, patch: { paid: true } });
  s.admin('registrations.delete', { id: walk.id });
  ledger = rowsOf(s, '收支帳');
  assert.deepEqual(ledger.map((r) => [r['狀態'], r['作廢原因'], r['作廢人']]), [['作廢', '取消繳費', 'Joy'], ['作廢', '刪除報名', 'Joy']]);

  s.admin('registrations.update', { id: self.id, patch: { paid: true } });
  const party = s.admin('events.save', { type: '聯誼', name: '中秋烤肉', date: '2026-10-10', fee: '600', openRegistration: true });
  const member = s.admin('registrations.add', { eventId: party.id, role: '會員', memberId: 'M001', paid: true }).registration;
  const free = s.admin('events.save', { type: '培訓', name: '免費培訓', date: '2026-10-12', openRegistration: true });
  assert.equal(s.admin('registrations.add', { eventId: free.id, name: '免費來賓', paid: true }).registration.paid, true);
  assert.equal(rowsOf(s, '收支帳').length, 4, '免費活動標記繳費不記帳');
  const partyRow = rowsOf(s, '收支帳').find((r) => r['關聯ID'] === member.id);
  assert.deepEqual([partyRow['科目'], partyRow['金額'], partyRow['說明']], ['活動收入', 600, '2026-10-10（六） 中秋烤肉（會員）']);

  s.admin('finance.create', { type: '支出', date: '2026-10-08', category: '場地費', amount: '3,000', party: '暮溢共享空間', note: '10 月場地' });
  s.admin('finance.create', { type: '收入', date: '2026-09-30', category: '其他收入', amount: '200.5' });
  assert.match(s.api('finance.create', { type: '支出', date: '2026-10-08', category: '場地費', amount: '-5' }, s.token).error, /大於 0/);
  assert.match(s.api('finance.create', { type: '收', date: '2026-10-08', category: '場地費', amount: '5' }, s.token).error, /收入或支出/);
  assert.match(s.api('finance.create', { type: '支出', date: '', category: '場地費', amount: '5' }, s.token).error, /日期/);

  const partyEntry = s.admin('finance.page', { month: '2026-10' }).entries.find((e) => e.relatedId === member.id);
  assert.match(s.api('finance.void', { id: partyEntry.id, reason: ' ' }, s.token).error, /作廢原因/);
  s.admin('finance.void', { id: partyEntry.id, reason: '重複收款' });
  assert.equal(s.admin('registrations.list', { eventId: party.id })[0].paid, false, '作廢收入會取消報名的已繳費');
  assert.match(s.api('finance.void', { id: partyEntry.id, reason: '再一次' }, s.token).error, /已經作廢/);

  const page = s.admin('finance.page', { month: '2026-10' });
  assert.deepEqual(page.summary, { income: 500, expense: 3000, net: -2500, balance: 7700.5 });
  assert.equal(page.balance, 7700.5);
  assert.deepEqual(page.monthly.slice(8, 10).map((m) => [m.month, m.income, m.expense, m.balance, m.future]),
    [['2026-09', 200.5, 0, 10200.5, false], ['2026-10', 500, 3000, 7700.5, false]]);
  assert.equal(page.monthly[10].future, true);
  assert.deepEqual(page.byCategory.map((c) => [c.type, c.category, c.amount, c.count]), [['收入', '來賓費', 500, 1], ['支出', '場地費', 3000, 1]]);
  assert.deepEqual([page.entries.length, page.entries.filter((e) => e.voided).length], [5, 3], '作廢的帳仍列在明細');
  assert.equal(s.admin('finance.page', { month: '2027-01' }).monthly[0].balance, 7700.5, '跨年的月結從前一年累計');
});

test('會員月費：一次繳多個月、已繳月份擋下、作廢整筆連動、繳納表、首頁卡片與權限', () => {
  const s = setup();
  addMembersByHand(s);
  s.admin('settings.save', { monthlyDues: '1000' });
  const paid = s.admin('finance.payDues', { memberId: 'M001', months: ['2026-12', '2026-10', '2026-11', '2026-10'] });
  assert.deepEqual(paid.months, ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual([paid.ledger.amount, paid.ledger.category, paid.ledger.note], [3000, '會員月費', '月費 2026-10～2026-12（3 個月）']);
  assert.deepEqual(rowsOf(s, '會費紀錄').map((r) => r['月份']), ['2026-10', '2026-11', '2026-12'], '月份存成文字，不會被轉成日期');
  assert.match(s.api('finance.payDues', { memberId: 'M001', months: ['2026-12', '2027-01'] }, s.token).error, /王小明 的 2026-12 已經繳過了/);
  assert.match(s.api('finance.payDues', { memberId: 'M001', months: ['2026-13'] }, s.token).error, /請選擇要繳的月份/);
  assert.match(s.api('finance.payDues', { memberId: 'M999', months: ['2027-01'] }, s.token).error, /找不到這位會員/);
  s.admin('finance.payDues', { memberId: 'M002', months: '2026-10', amount: '800', paidDate: '2026-10-05' });

  let grid = s.admin('finance.dues', { year: '2026' });
  assert.deepEqual(grid.members.map((m) => m.name), ['王小明', '陳大華', '林美麗']);
  assert.deepEqual(Object.keys(grid.members[0].cells), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(grid.totals[9], { month: '2026-10', count: 2, amount: 1800 });
  assert.deepEqual([grid.monthlyDues, grid.startMonth], [1000, '2026-10']);
  let card = s.admin('home.data').cards.finance;
  assert.deepEqual([card.balance, card.income, card.expense, card.duesUnpaid], [3800, 3800, 0, 1]);

  s.admin('finance.voidDues', { id: grid.members[0].cells['2026-11'].id, reason: '金額有誤' });
  grid = s.admin('finance.dues', { year: '2026' });
  assert.deepEqual(Object.keys(grid.members[0].cells), [], '同一次繳的月份一起作廢');
  assert.deepEqual(rowsOf(s, '收支帳').map((r) => [r['對象'], r['狀態'], r['作廢原因']]), [['王小明', '作廢', '金額有誤'], ['陳大華', '正常', '']]);
  s.admin('finance.payDues', { memberId: 'M001', months: '2026-10' });
  card = s.admin('home.data').cards.finance;
  assert.deepEqual([card.balance, card.duesUnpaid], [1800, 1]);

  const entry = s.admin('finance.page', {}).entries.find((e) => e.party === '陳大華');
  s.admin('finance.void', { id: entry.id, reason: '退費' });
  assert.equal(Object.keys(s.admin('finance.dues', {}).members[1].cells).length, 0, '從收支帳作廢，月費紀錄也作廢');

  s.admin('accounts.create', { username: 'cara', displayName: 'Cara', roles: ['財務'], password: 'cara-pass-123' });
  s.admin('accounts.create', { username: 'amy', displayName: 'Amy', roles: '來賓接待', password: 'amy-pass-123' });
  const cara = s.as(s.login('cara', 'cara-pass-123'));
  const amy = s.login('amy', 'amy-pass-123');
  assert.equal(cara('finance.payDues', { memberId: 'M003', months: ['2026-10'] }).ledger.handledBy, 'Cara');
  assert.equal(cara('home.data').cards.finance.duesUnpaid, 1);
  assert.match(s.api('finance.page', {}, amy).error, /權限/);
  assert.match(s.api('finance.payDues', { memberId: 'M003', months: ['2026-11'] }, amy).error, /權限/);
  assert.equal(s.api('home.data', {}, amy).data.cards.finance, undefined);
});

test('信件：範本欄位檢查、收件對象、預覽、寄出與每日額度、發送紀錄、權限', () => {
  const s = setup();
  addMembersByHand(s);
  s.admin('settings.save', { chapterName: 'BNI 震宇分會', replyTo: 'chair@example.com', mailSenderName: '震宇分會秘書' });
  const page = s.admin('mail.page');
  assert.deepEqual(page.templates.map((t) => t.name), ['感謝來賓蒞臨', '例會邀請', '會籍到期提醒']);
  assert.deepEqual([page.senderName, page.replyTo, page.quota], ['震宇分會秘書', 'chair@example.com', 100]);
  assert.match(s.api('messages.saveTemplate', { channel: 'Email', name: '錯字', subject: '{{姓明}}您好', body: '內容' }, s.token).error, /\{\{姓明\}\} 不是可用的欄位/);
  assert.match(s.api('messages.saveTemplate', { channel: 'Email', name: '沒主旨', subject: '', body: '內容' }, s.token).error, /主旨/);
  const tpl = s.admin('messages.saveTemplate', { channel: 'Email', name: '測試信', subject: '{{姓名}}，謝謝參加{{活動名稱}}', body: '- {{姓名}} 您好\n\n{{分會名稱}}\n報名：{{報名連結}}' });
  assert.equal(s.admin('messages.templates', { channel: 'Email' }).templates.find((t) => t.id === tpl.id).body, tpl.body, '開頭是 - 的內容不會被當成公式');

  s.api('public.register', { eventId: MTG, name: '來賓甲', category: '設計', email: 'a@example.com' });
  s.api('public.register', { eventId: MTG, name: '來賓乙', category: '保險', email: 'not-an-email' });
  s.api('public.register', { eventId: MTG, name: '來賓丙', category: '律師' });
  s.api('public.register', { eventId: MTG, name: '來賓丁', category: '會計', email: 'A@example.com' });
  const draft = { templateId: tpl.id, subject: tpl.subject, body: tpl.body, group: 'eventGuests', eventId: MTG };
  const preview = s.admin('mail.preview', draft);
  assert.deepEqual(preview.recipients, [{ name: '來賓甲', email: 'a@example.com' }], '同一個信箱只寄一次');
  assert.deepEqual(preview.skipped, [{ name: '來賓乙', reason: 'Email 格式不正確' }, { name: '來賓丙', reason: '沒有 Email' }]);
  assert.equal(preview.sample.subject, '來賓甲，謝謝參加例會');
  assert.equal(preview.sample.body, '- 來賓甲 您好\n\nBNI 震宇分會\n報名：https://script.google.com/macros/s/fake/exec?page=register&event=MTG-2026-10-08');
  assert.equal(s.admin('mail.preview', { ...draft, group: 'eventArrived' }).recipients.length, 0);

  const sent = s.admin('mail.send', draft);
  assert.deepEqual([sent.sent, sent.failed.length, sent.quota], [1, 0, 99]);
  assert.deepEqual(s.outbox[0], { to: 'a@example.com', subject: '來賓甲，謝謝參加例會', body: preview.sample.body, name: '震宇分會秘書', replyTo: 'chair@example.com' });

  const custom = s.admin('mail.preview', { subject: '通知', body: '{{姓名}} 您好', group: 'custom', custom: '王大明 <wang@example.com>\nwang@example.com；bad' });
  assert.deepEqual(custom.recipients, [{ name: '王大明', email: 'wang@example.com' }]);
  assert.deepEqual(custom.skipped, [{ name: 'bad', reason: 'Email 格式不正確' }]);
  assert.equal(custom.sample.body, '王大明 您好');
  assert.match(s.api('mail.send', { subject: '通知', body: '{{不存在}}', group: 'custom', custom: 'x@example.com' }, s.token).error, /不是可用的欄位/);
  assert.match(s.api('mail.send', { subject: '通知', body: '內容', group: 'members' }, s.token).error, /沒有可以寄送的收件人/);
  s.mail.quota = 0;
  assert.match(s.api('mail.send', draft, s.token).error, /今天剩下 0 封寄信額度/);

  const log = s.admin('messages.log', { channel: 'Email' });
  assert.deepEqual(log.map((l) => [l.template, l.recipient, l.address, l.subject, l.result, l.by]), [['測試信', '來賓甲', 'a@example.com', '來賓甲，謝謝參加例會', '成功', 'Joy']]);
  s.admin('messages.deleteTemplate', { id: tpl.id });
  assert.equal(rowsOf(s, '訊息範本').find((r) => r['範本ID'] === tpl.id)['已刪除'], '是');

  s.admin('accounts.create', { username: 'amy', displayName: 'Amy', roles: '來賓接待', password: 'amy-pass-123' });
  const amy = s.login('amy', 'amy-pass-123');
  assert.match(s.api('mail.page', {}, amy).error, /權限/);
  assert.match(s.api('messages.log', { channel: 'Email' }, amy).error, /權限/);
  assert.equal(s.api('messages.log', { channel: 'LINE' }, amy).ok, true);
});

const LINE_TOKEN = 'a'.repeat(40) + '/b+c=';

/** 假的 LINE API：Token 對才回應，push 的結果可以在測試裡改 */
function fakeLine(s, overrides = {}) {
  s.urlFetch.handler = (url, opts) => {
    if ((opts.headers || {}).Authorization !== 'Bearer ' + LINE_TOKEN) return { code: 401, body: { message: 'Authentication failed' } };
    for (const [suffix, res] of Object.entries(overrides)) if (url.endsWith(suffix)) return res;
    if (url.endsWith('/v2/bot/info')) return { code: 200, body: { displayName: '震宇小助理' } };
    if (url.endsWith('/summary')) return { code: 200, body: { groupName: '震宇分會群組' } };
    if (url.endsWith('/members/count')) return { code: 200, body: { count: 35 } };
    if (url.endsWith('/v2/bot/message/quota')) return { code: 200, body: { type: 'limited', value: 200 } };
    if (url.endsWith('/v2/bot/message/quota/consumption')) return { code: 200, body: { totalUsage: 70 } };
    return { code: 200, body: {} };
  };
}

function lineWebhook(s, events) {
  return s.call('doPost', { postData: { contents: JSON.stringify({ destination: 'U0', events }) } });
}

function groupText(text, groupId = 'Cgroup1') {
  return { type: 'message', replyToken: 'rt', source: { type: 'group', groupId, userId: 'U1' }, message: { type: 'text', text } };
}

function lastReply(s) {
  const r = s.requests.filter((x) => x.url.endsWith('/message/reply')).at(-1);
  return r ? JSON.parse(r.payload).messages[0].text : '';
}

test('LINE：產生文字、Token 驗證只寫不讀、Webhook 綁定群組與防猜、推播與紀錄、額度、權限', () => {
  const s = setup();
  addMembersByHand(s);
  fakeLine(s);
  let page = s.admin('line.page');
  assert.equal(page.configured, false);
  assert.deepEqual(page.templates.map((t) => t.name), ['例會提醒', '報名邀請', '歡迎來賓']);
  s.api('public.register', { eventId: MTG, name: '來賓甲', category: '設計' });
  const text = s.admin('line.compose', { templateId: page.templates[0].id, eventId: MTG }).text;
  assert.equal(text, '【BNI ○○分會】例會提醒\n📅 2026-10-08（四） 07:00–09:00\n📍 \n目前已有 1 位來賓報名，大家加油！');
  s.admin('checkin.member', { eventId: MTG, memberId: 'M001', status: 'P' });
  assert.match(s.admin('line.compose', { kind: 'attendance', eventId: MTG }).text, /^【BNI ○○分會】2026-10-08（四） 出席結果\n會員 3 位：出席 1、遲到 0、代理 0、病假 0、缺席 0、未簽到 2/);
  assert.equal(s.admin('checkin.attendanceText', { eventId: MTG }), s.admin('line.compose', { kind: 'attendance', eventId: MTG }).text);
  assert.match(s.api('line.compose', { kind: 'palms', from: '2026-09-24', to: '2026-09-30' }, s.token).error, /沒有 PALMS 資料/);
  assert.match(s.api('line.send', { groupIds: ['x'], text: 'hi' }, s.token).error, /請選擇要推播的群組/);
  assert.match(s.api('line.bind', {}, s.token).error, /請先設定/);

  assert.match(s.api('line.saveToken', { token: 'short' }, s.token).error, /格式不正確/);
  assert.match(s.api('line.saveToken', { token: 'x'.repeat(40) }, s.token).error, /Token 無效/);
  const saved = s.admin('line.saveToken', { token: LINE_TOKEN });
  assert.deepEqual([saved.configured, saved.botName, saved.webhookUrl], [true, '震宇小助理', 'https://script.google.com/macros/s/fake/exec']);
  assert.ok(!JSON.stringify(s.admin('line.settings')).includes(LINE_TOKEN), 'Token 只寫不讀');
  assert.ok(!JSON.stringify(s.admin('line.page')).includes(LINE_TOKEN));

  lineWebhook(s, [{ type: 'join', replyToken: 'rt0', source: { type: 'group', groupId: 'Cgroup1' } }]);
  assert.match(lastReply(s), /輸入「綁定 六位數字」/);
  const { code } = s.admin('line.bind');
  assert.match(code, /^\d{6}$/);
  const wrong = code === '123456' ? '654321' : '123456';
  lineWebhook(s, [groupText('綁定 ' + wrong)]);
  assert.match(lastReply(s), /錯誤或已過期/);
  lineWebhook(s, [groupText('綁定' + code)]);
  assert.equal(lastReply(s), '✅ 已綁定「震宇分會群組」，之後可以從系統推播訊息到這個群組');
  lineWebhook(s, [groupText('綁定 ' + code, 'Cgroup2')]);
  assert.match(lastReply(s), /錯誤或已過期/, '綁定碼只能用一次');
  assert.deepEqual(s.admin('line.settings').groups.map((g) => [g.id, g.name, g.boundBy]), [['Cgroup1', '震宇分會群組', 'Joy']]);
  const before = s.requests.length;
  lineWebhook(s, [groupText('大家早安'), { type: 'message', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text: '綁定 ' + code } }]);
  assert.equal(s.requests.length, before, '一般訊息與私訊不處理');
  assert.equal(s.call('doPost', { postData: { contents: 'not json' } }).text, 'OK');
  for (let i = 0; i < 8; i++) lineWebhook(s, [groupText('綁定 ' + wrong, 'Cevil')]);
  const { code: code2 } = s.admin('line.bind');
  lineWebhook(s, [groupText('綁定 ' + code2, 'Cevil')]);
  assert.match(lastReply(s), /錯誤太多次/, '猜錯太多次暫停綁定');
  s.cache.remove('line_bind_fail');

  const res = s.admin('line.send', { groupIds: ['Cgroup1'], text, templateId: page.templates[0].id });
  assert.deepEqual(res.results.map((r) => [r.name, r.ok]), [['震宇分會群組', true]]);
  const push = s.requests.at(-1);
  assert.equal(push.url, 'https://api.line.me/v2/bot/message/push');
  assert.match(push.headers['X-Line-Retry-Key'], /^[0-9a-f-]{36}$/);
  assert.deepEqual(JSON.parse(push.payload), { to: 'Cgroup1', messages: [{ type: 'text', text }] });
  assert.match(s.api('line.send', { groupIds: ['Cgroup1'], text: 'x'.repeat(5001) }, s.token).error, /最多 5000 字/);
  fakeLine(s, { '/message/push': { code: 429, body: { message: 'You have reached your monthly limit.' } } });
  s.setNow('2026-10-08T06:55:00+08:00');
  assert.equal(s.admin('line.send', { groupIds: ['Cgroup1'], text: '第二則', label: '自訂' }).results[0].error, '本月訊息額度已用完，或發送太頻繁');
  fakeLine(s);
  assert.deepEqual(s.admin('messages.log', { channel: 'LINE' }).map((l) => [l.template, l.recipient, l.result]),
    [['自訂', '震宇分會群組', '失敗：本月訊息額度已用完，或發送太頻繁'], ['例會提醒', '震宇分會群組', '成功']], '新的在前');
  const quota = s.admin('line.quota');
  assert.deepEqual([quota.limit, quota.used, quota.remaining, quota.groups[0].count], [200, 70, 130, 35]);

  s.admin('accounts.create', { username: 'amy', displayName: 'Amy', roles: '來賓接待', password: 'amy-pass-123' });
  const amy = s.as(s.login('amy', 'amy-pass-123'));
  page = amy('line.page');
  assert.deepEqual([page.configured, page.canManage, page.groups.length], [true, false, 1]);
  assert.equal(amy('line.send', { groupIds: ['Cgroup1'], text: 'Amy 的訊息' }).results[0].ok, true);
  assert.match(s.api('line.settings', {}, s.login('amy', 'amy-pass-123')).error, /權限/);

  s.admin('line.unbind', { id: 'Cgroup1' });
  assert.deepEqual(s.admin('line.settings').groups, []);
  assert.equal(s.admin('line.saveToken', { clear: true }).configured, false);
});

test('排程：每週提醒到時間推播到 LINE、每天只推一次、太晚不補推、排程開關', () => {
  const s = setup();
  fakeLine(s);
  s.call('cronHourly'); // 還沒設定 LINE：什麼都不做
  s.admin('line.saveToken', { token: LINE_TOKEN });
  const { code } = s.admin('line.bind');
  lineWebhook(s, [groupText('綁定 ' + code, 'G1')]);
  s.admin('settings.save', { meetingPlace: '暮溢共享空間' });
  s.admin('reminders.save', { weekday: '四', time: '12:00', content: '下次例會 {{例會日期}}，地點：{{例會地點}}', pushLine: true });
  s.admin('reminders.save', { weekday: '四', time: '09:00', content: '太早的提醒', pushLine: true });
  s.admin('reminders.save', { weekday: '四', time: '12:10', content: '不推播的提醒', pushLine: false });
  const pushes = () => s.requests.filter((r) => r.url.endsWith('/message/push')).map((r) => JSON.parse(r.payload).messages[0].text);

  s.setNow('2026-10-08T11:59:00+08:00');
  s.call('cronHourly');
  assert.deepEqual(pushes(), []);
  s.setNow('2026-10-08T12:40:00+08:00');
  s.call('cronHourly');
  s.call('cronHourly');
  assert.deepEqual(pushes(), ['下次例會 2026-10-15（四），地點：暮溢共享空間'], '只推到時間、90 分鐘內、勾選推播的提醒，且每天一次');
  s.setNow('2026-10-15T12:05:00+08:00');
  s.call('cronHourly');
  assert.equal(pushes().length, 2, '下週同一則再推一次');
  assert.deepEqual(s.admin('messages.log', { channel: 'LINE' }).map((l) => [l.template, l.by]), [['每週提醒', '自動提醒'], ['每週提醒', '自動提醒']]);

  assert.equal(s.admin('line.cron', { enabled: true }).cron, true);
  s.admin('line.cron', { enabled: true });
  assert.deepEqual(s.triggers.map((t) => [t.getHandlerFunction(), t.spec.every]), [['cronHourly', 1]]);
  assert.equal(s.admin('line.settings').pushReminders, 2);
  assert.equal(s.admin('line.cron', { enabled: false }).cron, false);
  assert.equal(s.triggers.length, 0);
});
