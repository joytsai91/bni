/**
 * PALMS：上傳 BNI Connect 匯出的報表 → 預覽 → 存進「PALMS」工作表 → 統計與 LINE 週報。
 * 每一期（起訖日期）一批資料；同一期重新匯入會覆蓋舊資料。
 */

function sanitizeRows_(rows) {
  if (!Array.isArray(rows)) throw new Error('讀不到報表內容');
  return rows.slice(0, 2000).map(function (row) {
    return (Array.isArray(row) ? row : []).slice(0, 60).map(function (cell) {
      return cell == null ? '' : String(cell).slice(0, 200);
    });
  });
}

function previewPalms_(d) {
  const parsed = parsePalms(sanitizeRows_(d.rows), d.fileName);
  const known = {};
  listMembers_(true).forEach(function (m) { known[nameKey(m.name)] = true; });
  parsed.newNames = parsed.members
    .filter(function (m) { return !known[nameKey(m.name)]; })
    .map(function (m) { return m.name; });
  return parsed;
}

function requirePeriod_(d) {
  const from = parseDateLoose(d.from);
  const to = parseDateLoose(d.to);
  if (!from || !to) throw new Error('請填寫 PALMS 期間（起訖日期）');
  if (from > to) throw new Error('起始日期不能晚於結束日期');
  return { from: from, to: to };
}

function savePalms_(d) {
  const parsed = parsePalms(sanitizeRows_(d.rows), d.fileName);
  const period = requirePeriod_(d);
  const stamp = nowStamp_();
  const replaced = withLock_(function () {
    const t = Db.read(sheetDefs_().palms);
    const old = t.rows
      .filter(function (r) { return r.from === period.from && r.to === period.to; })
      .map(function (r) { return r._row; });
    old.forEach(function (rowNum) { Db.softDelete(t, rowNum); }); // 舊資料標記已刪除，保留在試算表
    Db.append(t, parsed.members.map(function (m) {
      const rec = { from: period.from, to: period.to, importedAt: stamp };
      Object.keys(m).forEach(function (k) { rec[k] = m[k]; });
      return rec;
    }));
    return old.length > 0;
  });
  const addedMembers = d.syncMembers === false ? [] : syncMembersByNames_(parsed.members.map(function (m) { return m.name; }));
  return {
    from: period.from, to: period.to, count: parsed.members.length,
    replaced: replaced, addedMembers: addedMembers
  };
}

function palmsRecords_() {
  return Db.read(sheetDefs_().palms).rows.filter(function (r) { return r.from && r.to && r.name; });
}

/** 已匯入的期間（新到舊），附各期合計 */
function listPalmsPeriods_() {
  const groups = {};
  palmsRecords_().forEach(function (r) {
    const key = r.from + '|' + r.to;
    if (!groups[key]) groups[key] = { from: r.from, to: r.to, importedAt: r.importedAt, records: [] };
    groups[key].records.push(r);
  });
  return Object.keys(groups).sort().reverse().map(function (key) {
    const g = groups[key];
    const s = summarizePalms(g.records, 0);
    return { from: g.from, to: g.to, importedAt: g.importedAt, count: s.members.length, totals: s.totals };
  });
}

/** 期間完全落在 from～to 之內的資料，依會員加總 */
function palmsSummary_(d) {
  const period = requirePeriod_(d);
  const records = palmsRecords_().filter(function (r) {
    return r.from >= period.from && r.to <= period.to;
  });
  const settings = getSettings_();
  const summary = summarizePalms(records, settings.absenceAlert);
  summary.from = period.from;
  summary.to = period.to;
  summary.absenceAlert = settings.absenceAlert;
  return summary;
}

function palmsLineText_(d) {
  const summary = palmsSummary_(d);
  if (!summary.members.length) throw new Error('這段期間沒有 PALMS 資料');
  return buildPalmsLineText(getSettings_().chapterName, summary.from, summary.to, summary);
}

function deletePalmsPeriod_(d) {
  const period = requirePeriod_(d);
  return withLock_(function () {
    const t = Db.read(sheetDefs_().palms);
    const rows = t.rows
      .filter(function (r) { return r.from === period.from && r.to === period.to; })
      .map(function (r) { return r._row; });
    rows.forEach(function (rowNum) { Db.softDelete(t, rowNum); });
    return { count: rows.length };
  });
}
