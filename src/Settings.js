/**
 * 分會設定：存在「設定」工作表，項目名稱在 A 欄、內容在 B 欄。
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
  return {
    chapterName: v('chapterName'),
    meetingWeekday: weekday,
    meetingWeekdayLabel: weekday >= 0 ? WEEKDAY_LABELS[weekday] : '',
    meetingTime: normalizeTime(v('meetingTime')) || v('meetingTime'),
    lateAfter: normalizeTime(v('lateAfter')),
    guestFee: v('guestFee'),
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
  switch (key) {
    case 'chapterName':
      if (!v) throw new Error('請填寫分會名稱');
      return v.slice(0, 40);
    case 'meetingWeekday': {
      const w = parseWeekday(v);
      if (w < 0) throw new Error('例會星期請填 一～日');
      return WEEKDAY_LABELS[w];
    }
    case 'meetingTime':
    case 'lateAfter': {
      const t = normalizeTime(v);
      if (!t) throw new Error(settingItem_(key).title + '請填時間，例如 07:00');
      return t;
    }
    case 'badgeWidth':
    case 'badgeHeight':
    case 'absenceAlert': {
      const item = settingItem_(key);
      if (v === '' || !isFinite(Number(v)) || Number(v) < 0) throw new Error(item.title + '請填數字');
      return String(Number(v));
    }
    default:
      return v.slice(0, 40);
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
