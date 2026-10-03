/**
 * 信件管理與訊息範本：
 * - 訊息範本存在「訊息範本」表，Email 與 LINE 共用；內容可以放 {{姓名}}、{{活動日期}} 這類欄位，發送時自動換成資料。
 * - 寄信用部署者的 Gmail（MailApp），寄件人名稱、回覆信箱在系統設定；寄出前檢查每日額度。
 * - 每一封信、每一則 LINE 推播都記在「發送紀錄」。
 */

const TEMPLATE_CHANNELS = ['Email', 'LINE'];
const MAX_EMAILS_PER_SEND = 100;
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** 收件對象：key、名稱、是否要選活動 */
const EMAIL_GROUPS = [
  { key: 'eventGuests', label: '活動來賓（全部報名）', needsEvent: true },
  { key: 'eventArrived', label: '活動來賓（已簽到）', needsEvent: true },
  { key: 'members', label: '全體在籍會員', needsEvent: false },
  { key: 'expiring', label: '會籍即將到期的會員', needsEvent: false },
  { key: 'leads', label: '追蹤中的來賓', needsEvent: false },
  { key: 'custom', label: '自訂收件人', needsEvent: false }
];

/** 保留換行的多行文字：去掉控制字元、統一換行 */
function multilineText_(value, max) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

// ---------- 範本 ----------

function templatesTable_() {
  return Db.read(sheetDefs_().templates);
}

function templateOut_(r) {
  return {
    id: r.id, channel: r.channel === 'LINE' ? 'LINE' : 'Email', name: r.name, subject: r.subject, body: r.body,
    updatedAt: r.updatedAt
  };
}

function listTemplates_(d) {
  const channel = d && d.channel;
  return {
    templates: templatesTable_().rows.map(templateOut_).filter(function (t) { return t.name && (!channel || t.channel === channel); }),
    fields: TEMPLATE_FIELDS
  };
}

/** 範本裡的 {{欄位}} 必須是系統認得的，避免打錯字寄出空白 */
function checkTemplateKeys_(text) {
  const unknown = templateKeys(text).filter(function (k) { return TEMPLATE_FIELDS.indexOf(k) < 0; });
  if (unknown.length) throw new Error('{{' + unknown.join('}}、{{') + '}} 不是可用的欄位');
}

function saveTemplate_(d) {
  const channel = TEMPLATE_CHANNELS.indexOf(d.channel) >= 0 ? d.channel : '';
  if (!channel) throw new Error('請選擇 Email 或 LINE');
  const name = cleanText_(d.name, 40);
  if (!name) throw new Error('請填寫範本名稱');
  const subject = channel === 'Email' ? cleanText_(d.subject, 150) : '';
  if (channel === 'Email' && !subject) throw new Error('請填寫信件主旨');
  const body = multilineText_(d.body, 5000);
  if (!body) throw new Error('請填寫內容');
  checkTemplateKeys_(subject + '\n' + body);
  const fields = { channel: channel, name: name, subject: subject, body: body, updatedAt: nowStamp_() };
  return withLock_(function () {
    const t = templatesTable_();
    if (d.id) {
      const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
      if (!row) throw new Error('找不到這個範本，請重新整理');
      Db.update(t, row._row, fields);
      return templateOut_(Object.assign({}, row, fields));
    }
    const created = Object.assign({ id: newId_('TP'), deleted: '' }, fields);
    Db.append(t, [created]);
    return templateOut_(created);
  });
}

function deleteTemplate_(d) {
  return withLock_(function () {
    const t = templatesTable_();
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這個範本，請重新整理');
    Db.softDelete(t, row._row);
    return true;
  });
}

function templateName_(id) {
  const row = id ? templatesTable_().rows.filter(function (r) { return r.id === id; })[0] : null;
  return row ? row.name : '';
}

// ---------- 範本欄位 ----------

/** 下一場還沒結束、沒有停會的例會 */
function nextMeeting_() {
  const today = todayIso_();
  const now = nowTime_();
  return listEvents_(today, addDays(today, 60)).filter(function (e) {
    return e.isMeeting && !e.cancelled && isUpcoming_(e, today, now);
  })[0] || null;
}

/** 所有收件人共用的欄位：分會、下一場例會，以及選定的活動 */
function messageContext_(eventId) {
  const ctx = meetingTemplateContext_(getSettings_(), nextMeeting_());
  if (!eventId) return ctx;
  const e = getEvent_(eventId);
  const guests = listRegistrations_(e.id).filter(function (r) { return r.role === ROLE_GUEST; });
  const url = webAppUrl_();
  return Object.assign(ctx, {
    活動名稱: e.name, 活動日期: e.dateLabel, 活動時間: e.timeLabel, 活動地點: e.place,
    報名連結: url ? url + '?page=register&event=' + encodeURIComponent(e.id) : '',
    來賓人數: guests.length,
    來賓名單: guests.map(function (r) { return r.name; }).join('、'),
    已到來賓: guests.filter(function (r) { return r.checkedInAt; }).map(function (r) {
      return r.name + (r.category ? '（' + r.category + '）' : '');
    }).join('\n')
  });
}

// ---------- 收件人 ----------

/** 自訂收件人：一行一位，可以寫「王小明 <abc@example.com>」或只寫信箱 */
function parseCustomRecipients_(text) {
  return String(text == null ? '' : text).slice(0, 20000).split(/[\n,;，；]+/).map(function (line) {
    const s = line.trim();
    if (!s) return null;
    const m = /^(.*?)<\s*([^<>\s]+)\s*>$/.exec(s);
    return m ? { name: cleanText_(m[1], 40), email: m[2], fields: { 姓名: cleanText_(m[1], 40) } } : { name: '', email: s, fields: {} };
  }).filter(Boolean).slice(0, 300);
}

function memberRecipient_(m) {
  return { name: m.name, email: m.email, fields: { 姓名: m.name, 公司: m.company, 專業別: m.category, 到期日: m.expiryDate } };
}

/** 依收件對象列出收件人；沒有 Email、格式不對的列在 skipped，同一個信箱只寄一次 */
function emailRecipients_(d) {
  let list;
  switch (d.group) {
    case 'eventGuests':
    case 'eventArrived': {
      const event = getEvent_(d.eventId);
      list = listRegistrations_(event.id).filter(function (r) {
        return r.role === ROLE_GUEST && (d.group === 'eventGuests' || r.checkedInAt);
      }).map(function (r) {
        return { name: r.name, email: r.email, fields: { 姓名: r.name, 公司: r.company, 專業別: r.category, 邀請人: r.inviter } };
      });
      break;
    }
    case 'members':
      list = listMembers_(false).map(memberRecipient_);
      break;
    case 'expiring': {
      const s = getSettings_();
      const ids = expiringMembers_(todayIso_(), s.expiryNoticeDays).map(function (m) { return m.id; });
      list = listMembers_(false).filter(function (m) { return ids.indexOf(m.id) >= 0; }).map(memberRecipient_);
      break;
    }
    case 'leads':
      list = leadsTable_().rows.map(function (r) { return leadOut_(r); }).filter(function (l) { return l.active; }).map(function (l) {
        return { name: l.name, email: l.email, fields: { 姓名: l.name, 公司: l.company, 專業別: l.category, 邀請人: l.inviter } };
      });
      break;
    case 'custom':
      list = parseCustomRecipients_(d.custom);
      break;
    default:
      throw new Error('請選擇收件對象');
  }
  const seen = {};
  const recipients = [];
  const skipped = [];
  list.forEach(function (r) {
    const email = String(r.email || '').trim();
    if (!email) {
      skipped.push({ name: r.name, reason: '沒有 Email' });
      return;
    }
    if (!EMAIL_RE.test(email) || email.length > 100) {
      skipped.push({ name: r.name || email, reason: 'Email 格式不正確' });
      return;
    }
    const key = email.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    recipients.push({ name: r.name || email, email: email, fields: r.fields || {} });
  });
  return { recipients: recipients, skipped: skipped };
}

// ---------- 寄信 ----------

function emailDraft_(d) {
  const subject = cleanText_(d.subject, 150);
  const body = multilineText_(d.body, 20000);
  if (!subject) throw new Error('請填寫信件主旨');
  if (!body) throw new Error('請填寫信件內容');
  checkTemplateKeys_(subject + '\n' + body);
  const r = emailRecipients_(d);
  return { subject: subject, body: body, base: messageContext_(d.eventId || ''), recipients: r.recipients, skipped: r.skipped };
}

function renderEmail_(draft, recipient) {
  const fields = Object.assign({}, draft.base, recipient ? recipient.fields : {});
  return {
    subject: fillTemplate(draft.subject, fields).replace(/[\r\n]+/g, ' ').trim(),
    body: fillTemplate(draft.body, fields)
  };
}

/** 寄出前預覽：收件人清單、略過的人、第一位收件人看到的信 */
function previewEmail_(d) {
  const draft = emailDraft_(d);
  const first = draft.recipients[0];
  const sample = renderEmail_(draft, first);
  return {
    recipients: draft.recipients.map(function (r) { return { name: r.name, email: r.email }; }),
    skipped: draft.skipped,
    sample: { to: first ? first.name + ' <' + first.email + '>' : '', subject: sample.subject, body: sample.body },
    quota: MailApp.getRemainingDailyQuota()
  };
}

function sendEmail_(d, ctx) {
  const draft = emailDraft_(d);
  const n = draft.recipients.length;
  if (!n) throw new Error('沒有可以寄送的收件人');
  if (n > MAX_EMAILS_PER_SEND) throw new Error('一次最多寄 ' + MAX_EMAILS_PER_SEND + ' 封，請分批寄送');
  const quota = MailApp.getRemainingDailyQuota();
  if (n > quota) throw new Error('今天剩下 ' + quota + ' 封寄信額度，這次要寄 ' + n + ' 封；請明天再寄或減少收件人');
  throttle_('email_send', 10, 60);
  const s = getSettings_();
  const templateName = templateName_(d.templateId);
  const results = draft.recipients.map(function (r) {
    const mail = renderEmail_(draft, r);
    try {
      const message = { to: r.email, subject: mail.subject, body: mail.body, name: s.mailSenderName };
      if (s.replyTo) message.replyTo = s.replyTo;
      MailApp.sendEmail(message);
      return { name: r.name, email: r.email, subject: mail.subject, ok: true, error: '' };
    } catch (err) {
      return { name: r.name, email: r.email, subject: mail.subject, ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
  logSends_(results.map(function (r) {
    return { channel: 'Email', template: templateName, recipient: r.name, address: r.email, subject: r.subject, result: r.ok ? '成功' : '失敗：' + r.error };
  }), operatorName_(ctx));
  const failed = results.filter(function (r) { return !r.ok; });
  return {
    sent: results.length - failed.length,
    failed: failed.map(function (r) { return { name: r.name, email: r.email, error: r.error }; }),
    quota: MailApp.getRemainingDailyQuota()
  };
}

/** 信件管理頁：Email 範本、收件對象、寄件設定、今日額度 */
function mailPage_() {
  const s = getSettings_();
  return {
    templates: listTemplates_({ channel: 'Email' }).templates,
    fields: TEMPLATE_FIELDS,
    groups: EMAIL_GROUPS,
    senderName: s.mailSenderName,
    replyTo: s.replyTo,
    quota: MailApp.getRemainingDailyQuota(),
    maxPerSend: MAX_EMAILS_PER_SEND
  };
}

// ---------- 發送紀錄 ----------

function logSends_(entries, by) {
  if (!entries.length) return;
  withLock_(function () {
    const t = Db.read(sheetDefs_().sendLog);
    const at = nowStamp_();
    Db.append(t, entries.map(function (e) {
      return Object.assign({ id: newId_('S'), at: at, by: by, template: '', recipient: '', address: '', subject: '', result: '' }, e);
    }));
  });
}

/** 最近的發送紀錄（Email 要有寄信權限、LINE 要有 LINE 小助理權限） */
function listSendLog_(d, ctx) {
  const channel = d.channel === 'LINE' ? 'LINE' : 'Email';
  requirePerm_(ctx, channel === 'LINE' ? 'line.message.send' : 'messages.email.send');
  return Db.read(sheetDefs_().sendLog).rows.filter(function (r) { return r.channel === channel; }).map(function (r) {
    return { id: r.id, at: r.at, template: r.template, recipient: r.recipient, address: r.address, subject: r.subject, result: r.result, by: r.by };
  }).sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; }).slice(0, 200);
}
