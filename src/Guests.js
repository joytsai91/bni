/**
 * 來賓：公開報名表單、現場來賓、簽到與繳費。
 */

function cleanText_(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function guestFields_(d) {
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

function guestOut_(r) {
  return {
    id: r.id, date: r.date, name: r.name, company: r.company, category: r.category,
    phone: r.phone, email: r.email, inviter: r.inviter, source: r.source,
    checkedInAt: r.checkedInAt, paid: !!r.paid, note: r.note, createdAt: r.createdAt
  };
}

function digitsOnly_(s) {
  return String(s || '').replace(/\D/g, '');
}

/** 同一場例會、同名且電話不衝突，視為重複報名 */
function findDuplicateGuest_(rows, date, g) {
  return rows.filter(function (r) {
    if (r.date !== date || nameKey(r.name) !== nameKey(g.name)) return false;
    return !g.phone || !r.phone || digitsOnly_(r.phone) === digitsOnly_(g.phone);
  })[0];
}

function addGuest_(data, date, source, checkIn) {
  const g = guestFields_(data);
  if (!g.name) throw new Error('請填寫來賓姓名');
  return withLock_(function () {
    const t = Db.read(sheetDefs_().guests);
    const dup = findDuplicateGuest_(t.rows, date, g);
    if (dup) {
      if (checkIn && !dup.checkedInAt) {
        dup.checkedInAt = nowStamp_();
        Db.update(t, dup._row, { checkedInAt: dup.checkedInAt });
      }
      return { guest: guestOut_(dup), duplicate: true };
    }
    const row = {
      id: 'G' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
      date: date,
      source: source,
      checkedInAt: checkIn ? nowStamp_() : '',
      paid: data.paid ? '是' : '',
      createdAt: nowStamp_()
    };
    Object.keys(g).forEach(function (k) { row[k] = g[k]; });
    Db.append(t, [row]);
    return { guest: guestOut_(row), duplicate: false };
  });
}

/** 公開報名頁送出 */
function registerGuestPublic_(d) {
  if (d.website) throw new Error('送出失敗，請重新整理後再試'); // 防機器人欄位，真人看不到
  throttle_('guest_register', 30, 60);
  const date = parseDateLoose(d.date);
  const today = todayIso_();
  if (!date || date < addDays(today, -1) || date > addDays(today, 120)) throw new Error('請選擇正確的例會日期');
  if (!cleanText_(d.category, 60)) throw new Error('請填寫行業／專業別');
  return addGuest_(d, date, '報名', false);
}

function addWalkinGuest_(d) {
  return addGuest_(d, requireDate_(d.date), '現場', true);
}

/** 秘書收到來賓資料後代為登記（不簽到） */
function addGuestByAdmin_(d) {
  return addGuest_(d, requireDate_(d.date), '代登', false);
}

function listGuests_(date) {
  date = requireDate_(date);
  return Db.read(sheetDefs_().guests).rows
    .filter(function (r) { return r.date === date && r.name; })
    .map(guestOut_);
}

function updateGuest_(id, patch) {
  patch = patch || {};
  return withLock_(function () {
    const t = Db.read(sheetDefs_().guests);
    const row = t.rows.filter(function (r) { return r.id === id; })[0];
    if (!row) throw new Error('找不到這位來賓，請重新整理');
    const changes = {};
    if (Object.prototype.hasOwnProperty.call(patch, 'checkedIn')) {
      changes.checkedInAt = patch.checkedIn ? (row.checkedInAt || nowStamp_()) : '';
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'paid')) changes.paid = patch.paid ? '是' : '';
    const fields = guestFields_(patch);
    Object.keys(fields).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) changes[k] = fields[k];
    });
    if (Object.prototype.hasOwnProperty.call(changes, 'name') && !changes.name) throw new Error('來賓姓名不能空白');
    Db.update(t, row._row, changes);
    Object.keys(changes).forEach(function (k) { row[k] = changes[k]; });
    return guestOut_(row);
  });
}

function deleteGuest_(id) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().guests);
    const row = t.rows.filter(function (r) { return r.id === id; })[0];
    if (!row) throw new Error('找不到這位來賓，請重新整理');
    Db.deleteRows(t, [row._row]);
    return true;
  });
}
