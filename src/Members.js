/**
 * 會員名冊：可以在系統裡新增、編輯，也可以直接在試算表「會員名單」維護。
 * - 會員ID 留空會自動補上（M001、M002…）。
 * - 狀態填「離會」「停權」「休會」等字樣的會員，不會出現在簽到與列印。
 * - 刪除是軟刪除（已刪除欄標「是」）。
 */

const MEMBER_STATUSES = ['在籍', '休會', '離會'];

function formatMemberId_(seq) {
  return 'M' + String(seq).padStart(3, '0');
}

function maxMemberSeq_(rows) {
  return rows.reduce(function (max, r) {
    const m = /^M(\d+)$/i.exec(String(r.id || ''));
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

/** 沒有 ID、或 ID 重複（複製貼上整列）的會員 */
function rowsNeedingId_(rows) {
  const seen = {};
  return rows.filter(function (r) {
    if (!r.name) return false;
    if (!r.id || seen[r.id]) return true;
    seen[r.id] = true;
    return false;
  });
}

function memberOut_(r) {
  return {
    id: r.id, name: r.name, company: r.company, category: r.category, industryGroup: r.industryGroup,
    position: r.position, phone: r.phone, email: r.email, lineId: r.lineId,
    joinDate: parseDateLoose(r.joinDate), expiryDate: parseDateLoose(r.expiryDate), sponsor: r.sponsor,
    status: r.status || '在籍', note: r.note, active: isActiveMember(r.status)
  };
}

function membersTable_() {
  const def = sheetDefs_().members;
  const table = Db.read(def, { includeDeleted: true });
  if (!rowsNeedingId_(table.rows).length) return Db.read(def);
  return withLock_(function () {
    const t = Db.read(def, { includeDeleted: true });
    let seq = maxMemberSeq_(t.rows);
    rowsNeedingId_(t.rows).forEach(function (r) {
      seq += 1;
      Db.update(t, r._row, { id: formatMemberId_(seq) });
    });
    return Db.read(def);
  });
}

function listMembers_(includeInactive) {
  return membersTable_().rows
    .filter(function (r) { return r.name && (includeInactive || isActiveMember(r.status)); })
    .map(memberOut_);
}

function memberFields_(d) {
  const name = cleanText_(d.name, 40);
  if (!name) throw new Error('請填寫會員姓名');
  const dates = {};
  ['joinDate', 'expiryDate'].forEach(function (k) {
    const raw = String(d[k] == null ? '' : d[k]).trim();
    dates[k] = raw ? parseDateLoose(raw) : '';
    if (raw && !dates[k]) throw new Error((k === 'joinDate' ? '入會日' : '到期日') + '格式不正確');
  });
  return {
    name: name, company: cleanText_(d.company, 80), category: cleanText_(d.category, 60),
    industryGroup: cleanText_(d.industryGroup, 30), position: cleanText_(d.position, 30),
    phone: cleanText_(d.phone, 30), email: cleanText_(d.email, 100), lineId: cleanText_(d.lineId, 50),
    joinDate: dates.joinDate, expiryDate: dates.expiryDate, sponsor: cleanText_(d.sponsor, 40),
    status: cleanText_(d.status, 10) || '在籍', note: cleanText_(d.note, 300)
  };
}

function saveMember_(d) {
  const fields = memberFields_(d);
  return withLock_(function () {
    const t = Db.read(sheetDefs_().members);
    const sameName = t.rows.filter(function (r) { return nameKey(r.name) === nameKey(fields.name) && r.id !== d.id; })[0];
    if (sameName) throw new Error('名冊裡已經有「' + fields.name + '」');
    if (d.id) {
      const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
      if (!row) throw new Error('找不到這位會員，請重新整理');
      Db.update(t, row._row, fields);
      return memberOut_(Object.assign({}, row, fields));
    }
    const all = Db.read(sheetDefs_().members, { includeDeleted: true }).rows;
    const created = Object.assign({ id: formatMemberId_(maxMemberSeq_(all) + 1), deleted: '' }, fields);
    Db.append(t, [created]);
    return memberOut_(created);
  });
}

function deleteMember_(d) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().members);
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這位會員，請重新整理');
    Db.softDelete(t, row._row);
    return true;
  });
}

/** 在籍會員中，會籍在 days 天內到期（或已過期）的人，依到期日排序 */
function expiringMembers_(today, days) {
  const limit = addDays(today, days);
  return listMembers_(false)
    .filter(function (m) { return m.expiryDate && m.expiryDate <= limit; })
    .map(function (m) {
      const daysLeft = Math.round((Date.parse(m.expiryDate + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
      return { id: m.id, name: m.name, category: m.category, expiryDate: m.expiryDate, daysLeft: daysLeft };
    })
    .sort(function (a, b) { return a.daysLeft - b.daysLeft; });
}

/** 匯入 PALMS 時把名單上沒有的姓名加進會員名冊，回傳新增的姓名 */
function syncMembersByNames_(names) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().members);
    const all = Db.read(sheetDefs_().members, { includeDeleted: true }).rows;
    const known = {};
    t.rows.forEach(function (r) { known[nameKey(r.name)] = true; });
    let seq = maxMemberSeq_(all);
    const added = [];
    names.forEach(function (name) {
      const key = nameKey(name);
      if (!key || known[key]) return;
      known[key] = true;
      seq += 1;
      added.push({ id: formatMemberId_(seq), name: String(name).trim(), status: '在籍', deleted: '' });
    });
    Db.append(t, added);
    return added.map(function (m) { return m.name; });
  });
}
