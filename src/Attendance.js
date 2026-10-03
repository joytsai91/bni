/**
 * 會員出席：P 出席、L 遲到、S 代理、M 病假、A 缺席。
 * 每場例會每位會員一列，存在「會員出席」工作表。
 */

const ATTENDANCE_STATUSES = ['P', 'L', 'S', 'M', 'A'];

function attendanceFor_(date) {
  const byId = {};
  Db.read(sheetDefs_().attendance).rows.forEach(function (r) {
    if (r.date === date) byId[r.memberId] = r;
  });
  return byId;
}

/** 簽到畫面需要的資料：在籍會員與出席狀態、當天來賓 */
function checkinBoard_(date) {
  date = requireDate_(date);
  const att = attendanceFor_(date);
  return {
    date: date,
    isToday: date === todayIso_(),
    members: listMembers_(false).map(function (m) {
      const a = att[m.id];
      return {
        id: m.id, name: m.name, company: m.company, category: m.category,
        status: a ? a.status : '', substitute: a ? a.substitute : '', checkedInAt: a ? a.checkedInAt : ''
      };
    }),
    guests: listGuests_(date).map(function (g) {
      return {
        id: g.id, name: g.name, company: g.company, category: g.category, inviter: g.inviter,
        source: g.source, checkedInAt: g.checkedInAt, paid: g.paid
      };
    })
  };
}

/**
 * status 為 'auto' 時依時間判斷：例會當天超過遲到判定時間記 L，其餘記 P。
 * status 為空字串代表清除這位會員的出席紀錄。
 */
function setMemberStatus_(date, memberId, status, substitute) {
  date = requireDate_(date);
  status = String(status || '').toUpperCase();
  if (status && status !== 'AUTO' && ATTENDANCE_STATUSES.indexOf(status) < 0) throw new Error('不正確的出席狀態');
  const member = listMembers_(true).filter(function (m) { return m.id === memberId; })[0];
  if (!member) throw new Error('找不到這位會員，請重新整理');
  const isToday = date === todayIso_();
  if (status === 'AUTO') status = isToday ? checkinStatus(nowTime_(), getSettings_().lateAfter) : 'P';

  return withLock_(function () {
    const t = Db.read(sheetDefs_().attendance);
    const existing = t.rows.filter(function (r) { return r.date === date && r.memberId === memberId; })[0];
    if (!status) {
      if (existing) Db.deleteRows(t, [existing._row]);
      return { memberId: memberId, status: '', substitute: '', checkedInAt: '' };
    }
    const arrived = status === 'P' || status === 'L' || status === 'S';
    const rec = {
      date: date,
      memberId: memberId,
      name: member.name,
      status: status,
      substitute: status === 'S' ? cleanText_(substitute, 40) : '',
      checkedInAt: arrived && isToday ? (existing && existing.checkedInAt) || nowStamp_() : '',
      updatedAt: nowStamp_()
    };
    if (existing) Db.update(t, existing._row, rec);
    else Db.append(t, [rec]);
    return { memberId: memberId, status: rec.status, substitute: rec.substitute, checkedInAt: rec.checkedInAt };
  });
}

/** 例會結束後，把還沒簽到的在籍會員記為缺席 */
function markUncheckedAbsent_(date) {
  date = requireDate_(date);
  const members = listMembers_(false);
  return withLock_(function () {
    const t = Db.read(sheetDefs_().attendance);
    const marked = {};
    t.rows.forEach(function (r) { if (r.date === date) marked[r.memberId] = true; });
    const stamp = nowStamp_();
    const absent = members.filter(function (m) { return !marked[m.id]; }).map(function (m) {
      return { date: date, memberId: m.id, name: m.name, status: 'A', substitute: '', checkedInAt: '', updatedAt: stamp };
    });
    Db.append(t, absent);
    return { count: absent.length };
  });
}

/** 列印用：在籍會員、當天來賓與分會設定 */
function printData_(date) {
  date = requireDate_(date);
  return {
    date: date,
    dateLabel: dateLabel_(date),
    settings: getSettings_(),
    members: listMembers_(false).map(function (m) {
      return { name: m.name, company: m.company, category: m.category };
    }),
    guests: listGuests_(date).map(function (g) {
      return { name: g.name, company: g.company, category: g.category, phone: g.phone, inviter: g.inviter };
    })
  };
}
