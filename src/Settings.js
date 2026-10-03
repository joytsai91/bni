/**
 * 分會設定：存在「設定」工作表，項目名稱在 A 欄、內容在 B 欄。
 * 每週提醒：存在「每週提醒」工作表，顯示在首頁「這一週」，也可以設定自動推播到 LINE 群組。
 */

function settingItem_(key) {
  return SETTING_ITEMS.filter(function (s) { return s.key === key; })[0];
}

function rawSettings_() {
  const raw = {};
  Db.read(sheetDefs_().settings).rows.forEach(function (r) {
    raw[String(r.item).trim()] = String(r.value == null ? '' : r.value).trim();
  });
  return raw;
}

function clampNumber_(value, min, max, fallback) {
  const n = Number(value);
  if (value === '' || !isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getSettings_() {
  const raw = rawSettings_();
  const v = function (key) {
    const item = settingItem_(key);
    const val = raw[item.title];
    return val !== undefined && val !== '' ? val : item.value;
  };
  const weekday = parseWeekday(v('meetingWeekday'));
  const chapterName = v('chapterName');
  return {
    systemName: v('systemName'),
    chapterName: chapterName,
    meetingWeekday: weekday,
    meetingWeekdayLabel: weekday >= 0 ? WEEKDAY_LABELS[weekday] : '',
    meetingTime: normalizeTime(v('meetingTime')),
    meetingEndTime: normalizeTime(v('meetingEndTime')),
    meetingPlace: v('meetingPlace'),
    lateAfter: normalizeTime(v('lateAfter')),
    guestFee: feeAmount_(v('guestFee')),
    monthlyDues: feeAmount_(v('monthlyDues')),
    openingBalance: toNumber(v('openingBalance')),
    expiryNoticeDays: Math.round(clampNumber_(v('expiryNoticeDays'), 0, 365, 60)),
    mailSenderName: v('mailSenderName') || chapterName,
    replyTo: v('replyTo'),
    badgeWidth: clampNumber_(v('badgeWidth'), 40, 200, 90),
    badgeHeight: clampNumber_(v('badgeHeight'), 25, 150, 55),
    absenceAlert: Math.round(clampNumber_(v('absenceAlert'), 0, 52, 3))
  };
}

/** 設定頁表單用：目前在試算表裡的原始值 */
function settingsForm_() {
  const raw = rawSettings_();
  return SETTING_ITEMS.map(function (s) {
    return { key: s.key, title: s.title, value: raw[s.title] !== undefined ? raw[s.title] : s.value, note: s.note };
  });
}

function validateSetting_(key, value) {
  const v = String(value == null ? '' : value).trim();
  const title = settingItem_(key).title;
  switch (key) {
    case 'systemName':
    case 'chapterName':
      if (!v) throw new Error('請填寫' + title);
      return v.slice(0, 40);
    case 'meetingWeekday': {
      const w = parseWeekday(v);
      if (w < 0) throw new Error('例會星期請填 一～日');
      return WEEKDAY_LABELS[w];
    }
    case 'meetingTime':
    case 'meetingEndTime':
    case 'lateAfter': {
      const t = normalizeTime(v);
      if (!t) throw new Error(title + '請填時間，例如 07:00');
      return t;
    }
    case 'guestFee':
    case 'monthlyDues':
    case 'openingBalance':
    case 'expiryNoticeDays':
    case 'badgeWidth':
    case 'badgeHeight':
    case 'absenceAlert':
      if (v === '' && (key === 'guestFee' || key === 'monthlyDues')) return '';
      if (!/^-?\d+(\.\d+)?$/.test(v) || (key !== 'openingBalance' && Number(v) < 0)) throw new Error(title + '請填數字');
      return String(Number(v));
    case 'replyTo':
      if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error('回覆信箱格式不正確');
      return v.slice(0, 100);
    default:
      return v.slice(0, 80);
  }
}

function saveSettings_(data) {
  const values = {};
  SETTING_ITEMS.forEach(function (s) {
    if (Object.prototype.hasOwnProperty.call(data, s.key)) values[s.key] = validateSetting_(s.key, data[s.key]);
  });
  withLock_(function () {
    const t = Db.read(sheetDefs_().settings);
    const added = [];
    Object.keys(values).forEach(function (key) {
      const item = settingItem_(key);
      const row = t.rows.filter(function (r) { return String(r.item).trim() === item.title; })[0];
      if (row) Db.update(t, row._row, { value: values[key] });
      else added.push({ item: item.title, value: values[key], note: item.note });
    });
    Db.append(t, added);
  });
  return getSettings_();
}

// ---------- 每週提醒 ----------

function reminderOut_(r) {
  const weekday = parseWeekday(r.weekday);
  return {
    id: r.id, weekday: weekday, weekdayLabel: weekday >= 0 ? WEEKDAY_LABELS[weekday] : '',
    time: normalizeTime(r.time), content: r.content, pushLine: boolFlag_(r.pushLine, false), enabled: boolFlag_(r.enabled, true)
  };
}

function listReminders_() {
  return Db.read(sheetDefs_().reminders).rows.map(reminderOut_).sort(function (a, b) {
    const ka = ((a.weekday + 6) % 7) + a.time;
    const kb = ((b.weekday + 6) % 7) + b.time;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function saveReminder_(d) {
  const weekday = parseWeekday(d.weekday);
  if (weekday < 0) throw new Error('請選擇星期');
  const time = normalizeTime(d.time);
  if (!time) throw new Error('請填時間，例如 12:00');
  const content = cleanText_(d.content, 300);
  if (!content) throw new Error('請填寫提醒內容');
  const fields = {
    weekday: WEEKDAY_LABELS[weekday], time: time, content: content,
    pushLine: d.pushLine ? '是' : '', enabled: d.enabled === false ? '否' : '是'
  };
  return withLock_(function () {
    const t = Db.read(sheetDefs_().reminders);
    if (d.id) {
      const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
      if (!row) throw new Error('找不到這則提醒，請重新整理');
      Db.update(t, row._row, fields);
      return reminderOut_(Object.assign({}, row, fields));
    }
    const created = Object.assign({ id: newId_('R'), deleted: '' }, fields);
    Db.append(t, [created]);
    return reminderOut_(created);
  });
}

function deleteReminder_(d) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().reminders);
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這則提醒，請重新整理');
    Db.softDelete(t, row._row);
    return true;
  });
}
