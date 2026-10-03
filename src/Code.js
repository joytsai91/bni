/**
 * BNI 分會管理系統：網頁入口、試算表選單、API 分派。
 *
 * 網頁：
 *   /exec                 管理系統（需要登入，功能依帳號角色顯示）
 *   /exec?page=register   報名頁（公開；可帶 &event=活動ID、&inviter=會員姓名）
 *
 * 注意：Apps Script 裡名稱不是底線結尾的函式，網頁訪客都能透過 google.script.run 呼叫。
 * 會讀寫資料的函式一律以底線結尾，網頁只走 apiCall（在這裡驗證登入與權限）；
 * Lib.js 的公開函式只做計算、不碰資料，選單函式在網頁環境取不到 UI 會直接失敗。
 */

function doGet(e) {
  const isRegister = e && e.parameter && e.parameter.page === 'register';
  return HtmlService.createTemplateFromFile(isRegister ? 'Register' : 'App')
    .evaluate()
    .setTitle(isRegister ? '活動報名' : 'BNI 分會管理系統')
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
    .addItem('建立管理員帳號', 'menuCreateAdmin')
    .addItem('重設帳號密碼', 'menuResetPassword')
    .addItem('顯示系統網址', 'menuShowUrls')
    .addToUi();
}

// 選單函式第一行先取 UI：從網頁被呼叫時會直接失敗，不會執行到後面

function menuSetup() {
  const ui = SpreadsheetApp.getUi();
  setupSheets_();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  authSecret_();
  const hasAccount = accountsTable_().rows.length > 0;
  ui.alert('資料表已就緒。' + (hasAccount ? '' : '\n\n下一步：請從選單「建立管理員帳號」。'));
}

function menuShowUrls() {
  const ui = SpreadsheetApp.getUi();
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    ui.alert('還沒部署成網頁應用程式：請到 Apps Script 編輯器「部署 → 新增部署 → 網頁應用程式」。');
    return;
  }
  ui.alert('系統網址', '管理系統：\n' + url + '\n\n報名頁：\n' + url + '?page=register', ui.ButtonSet.OK);
}

function setupSheets_() {
  const defs = sheetDefs_();
  Object.keys(defs).forEach(function (k) { Db.read(defs[k]); });
}

// ---------- API ----------

function apiRoutes_() {
  const regManage = ['guests.registration.manage', 'checkin.attendance.manage'];
  return {
    // 公開（不用登入）
    'public.bootstrap': { public: true, run: publicBootstrap_ },
    'public.register': { public: true, run: registerPublic_ },
    'auth.status': { public: true, run: authStatus_ },
    'auth.login': { public: true, run: login_ },

    // 登入後
    'app.bootstrap': { run: appBootstrap_ },
    'auth.changePassword': { run: changeOwnPassword_ },
    'home.data': { perm: 'home.dashboard.view', run: homeData_ },

    'events.options': { perm: 'events.event.view', run: eventOptions_ },
    'events.list': { perm: 'events.event.view', run: function (d) { return listEvents_(requireDate_(d.from), requireDate_(d.to)); } },
    'events.get': { perm: 'events.event.view', run: function (d) { return getEvent_(d.id); } },
    'events.save': { perm: 'events.event.manage', run: saveEvent_ },
    'events.status': { perm: 'events.event.manage', run: setEventStatus_ },
    'events.delete': { perm: 'events.event.manage', run: deleteEvent_ },

    'registrations.list': { perm: 'guests.registration.view', run: function (d) { return listRegistrations_(getEvent_(d.eventId).id); } },
    'registrations.add': { perm: 'guests.registration.manage', run: addRegistrationByAdmin_ },
    'registrations.walkin': { perm: regManage, run: addWalkin_ },
    'registrations.update': { perm: regManage, run: updateRegistration_ },
    'registrations.delete': { perm: 'guests.registration.manage', run: deleteRegistration_ },

    'checkin.board': { perm: ['checkin.attendance.manage', 'checkin.print.view'], run: checkinBoard_ },
    'checkin.member': { perm: 'checkin.attendance.manage', run: setMemberStatus_ },
    'checkin.markAbsent': { perm: 'checkin.attendance.manage', run: markUncheckedAbsent_ },
    'print.data': { perm: 'checkin.print.view', run: printData_ },

    'palms.preview': { perm: 'palms.report.manage', run: previewPalms_ },
    'palms.save': { perm: 'palms.report.manage', run: savePalms_ },
    'palms.periods': { perm: 'palms.report.view', run: listPalmsPeriods_ },
    'palms.summary': { perm: 'palms.report.view', run: palmsSummary_ },
    'palms.lineText': { perm: 'palms.report.view', run: palmsLineText_ },
    'palms.delete': { perm: 'palms.report.manage', run: deletePalmsPeriod_ },

    'members.list': { perm: 'members.member.view', run: function (d) { return listMembers_(!!d.includeInactive); } },
    'members.save': { perm: 'members.member.manage', run: saveMember_ },
    'members.delete': { perm: 'members.member.manage', run: deleteMember_ },

    'settings.get': { perm: 'system.settings.manage', run: settingsPage_ },
    'settings.save': { perm: 'system.settings.manage', run: saveSettings_ },
    'reminders.save': { perm: 'system.settings.manage', run: saveReminder_ },
    'reminders.delete': { perm: 'system.settings.manage', run: deleteReminder_ },

    'accounts.list': { perm: 'system.account.manage', run: listAccounts_ },
    'accounts.create': { perm: 'system.account.manage', run: createAccount_ },
    'accounts.update': { perm: 'system.account.manage', run: updateAccount_ },
    'accounts.resetPassword': { perm: 'system.account.manage', run: resetAccountPassword_ },
    'accounts.delete': { perm: 'system.account.manage', run: deleteAccount_ }
  };
}

/** 網頁唯一的呼叫入口：{ action, data, token } → { ok, data } 或 { ok: false, error, code } */
function apiCall(req) {
  Db.reset();
  try {
    req = req || {};
    const route = apiRoutes_()[req.action];
    if (!route) throw new Error('未知的操作：' + req.action);
    let ctx = null;
    if (!route.public) {
      ctx = authenticate_(req.token);
      if (route.perm) requirePerm_(ctx, route.perm);
    }
    return { ok: true, data: route.run(req.data || {}, ctx) };
  } catch (err) {
    console.error(req && req.action, err && err.stack ? err.stack : err);
    return { ok: false, error: err && err.message ? err.message : String(err), code: (err && err.code) || '' };
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

function webAppUrl_() {
  return ScriptApp.getService().getUrl() || '';
}

function authStatus_() {
  const s = getSettings_();
  return { needsSetup: accountsTable_().rows.length === 0, chapterName: s.chapterName, systemName: s.systemName };
}

/** 報名頁：開放報名、還沒結束、名額未滿的活動 */
function publicBootstrap_() {
  const s = getSettings_();
  const today = todayIso_();
  const now = nowTime_();
  const counts = registrationCounts_();
  const events = listEvents_(today, addDays(today, 84)).filter(function (e) {
    const taken = (counts[e.id] || emptyCounts_()).total;
    return !e.cancelled && e.openRegistration && isUpcoming_(e, today, now) && !(e.capacity > 0 && taken >= e.capacity);
  }).map(function (e) {
    return {
      id: e.id, type: e.type, name: e.name, dateLabel: e.dateLabel, timeLabel: e.timeLabel, place: e.place,
      fee: e.fee, isMeeting: e.isMeeting, description: e.description
    };
  });
  return {
    chapterName: s.chapterName,
    events: events,
    members: listMembers_(false).map(function (m) { return { id: m.id, name: m.name, category: m.category }; })
  };
}

/** 登入後的共用資料：帳號、權限、設定、會員名單（邀請人選單用） */
function appBootstrap_(d, ctx) {
  const url = webAppUrl_();
  return {
    account: ctx.account,
    perms: ctx.perms,
    settings: getSettings_(),
    today: todayIso_(),
    registerUrl: url ? url + '?page=register' : '',
    eventTypes: EVENT_TYPES,
    members: listMembers_(false).map(function (m) { return { id: m.id, name: m.name, category: m.category }; })
  };
}

function settingsPage_() {
  return { form: settingsForm_(), reminders: listReminders_(), spreadsheetUrl: ss_().getUrl() };
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
