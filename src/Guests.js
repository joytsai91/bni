/**
 * 報名名單：每場活動（含每週例會）的報名資料。
 * - 例會：報名的是來賓；會員出席另外記在「會員出席」。
 * - 其他活動（共識會議、培訓、聯誼…）：來賓、會員都可以報名。
 * - 來源：報名（公開報名頁）、代登（幹部代為登記）、現場（現場簽到）。
 * - 刪除是軟刪除。
 */

const ROLE_GUEST = '來賓';
const ROLE_MEMBER = '會員';

function cleanText_(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function digitsOnly_(s) {
  return String(s || '').replace(/\D/g, '');
}

function regFields_(d) {
  return {
    name: cleanText_(d.name, 40),
    company: cleanText_(d.company, 80),
    category: cleanText_(d.category, 60),
    phone: cleanText_(d.phone, 30),
    email: cleanText_(d.email, 100),
    inviter: cleanText_(d.inviter, 40),
    note: cleanText_(d.note, 200)
  };
}

function regOut_(r) {
  return {
    id: r.id, eventId: r.eventId, eventDate: r.eventDate, role: r.role || ROLE_GUEST, memberId: r.memberId,
    name: r.name, company: r.company, category: r.category, phone: r.phone, email: r.email,
    inviter: r.inviter, source: r.source, checkedInAt: r.checkedInAt, paid: !!r.paid,
    paidAmount: toNumber(r.paidAmount), note: r.note, createdAt: r.createdAt
  };
}

function registrationsTable_() {
  return Db.read(sheetDefs_().registrations);
}

function listRegistrations_(eventId) {
  return registrationsTable_().rows
    .filter(function (r) { return r.eventId === eventId && r.name; })
    .map(regOut_);
}

/** 各活動的報名統計（整張表只讀一次） */
function registrationCounts_() {
  const counts = {};
  registrationsTable_().rows.forEach(function (r) {
    const c = counts[r.eventId] || (counts[r.eventId] = { total: 0, guests: 0, members: 0, paid: 0, checkedIn: 0 });
    c.total += 1;
    if ((r.role || ROLE_GUEST) === ROLE_MEMBER) c.members += 1;
    else c.guests += 1;
    if (r.paid) c.paid += 1;
    if (r.checkedInAt) c.checkedIn += 1;
  });
  return counts;
}

/** 同一場活動：同一位會員，或同名且電話不衝突的來賓，視為重複報名 */
function findDuplicateRegistration_(rows, eventId, g, memberId) {
  return rows.filter(function (r) {
    if (r.eventId !== eventId) return false;
    if (memberId) return r.memberId === memberId;
    if (r.memberId || nameKey(r.name) !== nameKey(g.name)) return false;
    return !g.phone || !r.phone || digitsOnly_(r.phone) === digitsOnly_(g.phone);
  })[0];
}

/** opts: { source, checkIn, role, memberId, ignoreCapacity } */
function addRegistration_(event, data, opts) {
  let g = regFields_(data);
  const role = opts.role === ROLE_MEMBER ? ROLE_MEMBER : ROLE_GUEST;
  let memberId = '';
  if (role === ROLE_MEMBER) {
    if (event.isMeeting) throw new Error('例會的會員出席請到「簽到」記錄');
    const m = listMembers_(false).filter(function (x) { return x.id === opts.memberId; })[0];
    if (!m) throw new Error('請選擇會員');
    memberId = m.id;
    g = Object.assign(g, { name: m.name, company: m.company, category: m.category, phone: m.phone, email: m.email });
  }
  if (!g.name) throw new Error('請填寫姓名');
  return withLock_(function () {
    const t = registrationsTable_();
    const dup = findDuplicateRegistration_(t.rows, event.id, g, memberId);
    if (dup) {
      if (opts.checkIn && !dup.checkedInAt) applyRegistrationChanges_(t, dup, { checkedInAt: nowStamp_() }, opts.ctx);
      return { registration: regOut_(dup), duplicate: true };
    }
    if (event.capacity > 0 && !opts.ignoreCapacity) {
      const taken = t.rows.filter(function (r) { return r.eventId === event.id; }).length;
      if (taken >= event.capacity) throw new Error('這場活動名額已滿');
    }
    const row = Object.assign({
      id: newId_('G'), eventId: event.id, eventDate: event.date, role: role, memberId: memberId, source: opts.source,
      checkedInAt: '', paid: '', paidAmount: 0, ledgerId: '', createdAt: nowStamp_(), deleted: ''
    }, g);
    Db.append(t, [row]);
    const created = t.rows.filter(function (r) { return r.id === row.id; })[0];
    const changes = {};
    if (opts.checkIn) changes.checkedInAt = nowStamp_();
    if (data.paid) Object.assign(changes, paymentChanges_(created, true, opts.ctx));
    if (Object.keys(changes).length) applyRegistrationChanges_(t, created, changes, opts.ctx);
    return { registration: regOut_(created), duplicate: false };
  });
}

/** 公開報名頁送出 */
function registerPublic_(d) {
  if (d.website) throw new Error('送出失敗，請重新整理後再試'); // 防機器人欄位，真人看不到
  throttle_('guest_register', 30, 60);
  const event = getEvent_(d.eventId);
  const today = todayIso_();
  if (event.cancelled) throw new Error('這場活動已取消');
  if (!event.openRegistration) throw new Error('這場活動沒有開放報名');
  if (!isUpcoming_(event, today, nowTime_()) || event.date > addDays(today, 120)) throw new Error('這場活動目前不開放報名');
  const role = d.role === ROLE_MEMBER && !event.isMeeting ? ROLE_MEMBER : ROLE_GUEST;
  if (role === ROLE_GUEST && !cleanText_(d.category, 60)) throw new Error('請填寫行業／專業別');
  return addRegistration_(event, d, { source: '報名', role: role, memberId: d.memberId });
}

/** 幹部代為登記（不簽到） */
function addRegistrationByAdmin_(d, ctx) {
  return addRegistration_(getEvent_(d.eventId), d, { source: '代登', role: d.role, memberId: d.memberId, ignoreCapacity: true, ctx: ctx });
}

/** 現場來賓：新增並直接簽到 */
function addWalkin_(d, ctx) {
  return addRegistration_(getEvent_(d.eventId), d, { source: '現場', role: d.role, memberId: d.memberId, checkIn: true, ignoreCapacity: true, ctx: ctx });
}

/** 繳費／取消繳費要改的欄位（財務中心會在這裡接上自動入帳） */
function paymentChanges_(row, paid, ctx) {
  if (paid === !!row.paid) return {};
  if (!paid) return { paid: '', paidAmount: 0 };
  return { paid: '是', paidAmount: getEvent_(row.eventId).fee || 0 };
}

/** 寫入變更，並觸發簽到後的連動（例如來賓追蹤） */
function applyRegistrationChanges_(table, row, changes, ctx) {
  if (!Object.keys(changes).length) return;
  Db.update(table, row._row, changes);
  afterRegistrationChange_(row, changes, ctx);
}

/** 報名資料變更後的連動：來賓簽到／取消簽到 → 評議與追蹤的來訪紀錄 */
function afterRegistrationChange_(row, changes, ctx) {
  if (Object.prototype.hasOwnProperty.call(changes, 'checkedInAt') && (row.role || ROLE_GUEST) === ROLE_GUEST) {
    syncLeadVisit_(row, !!changes.checkedInAt);
  }
}

function updateRegistration_(d, ctx) {
  const patch = d.patch || {};
  const has = function (k) { return Object.prototype.hasOwnProperty.call(patch, k); };
  return withLock_(function () {
    const t = registrationsTable_();
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這筆報名，請重新整理');
    const changes = {};
    if (has('checkedIn')) changes.checkedInAt = patch.checkedIn ? (row.checkedInAt || nowStamp_()) : '';
    if (has('paid')) Object.assign(changes, paymentChanges_(row, !!patch.paid, ctx));
    const fields = regFields_(patch);
    const editable = (row.role || ROLE_GUEST) === ROLE_MEMBER ? ['note'] : Object.keys(fields);
    editable.forEach(function (k) { if (has(k)) changes[k] = fields[k]; });
    if (has('name') && editable.indexOf('name') >= 0 && !changes.name) throw new Error('姓名不能空白');
    applyRegistrationChanges_(t, row, changes, ctx);
    return regOut_(row);
  });
}

function deleteRegistration_(d, ctx) {
  return withLock_(function () {
    const t = registrationsTable_();
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這筆報名，請重新整理');
    if (row.paid) applyRegistrationChanges_(t, row, paymentChanges_(row, false, ctx), ctx);
    if (row.checkedInAt) applyRegistrationChanges_(t, row, { checkedInAt: '' }, ctx);
    Db.softDelete(t, row._row);
    return true;
  });
}
