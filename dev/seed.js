'use strict';
/** 本機預覽與端對端測試用的示範資料 */

const MEMBERS = [
  ['王小明', '小明室內設計有限公司', '室內設計', '0912345678'],
  ['陳大華', '大華保險經紀人', '保險規劃'],
  ['林美麗', '美麗花藝工作室', '花藝設計'],
  ['張志強', '志強法律事務所', '企業法務'],
  ['李佳穎', '佳穎聯合會計師事務所', '會計稅務'],
  ['黃建國', '建國水電工程行', '水電工程'],
  ['吳淑芬', '淑芬整合行銷', '社群行銷'],
  ['劉家豪', '家豪不動產', '不動產仲介'],
  ['蔡宜君', '宜君牙醫診所', '牙醫'],
  ['鄭文傑', '文傑資訊科技股份有限公司', '系統開發'],
  ['謝雅婷', '雅婷商業攝影', '商業攝影'],
  ['許志明', '志明汽車', '汽車銷售']
];

const GUESTS = [
  ['周品妤', '品妤手作烘焙坊', '手工烘焙', '王小明'],
  ['Kevin Lin', 'KL Design Studio', '平面設計', '吳淑芬'],
  ['歐陽俊宏', '俊宏國際物流股份有限公司台中分公司', '國際物流', '陳大華']
];

function seed(gas, { pin = '1234' } = {}) {
  const ok = (res) => {
    if (!res.ok) throw new Error(res.error);
    return res.data;
  };
  gas.scriptProps.setProperty('ADMIN_PIN', pin);
  ok(gas.api('settings.save', {
    chapterName: 'BNI 示範分會', meetingWeekday: '四', meetingTime: '07:00', lateAfter: '07:00', guestFee: '500'
  }, pin));
  const date = ok(gas.api('admin.bootstrap', {}, pin)).nextMeeting; // 同時建立會員名單工作表
  const sheet = gas.ss.getSheetByName('會員名單');
  MEMBERS.forEach(([name, company, category, phone]) => {
    sheet.typeRow(['', name, company, category, phone ? "'" + phone : '', '', '', '']);
  });
  GUESTS.forEach(([name, company, category, inviter], i) => {
    ok(gas.api('guest.register', { date, name, company, category, inviter, phone: '092' + String(1234567 + i) }));
  });
  return { pin, date };
}

module.exports = { seed, MEMBERS, GUESTS };
