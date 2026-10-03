/**
 * 資料表欄位、設定項目、角色與權限。
 * 程式用英文 key，試算表顯示中文標題；欄位依標題對應，所以在試算表裡調整欄位順序沒關係。
 * 有「已刪除」欄的資料表一律軟刪除：刪除只是把這欄標成「是」，原始資料留在試算表。
 */

const SETTING_ITEMS = [
  { key: 'systemName', title: '系統名稱', value: '分會管理系統', note: '顯示在選單最上方' },
  { key: 'chapterName', title: '分會名稱', value: 'BNI ○○分會', note: '顯示在畫面、簽到表、名牌與桌牌上' },
  { key: 'meetingWeekday', title: '例會星期', value: '四', note: '填 一～日，系統每週自動排出例會' },
  { key: 'meetingTime', title: '例會時間', value: '07:00', note: '例會開始時間' },
  { key: 'meetingEndTime', title: '例會結束時間', value: '09:00', note: '' },
  { key: 'meetingPlace', title: '例會地點', value: '', note: '顯示在首頁、報名頁與提醒訊息' },
  { key: 'lateAfter', title: '遲到判定時間', value: '07:00', note: '超過這個時間才簽到，自動記為遲到 (L)' },
  { key: 'guestFee', title: '來賓費用', value: '', note: '例如 500；留空代表不收費' },
  { key: 'monthlyDues', title: '每月會費', value: '', note: '會員月費繳納表的預設金額' },
  { key: 'openingBalance', title: '期初餘額', value: '0', note: '財務中心計算累計餘額用' },
  { key: 'expiryNoticeDays', title: '到期提醒天數', value: '60', note: '會籍到期前幾天開始在首頁提醒' },
  { key: 'mailSenderName', title: '寄件人名稱', value: '', note: '寄信時顯示的名稱，留空就用分會名稱' },
  { key: 'replyTo', title: '回覆信箱', value: '', note: '收件人按「回覆」時寄到這個信箱' },
  { key: 'badgeWidth', title: '名牌寬度(mm)', value: '90', note: '依名牌套內卡尺寸調整' },
  { key: 'badgeHeight', title: '名牌高度(mm)', value: '55', note: '' },
  { key: 'absenceAlert', title: '缺席提醒次數', value: '3', note: 'PALMS 統計期間內缺席達到這個次數就標示提醒' }
];

/** 權限代碼：{模組}.{資源}.{動作} */
const PERMISSIONS = [
  { code: 'home.dashboard.view', label: '首頁' },
  { code: 'events.event.view', label: '查看活動' },
  { code: 'events.event.manage', label: '管理活動' },
  { code: 'events.dashboard.view', label: '報名儀表板' },
  { code: 'guests.registration.view', label: '查看活動來賓' },
  { code: 'guests.registration.manage', label: '管理活動來賓' },
  { code: 'checkin.attendance.manage', label: '簽到' },
  { code: 'checkin.print.view', label: '列印' },
  { code: 'meeting.showcase.view', label: '來賓速覽' },
  { code: 'meeting.wheel.use', label: '幸運轉盤' },
  { code: 'followup.lead.view', label: '查看評議與追蹤' },
  { code: 'followup.lead.manage', label: '管理評議與追蹤' },
  { code: 'analysis.industry.view', label: '產業分析' },
  { code: 'analysis.target.manage', label: '管理招募目標' },
  { code: 'palms.report.view', label: '查看 PALMS' },
  { code: 'palms.report.manage', label: '匯入 PALMS' },
  { code: 'members.member.view', label: '查看會員名冊' },
  { code: 'members.member.manage', label: '管理會員名冊' },
  { code: 'finance.ledger.view', label: '查看財務' },
  { code: 'finance.ledger.manage', label: '記帳與作廢' },
  { code: 'finance.dues.manage', label: '收月費' },
  { code: 'messages.email.send', label: '寄信' },
  { code: 'messages.template.manage', label: '管理訊息範本' },
  { code: 'line.message.send', label: 'LINE 小助理' },
  { code: 'line.bot.manage', label: '設定 LINE 機器人' },
  { code: 'system.settings.manage', label: '系統設定' },
  { code: 'system.account.manage', label: '帳號管理' }
];

/** 每個登入的人都有的權限 */
const BASE_PERMISSIONS = ['home.dashboard.view', 'events.event.view'];

const ADMIN_ROLE = '系統管理員';

const ROLES = [
  { name: ADMIN_ROLE, grants: ['*'], note: '全部功能' },
  { name: '主席團', grants: ['*', '-system.account.manage'], note: '全部功能，但不能管理帳號' },
  { name: '財務', grants: ['finance.*', 'members.member.view', 'guests.registration.view'], note: '財務中心；會員名冊、活動來賓只能看' },
  { name: '會員委員會', grants: ['followup.*', 'analysis.*', 'members.*', 'guests.registration.*'], note: '評議與追蹤、產業分析、會員名冊、活動來賓' },
  { name: '來賓接待', grants: ['checkin.*', 'guests.registration.*', 'meeting.*', 'line.message.send'], note: '簽到與列印、活動來賓、來賓速覽、幸運轉盤、LINE 小助理' }
];

const EVENT_TYPES = ['例會', '共識會議', '培訓', '聯誼', '商務簡報', '其他'];

/** 來賓追蹤階段：前四個是進行中，後兩個是結案 */
const LEAD_STAGES = ['新來賓', '已聯繫', '有意願', '申請中', '已入會', '暫不考慮'];
const LEAD_ACTIVE_STAGES = ['新來賓', '已聯繫', '有意願', '申請中'];

const TARGET_PRIORITIES = ['高', '中', '低'];

const INCOME_CATEGORIES = ['來賓費', '會員月費', '活動收入', '其他收入'];
const EXPENSE_CATEGORIES = ['場地費', '餐費', '活動支出', '文具印刷', '禮品', '其他支出'];

/** 訊息範本可用的欄位（{{欄位}} 會自動換成資料） */
const TEMPLATE_FIELDS = [
  '姓名', '公司', '專業別', '邀請人', '到期日', '活動名稱', '活動日期', '活動時間', '活動地點', '報名連結',
  '來賓人數', '來賓名單', '已到來賓', '例會日期', '例會時間', '例會地點', '分會名稱'
];

/** 第一次建立「訊息範本」表時放進去的範本：管道、名稱、主旨、內容 */
const DEFAULT_TEMPLATES = [
  ['Email', '感謝來賓蒞臨', '感謝您蒞臨{{分會名稱}}',
    '{{姓名}} 您好：\n\n感謝您{{活動日期}}撥空參加{{分會名稱}}的{{活動名稱}}，希望這次的交流對您有幫助。\n\n' +
    '如果想更了解 BNI，或想再次參加，歡迎直接回覆這封信，或聯繫邀請您的{{邀請人}}。\n\n{{分會名稱}} 敬上'],
  ['Email', '例會邀請', '誠摯邀請您參加{{分會名稱}}例會',
    '{{姓名}} 您好：\n\n{{分會名稱}}誠摯邀請您參加例會：\n日期：{{活動日期}}\n時間：{{活動時間}}\n地點：{{活動地點}}\n\n' +
    '線上報名：{{報名連結}}\n\n期待與您見面！\n{{分會名稱}} 敬上'],
  ['Email', '會籍到期提醒', '{{分會名稱}}會籍即將到期提醒',
    '{{姓名}} 您好：\n\n提醒您，您的會籍將於 {{到期日}} 到期。若有任何問題，歡迎與分會幹部聯繫。\n\n{{分會名稱}} 敬上'],
  ['LINE', '例會提醒', '',
    '【{{分會名稱}}】例會提醒\n📅 {{活動日期}} {{活動時間}}\n📍 {{活動地點}}\n目前已有 {{來賓人數}} 位來賓報名，大家加油！'],
  ['LINE', '報名邀請', '',
    '歡迎邀請朋友參加{{分會名稱}}{{活動名稱}} 🙌\n📅 {{活動日期}} {{活動時間}}\n📍 {{活動地點}}\n報名連結 👉 {{報名連結}}'],
  ['LINE', '歡迎來賓', '',
    '熱烈歡迎今天蒞臨{{分會名稱}}的來賓 🎉\n{{已到來賓}}\n謝謝大家的邀請！']
];

function col_(key, title, type) {
  return { key: key, title: title, type: type || 'text' };
}

function deletedCol_() {
  return col_('deleted', '已刪除');
}

function sheetDefs_() {
  if (sheetDefs_.cache) return sheetDefs_.cache;
  sheetDefs_.cache = {
    settings: {
      name: '設定',
      plainText: true,
      widths: [140, 200, 420],
      columns: [col_('item', '項目'), col_('value', '內容'), col_('note', '說明')],
      seed: function () {
        return SETTING_ITEMS.map(function (s) { return [s.title, s.value, s.note]; });
      }
    },
    accounts: {
      name: '帳號',
      widths: [110, 110, 100, 100, 200, 80, 180, 60, 150, 150, 60],
      columns: [
        col_('id', '帳號ID'), col_('username', '帳號'), col_('displayName', '顯示名稱'), col_('title', '職稱'),
        col_('roles', '角色'), col_('memberId', '會員ID'), col_('email', 'Email'), col_('status', '狀態'),
        col_('lastLoginAt', '最後登入'), col_('createdAt', '建立時間'), deletedCol_()
      ]
    },
    members: {
      name: '會員名單',
      widths: [80, 100, 200, 140, 120, 100, 120, 200, 120, 100, 100, 100, 80, 200, 60],
      columns: [
        col_('id', '會員ID'), col_('name', '姓名'), col_('company', '公司'), col_('category', '專業別'),
        col_('industryGroup', '產業群組'), col_('position', '分會職務'), col_('phone', '手機', 'phone'),
        col_('email', 'Email'), col_('lineId', 'LINE ID'), col_('joinDate', '入會日'), col_('expiryDate', '到期日'),
        col_('sponsor', '引薦人'), col_('status', '狀態'), col_('note', '備註'), deletedCol_()
      ]
    },
    events: {
      name: '活動',
      widths: [140, 90, 160, 100, 80, 80, 160, 70, 70, 60, 240, 60, 100, 150, 150, 60],
      columns: [
        col_('id', '活動ID'), col_('type', '類型'), col_('name', '名稱'), col_('date', '日期'),
        col_('startTime', '開始時間'), col_('endTime', '結束時間'), col_('place', '地點'),
        col_('openRegistration', '開放報名'), col_('fee', '費用'), col_('capacity', '名額'), col_('description', '說明'),
        col_('status', '狀態'), col_('createdBy', '建立者'), col_('createdAt', '建立時間'), col_('updatedAt', '更新時間'),
        deletedCol_()
      ]
    },
    registrations: {
      name: '報名名單',
      widths: [110, 140, 100, 60, 80, 100, 180, 120, 120, 180, 100, 60, 150, 60, 80, 110, 180, 150, 60],
      columns: [
        col_('id', '報名ID'), col_('eventId', '活動ID'), col_('eventDate', '活動日期'), col_('role', '身分'),
        col_('memberId', '會員ID'), col_('name', '姓名'), col_('company', '公司'), col_('category', '專業別'),
        col_('phone', '手機', 'phone'), col_('email', 'Email'), col_('inviter', '邀請人'), col_('source', '來源'),
        col_('checkedInAt', '簽到時間'), col_('paid', '已繳費'), col_('paidAmount', '繳費金額', 'number'),
        col_('ledgerId', '帳目ID'), col_('note', '備註'), col_('createdAt', '建立時間'), deletedCol_()
      ]
    },
    attendance: {
      name: '會員出席',
      widths: [100, 80, 100, 60, 100, 150, 150],
      columns: [
        col_('date', '例會日期'), col_('memberId', '會員ID'), col_('name', '姓名'), col_('status', '狀態'),
        col_('substitute', '代理人'), col_('checkedInAt', '簽到時間'), col_('updatedAt', '更新時間')
      ]
    },
    reminders: {
      name: '每週提醒',
      widths: [110, 60, 70, 320, 80, 60, 60],
      columns: [
        col_('id', '提醒ID'), col_('weekday', '星期'), col_('time', '時間'), col_('content', '內容'),
        col_('pushLine', '推播LINE'), col_('enabled', '啟用'), deletedCol_()
      ],
      seed: function () {
        return [['R0001', '三', '12:00', 'BNI Connect 登錄截止', '', '是', '']];
      }
    },
    wheel: {
      name: '抽獎紀錄',
      widths: [110, 140, 100, 140, 100, 70, 100, 150, 60],
      columns: [
        col_('id', '紀錄ID'), col_('eventId', '活動ID'), col_('eventDate', '活動日期'), col_('prize', '獎項'),
        col_('winner', '得獎者'), col_('poolSize', '名單人數', 'number'), col_('drawnBy', '操作人'), col_('drawnAt', '抽獎時間'),
        deletedCol_()
      ]
    },
    leads: {
      name: '追蹤名單',
      widths: [110, 100, 180, 120, 120, 180, 100, 100, 100, 200, 70, 80, 100, 100, 240, 80, 150, 150, 60],
      columns: [
        col_('id', '追蹤ID'), col_('name', '姓名'), col_('company', '公司'), col_('category', '專業別'),
        col_('phone', '手機', 'phone'), col_('email', 'Email'), col_('inviter', '邀請人'), col_('firstVisit', '首次來訪'),
        col_('lastVisit', '最近來訪'), col_('visitEvents', '來訪活動'), col_('visits', '來訪次數', 'number'), col_('stage', '階段'),
        col_('owner', '負責人'), col_('nextDate', '下次追蹤日'), col_('latest', '最新進度'), col_('memberId', '會員ID'),
        col_('createdAt', '建立時間'), col_('updatedAt', '更新時間'), deletedCol_()
      ]
    },
    leadLogs: {
      name: '追蹤紀錄',
      widths: [110, 110, 150, 100, 80, 400, 60],
      columns: [
        col_('id', '紀錄ID'), col_('leadId', '追蹤ID'), col_('at', '時間'), col_('by', '記錄人'),
        col_('stage', '階段'), col_('content', '內容'), deletedCol_()
      ]
    },
    targets: {
      name: '招募目標',
      widths: [110, 140, 120, 70, 300, 60],
      columns: [
        col_('id', '目標ID'), col_('category', '專業別'), col_('industryGroup', '產業群組'), col_('priority', '優先度'),
        col_('note', '備註'), deletedCol_()
      ]
    },
    ledger: {
      name: '收支帳',
      widths: [110, 100, 60, 100, 90, 120, 260, 110, 90, 60, 160, 90, 150, 150],
      columns: [
        col_('id', '帳目ID'), col_('date', '日期'), col_('type', '類型'), col_('category', '科目'),
        col_('amount', '金額', 'number'), col_('party', '對象'), col_('note', '說明'), col_('relatedId', '關聯ID'),
        col_('handledBy', '經手人'), col_('status', '狀態'), col_('voidReason', '作廢原因'), col_('voidedBy', '作廢人'),
        col_('voidedAt', '作廢時間'), col_('createdAt', '建立時間')
      ]
    },
    dues: {
      name: '會費紀錄',
      widths: [110, 80, 100, 80, 80, 100, 110, 90, 60, 150],
      columns: [
        col_('id', '會費ID'), col_('memberId', '會員ID'), col_('name', '姓名'), col_('month', '月份'),
        col_('amount', '金額', 'number'), col_('paidDate', '繳費日'), col_('ledgerId', '帳目ID'), col_('handledBy', '經手人'),
        col_('status', '狀態'), col_('createdAt', '建立時間')
      ]
    },
    templates: {
      name: '訊息範本',
      widths: [90, 70, 140, 240, 480, 150, 60],
      columns: [
        col_('id', '範本ID'), col_('channel', '管道'), col_('name', '名稱'), col_('subject', '主旨'),
        col_('body', '內容'), col_('updatedAt', '更新時間'), deletedCol_()
      ],
      seed: function () {
        return DEFAULT_TEMPLATES.map(function (t, i) { return ['TP' + String(i + 1).padStart(3, '0'), t[0], t[1], t[2], t[3], '', '']; });
      }
    },
    sendLog: {
      name: '發送紀錄',
      widths: [110, 150, 60, 120, 140, 200, 240, 160, 100],
      columns: [
        col_('id', '紀錄ID'), col_('at', '時間'), col_('channel', '管道'), col_('template', '範本'),
        col_('recipient', '對象'), col_('address', '信箱／群組'), col_('subject', '主旨'), col_('result', '結果'), col_('by', '發送人')
      ]
    },
    palms: {
      name: 'PALMS',
      columns: [col_('from', '期間起'), col_('to', '期間迄'), col_('name', '姓名')]
        .concat(PALMS_FIELDS.map(function (f) { return col_(f, f === '121' ? '1-2-1' : f, 'number'); }))
        .concat([col_('importedAt', '匯入時間'), deletedCol_()])
    }
  };
  return sheetDefs_.cache;
}
