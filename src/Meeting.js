/**
 * 例會當天：來賓速覽（介紹來賓用的大字卡片）、幸運轉盤（抽獎與紀錄）。
 */

const ARRIVED_STATUSES = ['P', 'L', 'S'];

/** 跟這個專業別可能同業的在籍會員 */
function sameCategoryMembers_(category, members) {
  if (!category) return [];
  return members.filter(function (m) { return categoriesConflict(m.category, category); }).map(function (m) {
    return { name: m.name, category: m.category };
  });
}

/** 同一個人（同名且電話不衝突）以前到場過幾場活動 */
function pastVisits_(regs, g, beforeDate) {
  const seen = {};
  let last = '';
  regs.forEach(function (r) {
    if (!r.checkedInAt || r.eventId === g.eventId || r.eventDate >= beforeDate || nameKey(r.name) !== nameKey(g.name)) return;
    if (g.phone && r.phone && digitsOnly_(g.phone) !== digitsOnly_(r.phone)) return;
    seen[r.eventId] = true;
    if (r.eventDate > last) last = r.eventDate;
  });
  return { count: Object.keys(seen).length, last: last };
}

function showcaseData_(d) {
  const event = getEvent_(d.eventId);
  const regs = registrationsTable_().rows;
  const members = listMembers_(false);
  const guests = regs.filter(function (r) {
    return r.eventId === event.id && (r.role || ROLE_GUEST) === ROLE_GUEST && r.name;
  });
  return {
    event: event,
    guests: guests.map(function (g) {
      const visits = pastVisits_(regs, g, event.date);
      return {
        id: g.id, name: g.name, company: g.company, category: g.category, inviter: g.inviter, note: g.note,
        checkedInAt: g.checkedInAt, visits: visits.count, lastVisit: visits.last,
        sameCategory: sameCategoryMembers_(g.category, members)
      };
    })
  };
}

// ---------- 幸運轉盤 ----------

function wheelOut_(r) {
  return { id: r.id, prize: r.prize, winner: r.winner, poolSize: r.poolSize, drawnBy: r.drawnBy, drawnAt: r.drawnAt };
}

/** 抽獎名單：到場來賓、到場會員、全體在籍會員，以及這場活動的抽獎紀錄 */
function wheelData_(d) {
  const event = getEvent_(d.eventId);
  const regs = listRegistrations_(event.id);
  const members = listMembers_(false);
  let arrivedMembers;
  if (event.isMeeting) {
    const att = attendanceFor_(event.date);
    arrivedMembers = members.filter(function (m) { return att[m.id] && ARRIVED_STATUSES.indexOf(att[m.id].status) >= 0; });
  } else {
    arrivedMembers = regs.filter(function (r) { return r.role === ROLE_MEMBER && r.checkedInAt; });
  }
  return {
    event: event,
    pools: {
      arrivedGuests: regs.filter(function (r) { return r.role !== ROLE_MEMBER && r.checkedInAt; }).map(function (r) { return r.name; }),
      arrivedMembers: arrivedMembers.map(function (m) { return m.name; }),
      allMembers: members.map(function (m) { return m.name; })
    },
    history: Db.read(sheetDefs_().wheel).rows.filter(function (r) { return r.eventId === event.id; }).map(wheelOut_).reverse()
  };
}

function recordWheel_(d, ctx) {
  const event = getEvent_(d.eventId);
  const winner = cleanText_(d.winner, 40);
  if (!winner) throw new Error('沒有得獎者');
  return withLock_(function () {
    const t = Db.read(sheetDefs_().wheel);
    const row = {
      id: newId_('W'), eventId: event.id, eventDate: event.date, prize: cleanText_(d.prize, 40), winner: winner,
      poolSize: Math.max(0, Math.round(toNumber(d.poolSize))), drawnBy: ctx.account.displayName, drawnAt: nowStamp_(), deleted: ''
    };
    Db.append(t, [row]);
    return wheelOut_(row);
  });
}

function deleteWheelRecord_(d) {
  return withLock_(function () {
    const t = Db.read(sheetDefs_().wheel);
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這筆抽獎紀錄');
    Db.softDelete(t, row._row);
    return true;
  });
}
