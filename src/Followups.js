/**
 * 評議與追蹤：來賓從第一次來訪到入會的追蹤。
 * - 來賓在任何活動簽到時，自動建立（或更新）追蹤：同名且電話不衝突視為同一人，記錄來訪次數。
 * - 階段：新來賓 → 已聯繫 → 有意願 → 申請中 → 已入會／暫不考慮；改階段會自動留下一筆追蹤紀錄。
 * - 負責人預設是邀請人；「我的追蹤」以帳號對應的會員姓名或顯示名稱比對負責人。
 * - 刪除是軟刪除。
 */

function leadsTable_() {
  return Db.read(sheetDefs_().leads);
}

function leadOut_(r, today) {
  const stage = LEAD_STAGES.indexOf(r.stage) >= 0 ? r.stage : LEAD_STAGES[0];
  return {
    id: r.id, name: r.name, company: r.company, category: r.category, phone: r.phone, email: r.email,
    inviter: r.inviter, firstVisit: r.firstVisit, lastVisit: r.lastVisit, visits: toNumber(r.visits),
    stage: stage, active: LEAD_ACTIVE_STAGES.indexOf(stage) >= 0, owner: r.owner, nextDate: parseDateLoose(r.nextDate),
    overdue: !!(today && r.nextDate && parseDateLoose(r.nextDate) <= today && LEAD_ACTIVE_STAGES.indexOf(stage) >= 0),
    latest: r.latest, memberId: r.memberId, createdAt: r.createdAt, updatedAt: r.updatedAt
  };
}

function samePerson_(a, b) {
  if (nameKey(a.name) !== nameKey(b.name)) return false;
  return !a.phone || !b.phone || digitsOnly_(a.phone) === digitsOnly_(b.phone);
}

function appendLeadLog_(leadId, stage, content, by) {
  const t = Db.read(sheetDefs_().leadLogs);
  Db.append(t, [{ id: newId_('F'), leadId: leadId, at: nowStamp_(), by: by || '系統', stage: stage, content: content, deleted: '' }]);
}

// ---------- 簽到連動 ----------

/** 來賓簽到：建立追蹤或累計來訪；取消簽到：扣回這場來訪（只靠這場建立的新追蹤會一併刪除） */
function syncLeadVisit_(reg, checkedIn) {
  withLock_(function () {
    const t = leadsTable_();
    const lead = t.rows.filter(function (l) { return samePerson_(l, reg); })[0];
    const events = lead ? parseList(lead.visitEvents) : [];
    if (checkedIn) {
      if (!lead) {
        const stamp = nowStamp_();
        const row = {
          id: newId_('L'), name: reg.name, company: reg.company, category: reg.category, phone: reg.phone, email: reg.email,
          inviter: reg.inviter, firstVisit: reg.eventDate, lastVisit: reg.eventDate, visitEvents: reg.eventId, visits: 1,
          stage: LEAD_STAGES[0], owner: reg.inviter, nextDate: '', latest: '', memberId: '', createdAt: stamp, updatedAt: stamp, deleted: ''
        };
        Db.append(t, [row]);
        appendLeadLog_(row.id, row.stage, '第一次來訪：' + reg.eventDate, '系統');
        return;
      }
      if (events.indexOf(reg.eventId) >= 0) return;
      events.push(reg.eventId);
      const patch = {
        visitEvents: events.join(','), visits: events.length, updatedAt: nowStamp_(),
        lastVisit: reg.eventDate > (lead.lastVisit || '') ? reg.eventDate : lead.lastVisit,
        firstVisit: !lead.firstVisit || reg.eventDate < lead.firstVisit ? reg.eventDate : lead.firstVisit
      };
      ['company', 'category', 'phone', 'email', 'inviter'].forEach(function (k) { if (!lead[k] && reg[k]) patch[k] = reg[k]; });
      Db.update(t, lead._row, patch);
      appendLeadLog_(lead.id, lead.stage, '再次來訪：' + reg.eventDate + '（第 ' + events.length + ' 次）', '系統');
      return;
    }
    if (!lead || events.indexOf(reg.eventId) < 0) return;
    const left = events.filter(function (e) { return e !== reg.eventId; });
    if (!left.length && lead.stage === LEAD_STAGES[0]) {
      Db.softDelete(t, lead._row);
      return;
    }
    Db.update(t, lead._row, { visitEvents: left.join(','), visits: left.length, updatedAt: nowStamp_() });
  });
}

// ---------- 清單與明細 ----------

/** 帳號在追蹤裡的名字：對應會員的姓名，沒有對應就用顯示名稱 */
function ownerNameFor_(account) {
  if (account.memberId) {
    const m = listMembers_(true).filter(function (x) { return x.id === account.memberId; })[0];
    if (m) return m.name;
  }
  return account.displayName;
}

function listLeads_(d, ctx) {
  const today = todayIso_();
  const leads = leadsTable_().rows.map(function (r) { return leadOut_(r, today); }).sort(function (a, b) {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ka = a.nextDate || '9999';
    const kb = b.nextDate || '9999';
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
  const counts = {};
  LEAD_STAGES.forEach(function (s) { counts[s] = 0; });
  leads.forEach(function (l) { counts[l.stage] += 1; });
  return {
    today: today, stages: LEAD_STAGES, activeStages: LEAD_ACTIVE_STAGES, counts: counts, leads: leads,
    me: ownerNameFor_(ctx.account),
    owners: listMembers_(false).map(function (m) { return m.name; })
  };
}

function getLead_(d) {
  const lead = leadsTable_().rows.filter(function (r) { return r.id === d.id; })[0];
  if (!lead) throw new Error('找不到這筆追蹤，請重新整理');
  const logs = Db.read(sheetDefs_().leadLogs).rows.filter(function (r) { return r.leadId === lead.id; }).reverse();
  return {
    lead: leadOut_(lead, todayIso_()),
    logs: logs.map(function (r) { return { id: r.id, at: r.at, by: r.by, stage: r.stage, content: r.content }; })
  };
}

function leadFields_(d) {
  const name = cleanText_(d.name, 40);
  if (!name) throw new Error('請填寫姓名');
  return {
    name: name, company: cleanText_(d.company, 80), category: cleanText_(d.category, 60),
    phone: cleanText_(d.phone, 30), email: cleanText_(d.email, 100), inviter: cleanText_(d.inviter, 40)
  };
}

/** 新增追蹤（例如會員介紹、還沒來過的潛在會員） */
function createLead_(d, ctx) {
  const fields = leadFields_(d);
  return withLock_(function () {
    const t = leadsTable_();
    if (t.rows.some(function (l) { return samePerson_(l, fields); })) throw new Error('「' + fields.name + '」已經在追蹤名單裡');
    const stamp = nowStamp_();
    const row = Object.assign({
      id: newId_('L'), firstVisit: '', lastVisit: '', visitEvents: '', visits: 0, stage: LEAD_STAGES[0],
      owner: cleanText_(d.owner, 40) || fields.inviter, nextDate: parseDateLoose(d.nextDate), latest: '', memberId: '',
      createdAt: stamp, updatedAt: stamp, deleted: ''
    }, fields);
    Db.append(t, [row]);
    appendLeadLog_(row.id, row.stage, '建立追蹤', ctx.account.displayName);
    return leadOut_(row, todayIso_());
  });
}

/**
 * 更新追蹤：可同時改基本資料、階段、負責人、下次追蹤日，並新增一筆追蹤紀錄（note）。
 * 改階段時會自動記錄「階段：A → B」。
 */
function updateLead_(d, ctx) {
  const has = function (k) { return Object.prototype.hasOwnProperty.call(d, k); };
  if (has('stage') && LEAD_STAGES.indexOf(d.stage) < 0) throw new Error('不正確的階段');
  if (has('nextDate') && String(d.nextDate || '').trim() && !parseDateLoose(d.nextDate)) throw new Error('下次追蹤日格式不正確');
  return withLock_(function () {
    const t = leadsTable_();
    const lead = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!lead) throw new Error('找不到這筆追蹤，請重新整理');
    const patch = { updatedAt: nowStamp_() };
    if (has('name')) Object.assign(patch, leadFields_(d));
    if (has('owner')) patch.owner = cleanText_(d.owner, 40);
    if (has('nextDate')) patch.nextDate = parseDateLoose(d.nextDate);
    const note = cleanText_(d.note, 500);
    if (note) patch.latest = note;
    const oldStage = lead.stage || LEAD_STAGES[0];
    if (has('stage') && d.stage !== oldStage) {
      patch.stage = d.stage;
      appendLeadLog_(lead.id, d.stage, '階段：' + oldStage + ' → ' + d.stage, ctx.account.displayName);
    }
    if (note) appendLeadLog_(lead.id, patch.stage || oldStage, note, ctx.account.displayName);
    Db.update(t, lead._row, patch);
    return leadOut_(lead, todayIso_());
  });
}

/** 轉為會員：在會員名冊新增一位（入會日今天），追蹤改成「已入會」 */
function convertLead_(d, ctx) {
  requirePerm_(ctx, 'members.member.manage');
  const lead = leadsTable_().rows.filter(function (r) { return r.id === d.id; })[0];
  if (!lead) throw new Error('找不到這筆追蹤，請重新整理');
  if (lead.memberId) throw new Error('這位已經轉為會員了');
  const member = saveMember_({
    name: lead.name, company: lead.company, category: lead.category, phone: lead.phone, email: lead.email,
    sponsor: lead.inviter, joinDate: todayIso_(), status: '在籍'
  });
  return withLock_(function () {
    const t = leadsTable_();
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    Db.update(t, row._row, { stage: '已入會', memberId: member.id, updatedAt: nowStamp_() });
    appendLeadLog_(row.id, '已入會', '轉為會員（' + member.id + '）', ctx.account.displayName);
    return { lead: leadOut_(row, todayIso_()), member: member };
  });
}

function deleteLead_(d) {
  return withLock_(function () {
    const t = leadsTable_();
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這筆追蹤，請重新整理');
    Db.softDelete(t, row._row);
    return true;
  });
}

/** 首頁卡片：我負責、進行中、3 天內要追蹤（含逾期）或還沒排日期的來賓 */
function myFollowups_(ctx) {
  const today = todayIso_();
  const me = ownerNameFor_(ctx.account);
  const soon = addDays(today, 3);
  const mine = leadsTable_().rows.map(function (r) { return leadOut_(r, today); }).filter(function (l) {
    return l.active && nameKey(l.owner) === nameKey(me) && (!l.nextDate || l.nextDate <= soon);
  }).sort(function (a, b) { return (a.nextDate || '9999') < (b.nextDate || '9999') ? -1 : 1; });
  return { me: me, leads: mine.slice(0, 8), total: mine.length };
}
