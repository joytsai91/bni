/**
 * 產業分析：
 * - 在籍會員依產業群組分布。
 * - 重複專業別：BNI 一個專業別只收一位會員，同業或可能同業的會員兩兩列出。
 * - 招募目標：分會想找的專業別；已有會員就算補齊，沒有就是缺口，並從追蹤中的來賓找可能人選。
 * - 來賓檢查：近期來賓與追蹤中的來賓，是否與會員撞行業、是否補到缺口。
 */

function targetOut_(r) {
  return {
    id: r.id, category: r.category, industryGroup: r.industryGroup,
    priority: TARGET_PRIORITIES.indexOf(r.priority) >= 0 ? r.priority : '中', note: r.note
  };
}

function industryAnalysis_() {
  const today = todayIso_();
  const members = listMembers_(false);
  const groups = {};
  members.forEach(function (m) {
    const g = m.industryGroup || '未分類';
    (groups[g] = groups[g] || []).push({ name: m.name, category: m.category });
  });
  const groupList = Object.keys(groups).map(function (g) { return { group: g, members: groups[g] }; }).sort(function (a, b) {
    if (a.group === '未分類') return 1;
    if (b.group === '未分類') return -1;
    return b.members.length - a.members.length;
  });

  const duplicates = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (categoriesConflict(members[i].category, members[j].category)) {
        duplicates.push({
          a: { name: members[i].name, category: members[i].category },
          b: { name: members[j].name, category: members[j].category }
        });
      }
    }
  }

  const leads = leadsTable_().rows.map(function (r) { return leadOut_(r, today); }).filter(function (l) { return l.active; });
  const targets = Db.read(sheetDefs_().targets).rows.map(targetOut_).map(function (t) {
    const filledBy = members.filter(function (m) { return categoriesConflict(m.category, t.category); }).map(function (m) { return m.name; });
    const candidates = leads.filter(function (l) { return categoriesConflict(l.category, t.category); }).map(function (l) {
      return { name: l.name, stage: l.stage };
    });
    return Object.assign(t, { filled: filledBy.length > 0, filledBy: filledBy, candidates: candidates });
  }).sort(function (a, b) {
    if (a.filled !== b.filled) return a.filled ? 1 : -1;
    return TARGET_PRIORITIES.indexOf(a.priority) - TARGET_PRIORITIES.indexOf(b.priority);
  });
  const gaps = targets.filter(function (t) { return !t.filled; });

  // 近期來賓（未來四週的報名）＋追蹤中的來賓，同一人只列一次
  const prospects = [];
  const memberKeys = {};
  members.forEach(function (m) { memberKeys[nameKey(m.name)] = true; });
  const pushProspect = function (p, source) {
    if (memberKeys[nameKey(p.name)]) return; // 已經是會員（例如剛轉為會員）就不是來賓了
    if (prospects.some(function (x) { return samePerson_(x, p); })) return;
    const conflicts = sameCategoryMembers_(p.category, members);
    const gap = gaps.filter(function (t) { return categoriesConflict(t.category, p.category); })[0];
    prospects.push({
      name: p.name, phone: p.phone, company: p.company, category: p.category, source: source,
      status: conflicts.length ? 'conflict' : gap ? 'gap' : 'open',
      conflicts: conflicts, gap: gap ? gap.category : ''
    });
  };
  const upcoming = {};
  listEvents_(today, addDays(today, 28)).forEach(function (e) { upcoming[e.id] = e; });
  registrationsTable_().rows.forEach(function (r) {
    const e = upcoming[r.eventId];
    if (e && (r.role || ROLE_GUEST) === ROLE_GUEST) pushProspect(r, eventShortLabel_(e));
  });
  leads.forEach(function (l) { pushProspect(l, '追蹤：' + l.stage); });

  return {
    memberCount: members.length,
    groups: groupList,
    duplicates: duplicates,
    targets: targets,
    gapCount: gaps.length,
    prospects: prospects.map(function (p) {
      return { name: p.name, company: p.company, category: p.category, source: p.source, status: p.status, conflicts: p.conflicts, gap: p.gap };
    })
  };
}

/** 來賓檢查的來源文字，例如「10/8 例會」 */
function eventShortLabel_(e) {
  return Number(e.date.slice(5, 7)) + '/' + Number(e.date.slice(8)) + ' ' + e.name;
}

function saveTarget_(d) {
  const category = cleanText_(d.category, 60);
  if (!category) throw new Error('請填寫專業別');
  const fields = {
    category: category, industryGroup: cleanText_(d.industryGroup, 30),
    priority: TARGET_PRIORITIES.indexOf(d.priority) >= 0 ? d.priority : '中', note: cleanText_(d.note, 200)
  };
  return withLock_(function () {
    const t = Db.read(sheetDefs_().targets);
    const dup = t.rows.filter(function (r) { return categoryKey(r.category) === categoryKey(category) && r.id !== d.id; })[0];
    if (dup) throw new Error('招募目標已經有「' + dup.category + '」');
    if (d.id) {
      const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
      if (!row) throw new Error('找不到這個招募目標，請重新整理');
      Db.update(t, row._row, fields);
      return targetOut_(row);
    }
    const created = Object.assign({ id: newId_('T'), deleted: '' }, fields);
    Db.append(t, [created]);
    return targetOut_(created);
  });
}

function deleteTarget_(d) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().targets);
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這個招募目標，請重新整理');
    Db.softDelete(t, row._row);
    return true;
  });
}
