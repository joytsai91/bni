/**
 * BNI 分會管理系統：網頁入口、試算表選單、API 分派。
 *
 * 網頁：
 *   /exec                 管理系統（簽到、來賓、列印、PALMS、設定），需要管理密碼
 *   /exec?page=register   來賓報名表（公開）
 *
 * 注意：Apps Script 裡名稱不是底線結尾的函式，網頁訪客都能透過 google.script.run 呼叫。
 * 會讀寫資料的函式一律以底線結尾，網頁只走 apiCall（管理功能在這裡檢查密碼）；
 * Lib.js 的公開函式只做計算、不碰資料，選單函式在網頁環境取不到 UI 會直接失敗。
 */

function doGet(e) {
  const isRegister = e && e.parameter && e.parameter.page === 'register';
  return HtmlService.createTemplateFromFile(isRegister ? 'Register' : 'App')
    .evaluate()
    .setTitle(isRegister ? '來賓報名' : 'BNI 分會管理')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ---------- 試算表選單 ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('BNI 分會工具')
    .addItem('初始化資料表', 'menuSetup')
    .addItem('設定管理密碼', 'menuSetAdminPin')
    .addItem('顯示系統網址', 'menuShowUrls')
    .addToUi();
}

// 選單函式第一行先取 UI：從網頁被呼叫時會直接失敗，不會執行到後面

function menuSetup() {
  const ui = SpreadsheetApp.getUi();
  setupSheets_();
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  ui.alert('資料表已就緒。' + (props.getProperty('ADMIN_PIN') ? '' : '\n\n下一步：請從選單「設定管理密碼」。'));
}

function menuSetAdminPin() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('設定管理密碼', '至少 6 碼（建議英數混合）。簽到、列印、PALMS 等管理功能都要用這組密碼登入。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const pin = res.getResponseText().trim();
  if (pin.length < 6) {
    ui.alert('密碼至少 6 碼，請重新設定');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ADMIN_PIN', pin);
  ui.alert('管理密碼已更新');
}

function menuShowUrls() {
  const ui = SpreadsheetApp.getUi();
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert('還沒部署成網頁應用程式：請到 Apps Script 編輯器「部署 → 新增部署 → 網頁應用程式」。');
    return;
  }
  ui.alert('系統網址', '管理系統：\n' + url + '\n\n來賓報名表：\n' + url + '?page=register', ui.ButtonSet.OK);
}

function setupSheets_() {
  const defs = sheetDefs_();
  Object.keys(defs).forEach(function (k) { Db.read(defs[k]); });
}

// ---------- API ----------

function apiRoutes_() {
  return {
    'public.bootstrap': { isPublic: true, run: publicBootstrap_ },
    'guest.register': { isPublic: true, run: registerGuestPublic_ },
    'auth.check': { run: function () { return true; } },
    'admin.bootstrap': { run: adminBootstrap_ },
    'settings.save': { run: saveSettings_ },
    'checkin.board': { run: function (d) { return checkinBoard_(d.date); } },
    'checkin.member': { run: function (d) { return setMemberStatus_(d.date, d.memberId, d.status, d.substitute); } },
    'checkin.markAbsent': { run: function (d) { return markUncheckedAbsent_(d.date); } },
    'guest.list': { run: function (d) { return listGuests_(d.date); } },
    'guest.add': { run: addGuestByAdmin_ },
    'guest.walkin': { run: addWalkinGuest_ },
    'guest.update': { run: function (d) { return updateGuest_(d.id, d.patch); } },
    'guest.delete': { run: function (d) { return deleteGuest_(d.id); } },
    'print.data': { run: function (d) { return printData_(d.date); } },
    'palms.preview': { run: previewPalms_ },
    'palms.save': { run: savePalms_ },
    'palms.periods': { run: listPalmsPeriods_ },
    'palms.summary': { run: palmsSummary_ },
    'palms.lineText': { run: palmsLineText_ },
    'palms.delete': { run: deletePalmsPeriod_ }
  };
}

/** 網頁唯一的呼叫入口：{ action, data, pin } → { ok, data } 或 { ok: false, error } */
function apiCall(req) {
  try {
    req = req || {};
    const route = apiRoutes_()[req.action];
    if (!route) throw new Error('未知的操作：' + req.action);
    if (!route.isPublic) requirePin_(req.pin);
    return { ok: true, data: route.run(req.data || {}) };
  } catch (err) {
    console.error(req && req.action, err && err.stack ? err.stack : err);
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function requirePin_(pin) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_PIN');
  if (!expected) throw new Error('尚未設定管理密碼：請在試算表選單「BNI 分會工具 → 設定管理密碼」設定');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('pin_fails') || 0);
  if (fails >= 30) throw new Error('密碼錯誤次數過多，請 10 分鐘後再試');
  if (String(pin || '') !== expected) {
    cache.put('pin_fails', String(fails + 1), 600);
    throw new Error('管理密碼錯誤');
  }
}

/** 簡單限流：每個時間窗最多 max 次 */
function throttle_(key, max, seconds) {
  const cache = CacheService.getScriptCache();
  const bucket = key + ':' + Math.floor(Date.now() / 1000 / seconds);
  const count = Number(cache.get(bucket) || 0) + 1;
  cache.put(bucket, String(count), seconds + 5);
  if (count > max) throw new Error('目前送出的人太多，請稍後再試');
}

function publicBootstrap_() {
  const s = getSettings_();
  return {
    chapterName: s.chapterName,
    meetingTime: s.meetingTime,
    meetings: upcomingMeetings(todayIso_(), s.meetingWeekday, 6).map(function (d) {
      return { date: d, label: dateLabel_(d) };
    }),
    members: listMembers_(false).map(function (m) { return { name: m.name, category: m.category }; })
  };
}

function adminBootstrap_() {
  const s = getSettings_();
  const today = todayIso_();
  const url = ScriptApp.getService().getUrl() || '';
  return {
    settings: s,
    settingsForm: settingsForm_(),
    today: today,
    nextMeeting: nextMeetingDate(today, s.meetingWeekday),
    registerUrl: url ? url + '?page=register' : '',
    spreadsheetUrl: ss_().getUrl(),
    members: listMembers_(false).map(function (m) { return { name: m.name }; })
  };
}

// ---------- 時間 ----------

function nowDate_() {
  return new Date();
}

function todayIso_() {
  return Utilities.formatDate(nowDate_(), tz_(), 'yyyy-MM-dd');
}

function nowTime_() {
  return Utilities.formatDate(nowDate_(), tz_(), 'HH:mm');
}

function nowStamp_() {
  return Utilities.formatDate(nowDate_(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function requireDate_(value) {
  const date = parseDateLoose(value);
  if (!date) throw new Error('日期格式不正確');
  return date;
}

function dateLabel_(iso) {
  return iso + '（' + WEEKDAY_LABELS[weekdayOf(iso)] + '）';
}
