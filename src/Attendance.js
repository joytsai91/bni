/**
 * 簽到：
 * - 例會：會員出席記在「會員出席」（P 出席、L 遲到、S 代理、M 病假、A 缺席），每場例會每位會員一列；
 *   來賓簽到記在報名名單。
 * - 其他活動：報名的會員與來賓都在報名名單簽到。
 * - 清除簽到只是把狀態清空，不刪除資料列。
 */

const ATTENDANCE_STATUSES = ['P', 'L', 'S', 'M', 'A'];

function attendanceFor_(date) {
  const byId = {};
  Db.read(sheetDefs_().attendance).rows.forEach(function (r) {
    if (r.date === date) byId[r.memberId] = r;
  });
  return byId;
}

function requireMeeting_(eventId) {
  const event = getEvent_(eventId);
  if (!event.isMeeting) throw new Error('會員出席只在例會記錄');
  return event;
}

/** 簽到畫面需要的資料 */
function checkinBoard_(d) {
  const event = getEvent_(d.eventId);
  const board = {
    event: event,
    isToday: event.date === todayIso_(),
    registrations: listRegistrations_(event.id).map(function (r) {
      return {
        id: r.id, role: r.role, memberId: r.memberId, name: r.name, company: r.company, category: r.category,
        inviter: r.inviter, source: r.source, checkedInAt: r.checkedInAt, paid: r.paid, paidAmount: r.paidAmount
      };
    }),
    members: []
  };
  if (event.isMeeting) {
    const att = attendanceFor_(event.date);
    board.members = listMembers_(false).map(function (m) {
      const a = att[m.id];
      return {
        id: m.id, name: m.name, company: m.company, category: m.category,
        status: a ? a.status : '', substitute: a ? a.substitute : '', checkedInAt: a ? a.checkedInAt : ''
      };
    });
  }
  return board;
}

/**
 * status 為 'auto' 時依時間判斷：例會當天超過遲到判定時間記 L，其餘記 P。
 * status 為空字串代表清除這位會員的出席狀態。
 */
function setMemberStatus_(d) {
  const event = requireMeeting_(d.eventId);
  const date = event.date;
  let status = String(d.status || '').toUpperCase();
  if (status && status !== 'AUTO' && ATTENDANCE_STATUSES.indexOf(status) < 0) throw new Error('不正確的出席狀態');
  const member = listMembers_(true).filter(function (m) { return m.id === d.memberId; })[0];
  if (!member) throw new Error('找不到這位會員，請重新整理');
  const isToday = date === todayIso_();
  if (status === 'AUTO') status = isToday ? checkinStatus(nowTime_(), getSettings_().lateAfter) : 'P';

  return withLock_(function () {
    const t = Db.read(sheetDefs_().attendance);
    const existing = t.rows.filter(function (r) { return r.date === date && r.memberId === d.memberId; })[0];
    const arrived = status === 'P' || status === 'L' || status === 'S';
    const rec = {
      date: date,
      memberId: d.memberId,
      name: member.name,
      status: status,
      substitute: status === 'S' ? cleanText_(d.substitute, 40) : '',
      checkedInAt: arrived && isToday ? (existing && existing.checkedInAt) || nowStamp_() : '',
      updatedAt: nowStamp_()
    };
    if (existing) Db.update(t, existing._row, rec);
    else if (status) Db.append(t, [rec]);
    return { memberId: d.memberId, status: rec.status, substitute: rec.substitute, checkedInAt: rec.checkedInAt };
  });
}

/** 例會結束後，把還沒簽到的在籍會員記為缺席 */
function markUncheckedAbsent_(d) {
  const event = requireMeeting_(d.eventId);
  const date = event.date;
  const members = listMembers_(false);
  return withLock_(function () {
    const t = Db.read(sheetDefs_().attendance);
    const existing = {};
    t.rows.forEach(function (r) { if (r.date === date) existing[r.memberId] = r; });
    const stamp = nowStamp_();
    const fresh = [];
    let count = 0;
    members.forEach(function (m) {
      const row = existing[m.id];
      if (row && row.status) return;
      count += 1;
      const rec = { date: date, memberId: m.id, name: m.name, status: 'A', substitute: '', checkedInAt: '', updatedAt: stamp };
      if (row) Db.update(t, row._row, rec);
      else fresh.push(rec);
    });
    Db.append(t, fresh);
    return { count: count };
  });
}

/** 出席結果文字（簽到頁「出席結果文字」、LINE 小助理共用） */
function attendanceText_(d) {
  const board = checkinBoard_({ eventId: requireMeeting_(d.eventId).id });
  return buildAttendanceText(getSettings_().chapterName, board.event.dateLabel, board.members, board.registrations);
}

/** 列印用：活動資訊、分會設定、在籍會員（例會才需要）與報名名單 */
function printData_(d) {
  const event = getEvent_(d.eventId);
  return {
    event: event,
    dateLabel: event.dateLabel,
    settings: getSettings_(),
    members: event.isMeeting ? listMembers_(false).map(function (m) {
      return { name: m.name, company: m.company, category: m.category };
    }) : [],
    registrations: listRegistrations_(event.id).map(function (r) {
      return { role: r.role, name: r.name, company: r.company, category: r.category, phone: r.phone, inviter: r.inviter };
    })
  };
}
