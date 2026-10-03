/**
 * 活動：
 * - 每週例會依設定自動產生，ID 是「MTG-日期」（例如 MTG-2026-10-08），不用每週手動建立。
 * - 個別例會要停會、改時間或地點時，在「活動」表存一列同 ID 的覆寫資料。
 * - 共識會議、培訓、聯誼等其他活動手動建立，ID 是 E 開頭。
 */

const MEETING_PREFIX = 'MTG-';
const EVENT_NORMAL = '正常';
const EVENT_CANCELLED = '停會';

function meetingIdFor_(date) {
  return MEETING_PREFIX + date;
}

function isMeetingId_(id) {
  return String(id == null ? '' : id).indexOf(MEETING_PREFIX) === 0;
}

function boolFlag_(value, fallback) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return fallback;
  return /^(是|開放|true|yes|y|1)$/i.test(s);
}

function feeAmount_(value) {
  return Math.max(0, toNumber(value));
}

function meetingBase_(date, s) {
  return {
    id: meetingIdFor_(date), type: '例會', name: '例會', date: date,
    startTime: s.meetingTime, endTime: s.meetingEndTime, place: s.meetingPlace,
    openRegistration: true, fee: feeAmount_(s.guestFee), capacity: 0, description: '',
    status: EVENT_NORMAL, auto: true
  };
}

function pick_(value, fallback) {
  return value === '' || value === null || value === undefined ? fallback : value;
}

/** 例會 ID 的日期必須是例會星期，或已有覆寫資料；避免有人自己編造日期報名 */
function meetingDateFor_(id, rows, s) {
  const date = parseDateLoose(String(id).slice(MEETING_PREFIX.length));
  const hasRow = rows.some(function (r) { return r.id === id; });
  if (!date || (!hasRow && weekdayOf(date) !== s.meetingWeekday)) throw new Error('找不到這場例會');
  return date;
}

function mergeMeeting_(base, row) {
  return {
    id: base.id, type: '例會', name: pick_(row.name, base.name), date: base.date,
    startTime: pick_(normalizeTime(row.startTime), base.startTime),
    endTime: pick_(normalizeTime(row.endTime), base.endTime),
    place: pick_(row.place, base.place),
    openRegistration: boolFlag_(row.openRegistration, base.openRegistration),
    fee: row.fee === '' ? base.fee : feeAmount_(row.fee),
    capacity: row.capacity === '' ? base.capacity : toNumber(row.capacity),
    description: row.description || '',
    status: pick_(row.status, base.status),
    auto: true
  };
}

function rowToEvent_(r) {
  return {
    id: r.id, type: r.type || '其他', name: r.name || r.type || '活動', date: r.date,
    startTime: normalizeTime(r.startTime), endTime: normalizeTime(r.endTime), place: r.place,
    openRegistration: boolFlag_(r.openRegistration, false), fee: feeAmount_(r.fee), capacity: toNumber(r.capacity),
    description: r.description, status: r.status || EVENT_NORMAL, auto: false
  };
}

function eventOut_(e) {
  return {
    id: e.id, type: e.type, name: e.name, date: e.date, dateLabel: dateLabel_(e.date),
    startTime: e.startTime || '', endTime: e.endTime || '', timeLabel: timeRangeLabel(e.startTime, e.endTime),
    place: e.place || '', openRegistration: !!e.openRegistration, fee: e.fee || 0, capacity: e.capacity || 0,
    description: e.description || '', status: e.status, cancelled: e.status === EVENT_CANCELLED,
    isMeeting: e.type === '例會', auto: !!e.auto
  };
}

function compareEvents_(a, b) {
  const ka = a.date + ' ' + (a.startTime || '99:99');
  const kb = b.date + ' ' + (b.startTime || '99:99');
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** from～to（含）之間的所有活動，含自動產生的每週例會 */
function listEvents_(from, to) {
  const s = getSettings_();
  const overrides = {};
  const list = [];
  Db.read(sheetDefs_().events).rows.forEach(function (r) {
    if (isMeetingId_(r.id)) overrides[r.id] = r;
    else if (r.date && r.date >= from && r.date <= to) list.push(rowToEvent_(r));
  });
  meetingDatesBetween(from, to, s.meetingWeekday).forEach(function (date) {
    const base = meetingBase_(date, s);
    const o = overrides[base.id];
    list.push(o ? mergeMeeting_(base, o) : base);
  });
  return list.map(eventOut_).sort(compareEvents_);
}

function getEvent_(id) {
  id = String(id == null ? '' : id);
  const rows = Db.read(sheetDefs_().events).rows;
  if (isMeetingId_(id)) {
    const s = getSettings_();
    const base = meetingBase_(meetingDateFor_(id, rows, s), s);
    const o = rows.filter(function (r) { return r.id === id; })[0];
    return eventOut_(o ? mergeMeeting_(base, o) : base);
  }
  const r = rows.filter(function (x) { return x.id === id; })[0];
  if (!r) throw new Error('找不到這場活動，可能已被刪除');
  return eventOut_(rowToEvent_(r));
}

/** 還沒結束的活動（今天的活動在結束時間前都算） */
function isUpcoming_(e, today, nowTime) {
  if (e.date > today) return true;
  return e.date === today && (!e.endTime || nowTime <= e.endTime);
}

/** 選單用：前後一段時間的活動，預設選今天或下一場 */
function eventOptions_(d) {
  const today = todayIso_();
  const events = listEvents_(addDays(today, -Number(d.pastDays || 56)), addDays(today, Number(d.futureDays || 70)));
  const now = nowTime_();
  const next = events.filter(function (e) { return !e.cancelled && (e.date === today || isUpcoming_(e, today, now)); })[0];
  return { events: events, defaultId: next ? next.id : (events.length ? events[events.length - 1].id : ''), today: today };
}

// ---------- 管理 ----------

function eventFields_(d) {
  const type = EVENT_TYPES.indexOf(d.type) >= 0 ? d.type : '其他';
  const date = parseDateLoose(d.date);
  if (!date) throw new Error('請選擇活動日期');
  const name = cleanText_(d.name, 40) || type;
  const startTime = normalizeTime(d.startTime);
  const endTime = normalizeTime(d.endTime);
  if (startTime && endTime && endTime < startTime) throw new Error('結束時間不能早於開始時間');
  const fee = String(d.fee == null ? '' : d.fee).trim();
  const capacity = String(d.capacity == null ? '' : d.capacity).trim();
  if (fee && !(toNumber(fee) >= 0 && /^\d+(\.\d+)?$/.test(fee))) throw new Error('費用請填數字');
  if (capacity && !/^\d+$/.test(capacity)) throw new Error('名額請填整數');
  return {
    type: type, name: name, date: date, startTime: startTime, endTime: endTime,
    place: cleanText_(d.place, 80), openRegistration: d.openRegistration ? '是' : '否',
    fee: fee, capacity: capacity, description: cleanText_(d.description, 500)
  };
}

/** 新增或修改活動；例會（MTG- 開頭）只能改時間、地點、說明等，日期固定 */
function saveEvent_(d, ctx) {
  const stamp = nowStamp_();
  return withLock_(function () {
    const t = Db.read(sheetDefs_().events);
    if (isMeetingId_(d.id)) {
      const date = meetingDateFor_(d.id, t.rows, getSettings_());
      const f = eventFields_(Object.assign({}, d, { type: '例會', date: date }));
      const patch = {
        type: '例會', name: f.name === '例會' ? '' : f.name, date: date, startTime: f.startTime, endTime: f.endTime,
        place: f.place, openRegistration: d.openRegistration === undefined ? '' : f.openRegistration,
        fee: f.fee, capacity: f.capacity, description: f.description, updatedAt: stamp
      };
      const existing = t.rows.filter(function (r) { return r.id === d.id; })[0];
      if (existing) Db.update(t, existing._row, patch);
      else Db.append(t, [Object.assign({ id: d.id, status: EVENT_NORMAL, createdBy: ctx.account.displayName, createdAt: stamp }, patch)]);
      return getEvent_(d.id);
    }
    const fields = eventFields_(d);
    if (d.id) {
      const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
      if (!row) throw new Error('找不到這場活動，可能已被刪除');
      Db.update(t, row._row, Object.assign({ updatedAt: stamp }, fields));
      return getEvent_(d.id);
    }
    const created = Object.assign({ id: newId_('E'), status: EVENT_NORMAL, createdBy: ctx.account.displayName, createdAt: stamp, updatedAt: stamp }, fields);
    Db.append(t, [created]);
    return getEvent_(created.id);
  });
}

/** 停會／恢復 */
function setEventStatus_(d, ctx) {
  const status = d.cancelled ? EVENT_CANCELLED : EVENT_NORMAL;
  const stamp = nowStamp_();
  return withLock_(function () {
    const t = Db.read(sheetDefs_().events);
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (row) {
      Db.update(t, row._row, { status: status, updatedAt: stamp });
    } else if (isMeetingId_(d.id)) {
      const date = meetingDateFor_(d.id, t.rows, getSettings_());
      Db.append(t, [{ id: d.id, type: '例會', date: date, status: status, createdBy: ctx.account.displayName, createdAt: stamp, updatedAt: stamp }]);
    } else {
      throw new Error('找不到這場活動，可能已被刪除');
    }
    return getEvent_(d.id);
  });
}

/** 刪除活動（軟刪除）；每週例會不能刪，只能停會 */
function deleteEvent_(d) {
  if (isMeetingId_(d.id)) throw new Error('每週例會不能刪除，請改用「停會」');
  return withLock_(function () {
    const t = Db.read(sheetDefs_().events);
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這場活動，可能已被刪除');
    Db.softDelete(t, row._row);
    return true;
  });
}

// ---------- 活動管理頁、報名儀表板 ----------

/** 活動管理頁：預設今天起 120 天，past 為 true 時多看過去 60 天 */
function eventsPage_(d, ctx) {
  const today = todayIso_();
  const canSeeRegs = hasPermission(ctx.perms, 'guests.registration.view');
  const counts = canSeeRegs ? registrationCounts_() : {};
  const events = listEvents_(d.past ? addDays(today, -60) : today, addDays(today, 120));
  return {
    today: today,
    events: events.map(function (e) {
      return Object.assign({}, e, { counts: canSeeRegs ? (counts[e.id] || emptyCounts_()) : null });
    })
  };
}

/** 報名儀表板：未來四週各場報名、邀請排行榜（近 90 天）、本月來賓、最新報名 */
function registrationDashboard_() {
  const today = todayIso_();
  const now = nowTime_();
  const regs = registrationsTable_().rows;
  const counts = registrationCounts_();
  const upcoming = listEvents_(today, addDays(today, 28))
    .filter(function (e) { return !e.cancelled && (e.isMeeting || e.openRegistration) && isUpcoming_(e, today, now); })
    .map(function (e) { return Object.assign({}, e, { counts: counts[e.id] || emptyCounts_() }); });

  const from = addDays(today, -90);
  const board = {};
  regs.forEach(function (r) {
    if ((r.role || ROLE_GUEST) !== ROLE_GUEST || !r.inviter || r.eventDate < from || r.eventDate > today) return;
    const b = board[r.inviter] || (board[r.inviter] = { name: r.inviter, invited: 0, attended: 0 });
    b.invited += 1;
    if (r.checkedInAt) b.attended += 1;
  });
  const leaderboard = Object.keys(board).map(function (k) { return board[k]; }).sort(function (a, b) {
    return b.attended - a.attended || b.invited - a.invited;
  }).slice(0, 15);

  const monthStart = today.slice(0, 8) + '01';
  const monthGuests = regs.filter(function (r) {
    return (r.role || ROLE_GUEST) === ROLE_GUEST && r.eventDate >= monthStart && r.eventDate <= today;
  });

  const recent = regs.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; }).slice(0, 10);
  const names = {};
  if (recent.length) {
    const dates = recent.map(function (r) { return r.eventDate; }).filter(Boolean).sort();
    if (dates.length) listEvents_(dates[0], dates[dates.length - 1]).forEach(function (e) { names[e.id] = e.name; });
  }
  return {
    today: today,
    upcoming: upcoming,
    leaderboard: leaderboard,
    month: { guests: monthGuests.length, attended: monthGuests.filter(function (r) { return r.checkedInAt; }).length },
    recent: recent.map(function (r) {
      return {
        name: r.name, role: r.role || ROLE_GUEST, eventId: r.eventId, eventDate: r.eventDate, eventName: names[r.eventId] || '',
        inviter: r.inviter, source: r.source, createdAt: r.createdAt
      };
    })
  };
}
