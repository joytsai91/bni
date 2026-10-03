/**
 * LINE 小助理：
 * - 不設定機器人也能用：產生文字（範本、出席結果、PALMS 週報）→ 複製或分享到 LINE。
 * - 設定 LINE 官方帳號（Messaging API）後可以直接推播到群組：
 *   Channel access token 只寫不讀，存在指令碼屬性 LINE_TOKEN；已綁定的群組存在 LINE_GROUPS。
 * - 綁定群組：管理員在系統產生 6 位數綁定碼（10 分鐘有效、用一次就失效），把機器人加進群組後輸入「綁定 123456」。
 *   Apps Script 的 doPost 拿不到 LINE 的簽章標頭，所以安全性靠綁定碼：猜錯太多次會暫停綁定 10 分鐘。
 * - 每小時排程（cronHourly）：把勾選「推播 LINE」的每週提醒，在設定時間後的 90 分鐘內推到所有已綁定群組，每天最多一次。
 */

const LINE_API = 'https://api.line.me';
const LINE_TEXT_MAX = 5000;
const LINE_BIND_MINUTES = 10;
const LINE_BIND_MAX_FAILS = 10;
const CRON_HANDLER = 'cronHourly';
const REMINDER_WINDOW_MINUTES = 90;

function lineToken_() {
  return scriptProps_().getProperty('LINE_TOKEN') || '';
}

function lineGroups_() {
  try {
    const list = JSON.parse(scriptProps_().getProperty('LINE_GROUPS') || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveLineGroups_(list) {
  scriptProps_().setProperty('LINE_GROUPS', JSON.stringify(list));
}

/** 呼叫 LINE API；HTTP 錯誤不丟例外，回傳 { ok, code, body } */
function lineApi_(method, path, payload, headers, token) {
  const key = token || lineToken_();
  if (!key) throw new Error('還沒設定 LINE 機器人：請到「LINE 小助理 → 機器人設定」貼上 Channel access token');
  const opts = {
    method: method,
    muteHttpExceptions: true,
    headers: Object.assign({ Authorization: 'Bearer ' + key }, headers || {})
  };
  if (payload) {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(LINE_API + path, opts);
  let body = {};
  try {
    body = JSON.parse(res.getContentText() || '{}');
  } catch (e) {
    body = {};
  }
  const code = res.getResponseCode();
  return { ok: code >= 200 && code < 300, code: code, body: body };
}

function lineError_(res) {
  if (res.code === 401) return 'LINE Token 無效或已過期';
  if (res.code === 403) return '沒有權限（機器人可能已經不在群組裡）';
  if (res.code === 429) return '本月訊息額度已用完，或發送太頻繁';
  return 'LINE 回應錯誤 ' + res.code + (res.body && res.body.message ? '：' + res.body.message : '');
}

/** 推播文字到一個群組，成功回傳空字串，失敗回傳原因 */
function linePushText_(groupId, text) {
  try {
    const res = lineApi_('post', '/v2/bot/message/push', { to: groupId, messages: [{ type: 'text', text: text }] },
      { 'X-Line-Retry-Key': Utilities.getUuid() });
    return res.ok ? '' : lineError_(res);
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

function lineReply_(replyToken, text) {
  if (!replyToken || !lineToken_()) return;
  lineApi_('post', '/v2/bot/message/reply', { replyToken: replyToken, messages: [{ type: 'text', text: text }] });
}

function lineText_(value) {
  const text = multilineText_(value, LINE_TEXT_MAX + 1);
  if (!text) throw new Error('請輸入要發送的內容');
  if (text.length > LINE_TEXT_MAX) throw new Error('LINE 訊息最多 ' + LINE_TEXT_MAX + ' 字');
  return text;
}

// ---------- 小助理 ----------

/** LINE 小助理頁：範本、已綁定群組、最近幾期 PALMS */
function linePage_(d, ctx) {
  return {
    configured: !!lineToken_(),
    groups: lineGroups_().map(function (g) { return { id: g.id, name: g.name }; }),
    templates: listTemplates_({ channel: 'LINE' }).templates,
    fields: TEMPLATE_FIELDS,
    palmsPeriods: listPalmsPeriods_().slice(0, 8).map(function (p) { return { from: p.from, to: p.to }; }),
    canManage: hasPermission(ctx.perms, 'line.bot.manage'),
    canEditTemplates: hasPermission(ctx.perms, 'messages.template.manage')
  };
}

/** 產生要發送的文字：範本（帶入活動欄位）、出席結果、PALMS 週報 */
function lineCompose_(d) {
  if (d.kind === 'attendance') return { text: attendanceText_(d) };
  if (d.kind === 'palms') return { text: palmsLineText_(d) };
  const tpl = templatesTable_().rows.filter(function (r) { return r.id === d.templateId; })[0];
  if (!tpl) throw new Error('找不到這個範本，請重新整理');
  return { text: fillTemplate(tpl.body, messageContext_(d.eventId || '')) };
}

function sendLine_(d, ctx) {
  const text = lineText_(d.text);
  const ids = Array.isArray(d.groupIds) ? d.groupIds : [];
  const targets = lineGroups_().filter(function (g) { return ids.indexOf(g.id) >= 0; });
  if (!targets.length) throw new Error('請選擇要推播的群組');
  throttle_('line_push', 20, 60);
  const results = targets.map(function (g) {
    const error = linePushText_(g.id, text);
    return { id: g.id, name: g.name, ok: !error, error: error };
  });
  const templateName = templateName_(d.templateId) || cleanText_(d.label, 40);
  logSends_(results.map(function (r) {
    return { channel: 'LINE', template: templateName, recipient: r.name, address: '群組', subject: cleanText_(text, 60), result: r.ok ? '成功' : '失敗：' + r.error };
  }), operatorName_(ctx));
  return { results: results };
}

/** 本月額度與各群組人數（推播到群組，每位成員都算一則） */
function lineQuota_() {
  const q = lineApi_('get', '/v2/bot/message/quota');
  if (!q.ok) throw new Error(lineError_(q));
  const u = lineApi_('get', '/v2/bot/message/quota/consumption');
  if (!u.ok) throw new Error(lineError_(u));
  const limit = q.body.type === 'limited' ? toNumber(q.body.value) : null;
  const used = toNumber(u.body.totalUsage);
  return {
    limit: limit,
    used: used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    groups: lineGroups_().map(function (g) {
      const c = lineApi_('get', '/v2/bot/group/' + encodeURIComponent(g.id) + '/members/count');
      return { id: g.id, name: g.name, count: c.ok ? toNumber(c.body.count) : null };
    })
  };
}

// ---------- 機器人設定 ----------

function cronInstalled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === CRON_HANDLER; });
}

function lineSettings_() {
  return {
    configured: !!lineToken_(),
    botName: scriptProps_().getProperty('LINE_BOT_NAME') || '',
    groups: lineGroups_(),
    webhookUrl: webAppUrl_(),
    cron: cronInstalled_(),
    pushReminders: listReminders_().filter(function (r) { return r.enabled && r.pushLine; }).length
  };
}

/** 儲存 Token 前先向 LINE 驗證；d.clear 為 true 時移除 */
function saveLineToken_(d) {
  const props = scriptProps_();
  if (d.clear) {
    props.deleteProperty('LINE_TOKEN');
    props.deleteProperty('LINE_BOT_NAME');
    return lineSettings_();
  }
  const token = String(d.token == null ? '' : d.token).trim();
  if (!/^[A-Za-z0-9+/=._-]{20,600}$/.test(token)) throw new Error('Token 格式不正確，請從 LINE Developers 複製 Channel access token（長期）');
  const res = lineApi_('get', '/v2/bot/info', null, null, token);
  if (!res.ok) throw new Error(res.code === 401 ? 'LINE 驗證失敗：Token 無效或已過期' : lineError_(res));
  props.setProperty('LINE_TOKEN', token);
  props.setProperty('LINE_BOT_NAME', cleanText_(res.body.displayName, 40));
  return lineSettings_();
}

/** 產生群組綁定碼（10 分鐘有效） */
function startLineBinding_(d, ctx) {
  if (!lineToken_()) throw new Error('請先設定 Channel access token');
  const n = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000;
  const code = ('00000' + n).slice(-6);
  CacheService.getScriptCache().put('line_bind:' + code, JSON.stringify({ by: operatorName_(ctx) }), LINE_BIND_MINUTES * 60);
  return { code: code, minutes: LINE_BIND_MINUTES };
}

function removeLineGroup_(d) {
  return withLock_(function () {
    const groups = lineGroups_();
    if (!groups.some(function (g) { return g.id === d.id; })) throw new Error('找不到這個群組，請重新整理');
    saveLineGroups_(groups.filter(function (g) { return g.id !== d.id; }));
    return lineSettings_();
  });
}

/** 開啟／關閉每小時排程（每週提醒自動推播） */
function setCron_(d) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === CRON_HANDLER) ScriptApp.deleteTrigger(t);
  });
  if (d.enabled) ScriptApp.newTrigger(CRON_HANDLER).timeBased().everyHours(1).create();
  return lineSettings_();
}

// ---------- Webhook：LINE 把群組訊息送到這裡 ----------

function doPost(e) {
  Db.reset();
  try {
    throttle_('line_webhook', 120, 60); // 網址是公開的：限制次數，避免被灌爆外部連線額度
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    (Array.isArray(body.events) ? body.events.slice(0, 20) : []).forEach(handleLineEvent_);
  } catch (err) {
    console.error('LINE webhook', err && err.stack ? err.stack : err);
  }
  return ContentService.createTextOutput('OK');
}

function handleLineEvent_(ev) {
  if (!ev || !ev.source || !lineToken_()) return;
  const groupId = ev.source.groupId || ev.source.roomId || '';
  if (!groupId) return;
  if (ev.type === 'join') {
    lineReply_(ev.replyToken, '大家好，我是' + getSettings_().chapterName + '的小助理 👋\n' +
      '請管理員在系統「LINE 小助理 → 機器人設定」按「產生綁定碼」，再到這個群組輸入「綁定 六位數字」。');
    return;
  }
  if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
  const m = /^\s*綁定\s*(\d{6})\s*$/.exec(String(ev.message.text || ''));
  if (m) lineReply_(ev.replyToken, bindLineGroup_(groupId, m[1]));
}

function lineGroupName_(groupId) {
  try {
    const res = lineApi_('get', '/v2/bot/group/' + encodeURIComponent(groupId) + '/summary');
    return res.ok ? cleanText_(res.body.groupName, 60) : '';
  } catch (e) {
    return '';
  }
}

/** 用綁定碼綁定群組，回傳要回覆在群組裡的文字 */
function bindLineGroup_(groupId, code) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('line_bind_fail') || 0);
  if (fails >= LINE_BIND_MAX_FAILS) return '綁定碼錯誤太多次，請 10 分鐘後再試';
  const raw = cache.get('line_bind:' + code);
  if (!raw) {
    cache.put('line_bind_fail', String(fails + 1), LINE_BIND_MINUTES * 60);
    return '綁定碼錯誤或已過期，請在系統重新產生';
  }
  cache.remove('line_bind:' + code);
  let info = {};
  try {
    info = JSON.parse(raw);
  } catch (e) {
    info = {};
  }
  const name = lineGroupName_(groupId) || 'LINE 群組';
  withLock_(function () {
    const groups = lineGroups_().filter(function (g) { return g.id !== groupId; });
    groups.push({ id: groupId, name: name, boundAt: nowStamp_(), boundBy: info.by || '' });
    saveLineGroups_(groups);
  });
  return '✅ 已綁定「' + name + '」，之後可以從系統推播訊息到這個群組';
}

// ---------- 每小時排程 ----------

/**
 * 時間觸發器呼叫的入口（觸發器只能呼叫公開函式）。
 * 網頁訪客也能呼叫，但每則提醒每天只推一次、只推到時間的，所以不會造成重複或提早推播。
 */
function cronHourly() {
  Db.reset();
  try {
    pushDueReminders_();
  } catch (err) {
    console.error('cronHourly', err && err.stack ? err.stack : err);
  }
}

function pushDueReminders_() {
  if (!lineToken_()) return [];
  const groups = lineGroups_();
  if (!groups.length) return [];
  const today = todayIso_();
  const now = minutesOf(nowTime_());
  const props = scriptProps_();
  // 在鎖內挑出要推的提醒並先標記，避免兩次執行重疊時重複推播
  const due = withLock_(function () {
    const list = listReminders_().filter(function (r) {
      if (!r.enabled || !r.pushLine || r.weekday !== weekdayOf(today)) return false;
      const t = minutesOf(r.time);
      if (t < 0 || t > now || now - t > REMINDER_WINDOW_MINUTES) return false;
      return props.getProperty('REMINDER_SENT_' + r.id) !== today;
    });
    list.forEach(function (r) { props.setProperty('REMINDER_SENT_' + r.id, today); });
    return list;
  });
  if (!due.length) return [];
  const tplCtx = meetingTemplateContext_(getSettings_(), nextMeeting_());
  const logs = [];
  due.forEach(function (r) {
    const text = fillTemplate(r.content, tplCtx).slice(0, LINE_TEXT_MAX);
    groups.forEach(function (g) {
      const error = linePushText_(g.id, text);
      logs.push({ channel: 'LINE', template: '每週提醒', recipient: g.name, address: '群組', subject: cleanText_(text, 60), result: error ? '失敗：' + error : '成功' });
    });
  });
  logSends_(logs, '自動提醒');
  return logs;
}
