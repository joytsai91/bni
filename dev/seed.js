'use strict';
/** 本機預覽與端對端測試用的示範資料 */

// 姓名、公司、專業別、產業群組、分會職務、手機、到期日
const MEMBERS = [
  ['王小明', '小明室內設計有限公司', '室內設計', '建築居家', '主席', '0912345678', '2027-03-31'],
  ['陳大華', '大華保險經紀人', '保險規劃', '金融保險', '副主席', '', '2026-11-15'],
  ['林美麗', '美麗花藝工作室', '花藝設計', '活動禮品', '秘書財務', '', '2027-06-30'],
  ['張志強', '志強法律事務所', '企業法務', '專業服務', '', '', '2027-01-31'],
  ['李佳穎', '佳穎聯合會計師事務所', '會計稅務', '專業服務', '', '', '2027-02-28'],
  ['黃建國', '建國水電工程行', '水電工程', '建築居家', '', '', '2026-10-20'],
  ['吳淑芬', '淑芬整合行銷', '社群行銷', '行銷設計', '來賓接待', '', '2027-05-31'],
  ['劉家豪', '家豪不動產', '不動產仲介', '建築居家', '', '', '2027-04-30'],
  ['蔡宜君', '宜君牙醫診所', '牙醫', '醫療健康', '', '', '2027-03-31'],
  ['鄭文傑', '文傑資訊科技股份有限公司', '系統開發', '資訊科技', '', '', '2027-01-31'],
  ['謝雅婷', '雅婷商業攝影', '商業攝影', '行銷設計', '', '', '2027-08-31'],
  ['許志明', '志明汽車', '汽車銷售', '汽車交通', '', '', '2027-07-31']
];

const GUESTS = [
  ['周品妤', '品妤手作烘焙坊', '手工烘焙', '王小明'],
  ['Kevin Lin', 'KL Design Studio', '平面設計', '吳淑芬'],
  ['歐陽俊宏', '俊宏國際物流股份有限公司台中分公司', '國際物流', '陳大華']
];

const ADMIN = { username: 'admin', password: 'demo-pass-123', displayName: 'Joy', title: '主席', roles: '系統管理員' };
const STAFF = { username: 'amy', password: 'amy-pass-123', displayName: 'Amy', title: '來賓接待', roles: '來賓接待' };

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function seed(gas) {
  const ok = (res) => {
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  gas.createAccount(ADMIN);
  const token = gas.login(ADMIN.username, ADMIN.password);
  ok(gas.api('settings.save', {
    systemName: '示範管理系統', chapterName: 'BNI 示範分會', meetingWeekday: '四', meetingTime: '07:00', meetingEndTime: '09:00',
    lateAfter: '07:00', meetingPlace: '台北市信義區示範會館 3F', guestFee: '500', monthlyDues: '1500'
  }, token));
  ok(gas.api('members.list', {}, token)); // 建立會員名單工作表
  const sheet = gas.ss.getSheetByName('會員名單');
  MEMBERS.forEach(([name, company, category, group, position, phone, expiry]) => {
    sheet.typeRow(['', name, company, category, group, position, phone ? "'" + phone : '', '', '', '', "'" + expiry, '', '在籍']);
  });
  ok(gas.api('accounts.create', Object.assign({}, STAFF, { roles: [STAFF.roles] }), token));
  const meeting = ok(gas.api('home.data', {}, token)).nextMeeting;
  GUESTS.forEach(([name, company, category, inviter], i) => {
    ok(gas.api('public.register', { eventId: meeting.id, name, company, category, inviter, phone: '092' + String(1234567 + i) }));
  });
  ok(gas.api('events.save', {
    type: '共識會議', name: '共識會議', date: addDays(meeting.date, 8), startTime: '06:30', endTime: '09:00', place: '暮溢共享空間',
    openRegistration: false, description: '年度目標與分工討論'
  }, token));
  const party = ok(gas.api('events.save', {
    type: '聯誼', name: '中秋烤肉聯誼', date: addDays(meeting.date, 10),
    startTime: '18:00', endTime: '21:00', place: '河濱公園', openRegistration: true, fee: '600', capacity: '40',
    description: '歡迎攜伴參加'
  }, token));
  return { admin: ADMIN, staff: STAFF, token, meetingId: meeting.id, partyId: party.id };
}

module.exports = { seed, MEMBERS, GUESTS, ADMIN, STAFF };
