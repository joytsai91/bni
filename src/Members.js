/**
 * 會員名單：直接在試算表「會員名單」維護；會員ID 留空會自動補上（M001、M002…）。
 * 狀態欄填「離會」「停權」「休會」等字樣的會員，不會出現在簽到與列印。
 */

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

function listMembers_(includeInactive) {
  const def = sheetDefs_().members;
  let table = Db.read(def);
  if (rowsNeedingId_(table.rows).length) {
    table = withLock_(function () {
      const t = Db.read(def);
      let seq = maxMemberSeq_(t.rows);
      rowsNeedingId_(t.rows).forEach(function (r) {
        seq += 1;
        r.id = formatMemberId_(seq);
        Db.update(t, r._row, { id: r.id });
      });
      return t;
    });
  }
  return table.rows
    .filter(function (r) { return r.name && (includeInactive || isActiveMember(r.status)); })
    .map(function (r) {
      return {
        id: r.id, name: r.name, company: r.company, category: r.category,
        phone: r.phone, email: r.email, status: r.status
      };
    });
}

/** 匯入 PALMS 時把名單上沒有的姓名加進會員名單，回傳新增的姓名 */
function syncMembersByNames_(names) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().members);
    const known = {};
    t.rows.forEach(function (r) { known[nameKey(r.name)] = true; });
    let seq = maxMemberSeq_(t.rows);
    const added = [];
    names.forEach(function (name) {
      const key = nameKey(name);
      if (!key || known[key]) return;
      known[key] = true;
      seq += 1;
      added.push({ id: formatMemberId_(seq), name: String(name).trim() });
    });
    Db.append(t, added);
    return added.map(function (m) { return m.name; });
  });
}
