/**
 * 首頁：這一週（活動與每週提醒）、下一場例會、下一場其他活動，以及依權限顯示的待辦卡片。
 */

function compareTime_(a, b) {
  const ka = a.time || '99:99';
  const kb = b.time || '99:99';
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** 提醒與訊息範本共用的例會欄位 */
function meetingTemplateContext_(s, meeting) {
  return {
    分會名稱: s.chapterName,
    例會日期: meeting ? meeting.dateLabel : '',
    例會時間: meeting ? meeting.timeLabel : '',
    例會地點: meeting ? meeting.place : ''
  };
}

function emptyCounts_() {
  return { total: 0, guests: 0, members: 0, paid: 0, checkedIn: 0 };
}

function homeData_(d, ctx) {
  const s = getSettings_();
  const today = todayIso_();
  const now = nowTime_();
  const events = listEvents_(today, addDays(today, 90));
  const upcoming = events.filter(function (e) { return !e.cancelled && isUpcoming_(e, today, now); });
  const nextMeeting = upcoming.filter(function (e) { return e.isMeeting; })[0] || null;
  const nextEvent = upcoming.filter(function (e) { return !e.isMeeting; })[0] || null;
  const tplCtx = meetingTemplateContext_(s, nextMeeting);
  const reminders = listReminders_().filter(function (r) { return r.enabled && r.weekday >= 0; });

  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, i);
    const items = events.filter(function (e) { return e.date === date; }).map(function (e) {
      return { kind: 'event', id: e.id, time: e.startTime, title: e.name, type: e.type, place: e.place, cancelled: e.cancelled };
    }).concat(reminders.filter(function (r) { return r.weekday === weekdayOf(date); }).map(function (r) {
      return { kind: 'reminder', id: r.id, time: r.time, title: fillTemplate(r.content, tplCtx) };
    })).sort(compareTime_);
    days.push({ date: date, weekday: WEEKDAY_LABELS[weekdayOf(date)], day: Number(date.slice(8)), items: items });
  }

  const canSeeRegs = hasPermission(ctx.perms, 'guests.registration.view');
  const counts = canSeeRegs ? registrationCounts_() : {};
  const withCounts = function (e) {
    return e ? Object.assign({}, e, { counts: canSeeRegs ? (counts[e.id] || emptyCounts_()) : null }) : null;
  };
  const cards = {};
  if (hasPermission(ctx.perms, 'members.member.view')) {
    cards.expiring = { days: s.expiryNoticeDays, members: expiringMembers_(today, s.expiryNoticeDays).slice(0, 8) };
  }
  if (hasPermission(ctx.perms, 'followup.lead.view')) {
    cards.followups = myFollowups_(ctx);
  }
  if (hasPermission(ctx.perms, 'finance.ledger.view')) {
    cards.finance = financeCard_();
  }
  return {
    today: today,
    now: now,
    days: days,
    nextMeeting: withCounts(nextMeeting),
    nextEvent: withCounts(nextEvent),
    cards: cards
  };
}
