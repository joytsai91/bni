/**
 * 資料表欄位與設定項目。
 * 程式用英文 key，試算表顯示中文標題；欄位依標題對應，所以在試算表裡調整欄位順序沒關係。
 */

const SETTING_ITEMS = [
  { key: 'chapterName', title: '分會名稱', value: 'BNI ○○分會', note: '顯示在畫面、簽到表、名牌與桌牌上' },
  { key: 'meetingWeekday', title: '例會星期', value: '四', note: '填 一～日，用來推算下次例會日期' },
  { key: 'meetingTime', title: '例會時間', value: '07:00', note: '顯示在簽到表上' },
  { key: 'lateAfter', title: '遲到判定時間', value: '07:00', note: '超過這個時間才簽到，自動記為遲到 (L)' },
  { key: 'guestFee', title: '來賓費用', value: '', note: '顯示在來賓簽到表，例如 500；留空就不顯示' },
  { key: 'badgeWidth', title: '名牌寬度(mm)', value: '90', note: '依名牌套內卡尺寸調整' },
  { key: 'badgeHeight', title: '名牌高度(mm)', value: '55', note: '' },
  { key: 'absenceAlert', title: '缺席提醒次數', value: '3', note: 'PALMS 統計期間內缺席達到這個次數就標示提醒' }
];

function col_(key, title, type) {
  return { key: key, title: title, type: type || 'text' };
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
    members: {
      name: '會員名單',
      widths: [80, 100, 200, 140, 120, 200, 80, 200],
      columns: [
        col_('id', '會員ID'), col_('name', '姓名'), col_('company', '公司'), col_('category', '專業別'),
        col_('phone', '手機', 'phone'), col_('email', 'Email'), col_('status', '狀態'), col_('note', '備註')
      ]
    },
    guests: {
      name: '來賓名單',
      widths: [110, 100, 100, 180, 120, 120, 180, 100, 60, 150, 60, 180, 150],
      columns: [
        col_('id', '來賓ID'), col_('date', '例會日期'), col_('name', '姓名'), col_('company', '公司'),
        col_('category', '專業別'), col_('phone', '手機', 'phone'), col_('email', 'Email'), col_('inviter', '邀請人'),
        col_('source', '來源'), col_('checkedInAt', '簽到時間'), col_('paid', '已繳費'), col_('note', '備註'),
        col_('createdAt', '建立時間')
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
    palms: {
      name: 'PALMS',
      columns: [col_('from', '期間起'), col_('to', '期間迄'), col_('name', '姓名')]
        .concat(PALMS_FIELDS.map(function (f) { return col_(f, f === '121' ? '1-2-1' : f, 'number'); }))
        .concat([col_('importedAt', '匯入時間')])
    }
  };
  return sheetDefs_.cache;
}
