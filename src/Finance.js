/**
 * 財務中心：
 * - 收支帳：每筆收入、支出一列。寫錯不刪除也不修改，一律「作廢」後重記（保留原始紀錄、作廢原因與作廢人）。
 * - 報名繳費自動入帳：報名名單標記「已繳費」時自動記一筆收入（例會記「來賓費」、其他活動記「活動收入」），
 *   取消繳費或刪除報名時自動作廢那筆帳。
 * - 會員月費：一次可以繳好幾個月，合成一筆收入；作廢這筆繳費會連帶作廢那幾個月。
 * - 餘額 = 設定的期初餘額 + 所有正常收入 − 所有正常支出。
 */

const LEDGER_INCOME = '收入';
const LEDGER_EXPENSE = '支出';
const LEDGER_NORMAL = '正常';
const LEDGER_VOID = '作廢';
const MAX_DUES_MONTHS = 24;

function ledgerTable_() {
  return Db.read(sheetDefs_().ledger);
}

function duesTable_() {
  return Db.read(sheetDefs_().dues);
}

function isVoid_(r) {
  return r.status === LEDGER_VOID;
}

function isExpense_(r) {
  return r.type === LEDGER_EXPENSE;
}

function ledgerOut_(r) {
  return {
    id: r.id, date: parseDateLoose(r.date), type: isExpense_(r) ? LEDGER_EXPENSE : LEDGER_INCOME,
    category: r.category, amount: toNumber(r.amount), party: r.party, note: r.note, relatedId: r.relatedId,
    handledBy: r.handledBy, voided: isVoid_(r), voidReason: r.voidReason, voidedBy: r.voidedBy, voidedAt: r.voidedAt,
    createdAt: r.createdAt
  };
}

function operatorName_(ctx) {
  return ctx && ctx.account ? ctx.account.displayName : '系統';
}

/** 金額：大於 0、最多兩位小數，可以有千分位逗號 */
function moneyAmount_(value, label) {
  const s = String(value == null ? '' : value).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s) || Number(s) <= 0) throw new Error((label || '金額') + '請填大於 0 的數字');
  if (Number(s) > 10000000) throw new Error((label || '金額') + '太大了，請再確認一次');
  return Number(s);
}

/** 記一筆帳（呼叫端要在 withLock_ 裡） */
function appendLedger_(entry, ctx) {
  const row = {
    id: newId_('J'), date: entry.date || todayIso_(), type: entry.type, category: entry.category, amount: entry.amount,
    party: entry.party || '', note: entry.note || '', relatedId: entry.relatedId || '', handledBy: operatorName_(ctx),
    status: LEDGER_NORMAL, voidReason: '', voidedBy: '', voidedAt: '', createdAt: nowStamp_()
  };
  Db.append(ledgerTable_(), [row]);
  return row;
}

/**
 * 作廢一筆帳，並連帶處理關聯資料：
 * - 月費：同一筆繳費的每個月份一起作廢
 * - 報名：取消「已繳費」（opts.keepRegistration 為 true 時代表報名那邊自己會改）
 */
function voidLedgerRow_(t, row, reason, ctx, opts) {
  Db.update(t, row._row, { status: LEDGER_VOID, voidReason: reason, voidedBy: operatorName_(ctx), voidedAt: nowStamp_() });
  const dues = duesTable_();
  dues.rows.filter(function (r) { return r.ledgerId === row.id && !isVoid_(r); }).forEach(function (r) {
    Db.update(dues, r._row, { status: LEDGER_VOID });
  });
  if (opts && opts.keepRegistration) return;
  const regs = registrationsTable_();
  regs.rows.filter(function (r) { return r.ledgerId === row.id; }).forEach(function (r) {
    Db.update(regs, r._row, { paid: '', paidAmount: 0, ledgerId: '' });
  });
}

// ---------- 報名繳費連動（由 Guests.js 的 paymentChanges_ 呼叫，已在鎖內） ----------

function recordRegistrationPayment_(reg, event, amount, ctx) {
  const who = (reg.role || ROLE_GUEST) === ROLE_MEMBER ? '會員' : '來賓';
  return appendLedger_({
    type: LEDGER_INCOME, category: event.isMeeting ? '來賓費' : '活動收入', amount: amount, party: reg.name,
    note: event.dateLabel + ' ' + event.name + '（' + who + '）', relatedId: reg.id
  }, ctx);
}

function voidRegistrationPayment_(reg, reason, ctx) {
  if (!reg.ledgerId) return;
  const t = ledgerTable_();
  const entry = t.rows.filter(function (r) { return r.id === reg.ledgerId; })[0];
  if (entry && !isVoid_(entry)) voidLedgerRow_(t, entry, reason, ctx, { keepRegistration: true });
}

// ---------- 收支帳 ----------

function ledgerFields_(d) {
  const type = d.type === LEDGER_INCOME || d.type === LEDGER_EXPENSE ? d.type : '';
  if (!type) throw new Error('請選擇收入或支出');
  const date = parseDateLoose(d.date);
  if (!date) throw new Error('請選擇日期');
  const category = cleanText_(d.category, 20);
  if (!category) throw new Error('請選擇科目');
  return {
    type: type, date: date, category: category, amount: moneyAmount_(d.amount),
    party: cleanText_(d.party, 40), note: cleanText_(d.note, 200)
  };
}

function createLedger_(d, ctx) {
  const fields = ledgerFields_(d);
  return withLock_(function () {
    return ledgerOut_(appendLedger_(fields, ctx));
  });
}

function voidLedger_(d, ctx) {
  const reason = cleanText_(d.reason, 100);
  if (!reason) throw new Error('請填寫作廢原因');
  return withLock_(function () {
    const t = ledgerTable_();
    const row = t.rows.filter(function (r) { return r.id === d.id; })[0];
    if (!row) throw new Error('找不到這筆帳，請重新整理');
    if (isVoid_(row)) throw new Error('這筆帳已經作廢了');
    voidLedgerRow_(t, row, reason, ctx);
    return ledgerOut_(row);
  });
}

function signedAmount_(r) {
  return isExpense_(r) ? -toNumber(r.amount) : toNumber(r.amount);
}

/** 財務中心：選定月份的明細與分類統計、整年月結、目前餘額 */
function financePage_(d) {
  const s = getSettings_();
  const today = todayIso_();
  const month = parseMonth(d.month) || today.slice(0, 7);
  const year = month.slice(0, 4);
  const rows = ledgerTable_().rows.map(ledgerOut_).filter(function (r) { return r.date; });

  let balance = s.openingBalance;
  let beforeYear = s.openingBalance;
  const months = {};
  for (let i = 1; i <= 12; i++) months[year + '-' + pad2_(i)] = { income: 0, expense: 0 };
  rows.forEach(function (r) {
    if (r.voided) return;
    const v = signedAmount_(r);
    balance += v;
    const m = r.date.slice(0, 7);
    if (m.slice(0, 4) < year) beforeYear += v;
    else if (months[m]) months[m][r.type === LEDGER_EXPENSE ? 'expense' : 'income'] += r.amount;
  });

  let running = beforeYear;
  const monthly = Object.keys(months).sort().map(function (k) {
    const m = months[k];
    running += m.income - m.expense;
    return {
      month: k, income: roundMoney_(m.income), expense: roundMoney_(m.expense), net: roundMoney_(m.income - m.expense),
      balance: roundMoney_(running), future: k > today.slice(0, 7)
    };
  });

  const entries = rows.filter(function (r) { return r.date.slice(0, 7) === month; }).sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
  const byCategory = {};
  entries.forEach(function (r) {
    if (r.voided) return;
    const key = r.type + '|' + r.category;
    const c = byCategory[key] || (byCategory[key] = { type: r.type, category: r.category, amount: 0, count: 0 });
    c.amount += r.amount;
    c.count += 1;
  });
  const current = monthly.filter(function (m) { return m.month === month; })[0];
  return {
    today: today, month: month, year: year, openingBalance: s.openingBalance, balance: roundMoney_(balance),
    summary: { income: current.income, expense: current.expense, net: current.net, balance: current.balance },
    monthly: monthly,
    byCategory: Object.keys(byCategory).map(function (k) {
      return Object.assign({}, byCategory[k], { amount: roundMoney_(byCategory[k].amount) });
    }).sort(function (a, b) { return a.type === b.type ? b.amount - a.amount : a.type === LEDGER_INCOME ? -1 : 1; }),
    entries: entries,
    categories: { income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES }
  };
}

// ---------- 會員月費 ----------

function duesOut_(r) {
  return { id: r.id, amount: toNumber(r.amount), paidDate: parseDateLoose(r.paidDate), ledgerId: r.ledgerId, handledBy: r.handledBy };
}

/**
 * 月費繳納表：會員 × 一整年 12 個月（在籍會員，加上這年有繳費紀錄的已離會會員）。
 * startMonth 是分會開始記月費的月份（最早一筆月費），在那之前沒繳的月份不算「未繳」。
 */
function duesPage_(d) {
  const s = getSettings_();
  const today = todayIso_();
  const year = /^\d{4}$/.test(String(d.year || '')) ? String(d.year) : today.slice(0, 4);
  const months = [];
  for (let i = 1; i <= 12; i++) months.push(year + '-' + pad2_(i));
  const byMember = {};
  let startMonth = '';
  duesTable_().rows.forEach(function (r) {
    const m = parseMonth(r.month);
    if (isVoid_(r) || !m) return;
    if (!startMonth || m < startMonth) startMonth = m;
    if (m.slice(0, 4) !== year) return;
    (byMember[r.memberId] || (byMember[r.memberId] = {}))[m] = duesOut_(r);
  });
  const members = listMembers_(true).filter(function (m) { return m.active || byMember[m.id]; }).map(function (m) {
    return {
      id: m.id, name: m.name, category: m.category, active: m.active, status: m.status,
      joinMonth: m.joinDate ? m.joinDate.slice(0, 7) : '', cells: byMember[m.id] || {}
    };
  });
  const totals = months.map(function (mo) {
    let count = 0;
    let amount = 0;
    members.forEach(function (m) {
      if (m.cells[mo]) {
        count += 1;
        amount += m.cells[mo].amount;
      }
    });
    return { month: mo, count: count, amount: roundMoney_(amount) };
  });
  return {
    today: today, year: year, months: months, currentMonth: today.slice(0, 7), startMonth: startMonth || today.slice(0, 7),
    monthlyDues: s.monthlyDues, members: members, totals: totals
  };
}

function payDues_(d, ctx) {
  const member = listMembers_(true).filter(function (m) { return m.id === d.memberId; })[0];
  if (!member) throw new Error('找不到這位會員，請重新整理');
  const raw = Array.isArray(d.months) ? d.months : parseList(d.months);
  const months = raw.map(parseMonth);
  if (!months.length || months.some(function (m) { return !m; })) throw new Error('請選擇要繳的月份');
  const unique = months.filter(function (m, i) { return months.indexOf(m) === i; }).sort();
  if (unique.length > MAX_DUES_MONTHS) throw new Error('一次最多繳 ' + MAX_DUES_MONTHS + ' 個月');
  const hasAmount = d.amount !== undefined && String(d.amount).trim() !== '';
  const perMonth = moneyAmount_(hasAmount ? d.amount : getSettings_().monthlyDues, '每月金額');
  const paidDate = d.paidDate ? parseDateLoose(d.paidDate) : todayIso_();
  if (!paidDate) throw new Error('繳費日格式不正確');
  return withLock_(function () {
    const t = duesTable_();
    const taken = t.rows.filter(function (r) {
      return r.memberId === member.id && !isVoid_(r) && unique.indexOf(parseMonth(r.month)) >= 0;
    }).map(function (r) { return parseMonth(r.month); }).sort();
    if (taken.length) throw new Error(member.name + ' 的 ' + taken.join('、') + ' 已經繳過了');
    const entry = appendLedger_({
      date: paidDate, type: LEDGER_INCOME, category: '會員月費', amount: roundMoney_(perMonth * unique.length),
      party: member.name, note: '月費 ' + monthsLabel(unique), relatedId: member.id
    }, ctx);
    const stamp = nowStamp_();
    Db.append(t, unique.map(function (m) {
      return {
        id: newId_('D'), memberId: member.id, name: member.name, month: m, amount: perMonth, paidDate: paidDate,
        ledgerId: entry.id, handledBy: entry.handledBy, status: LEDGER_NORMAL, createdAt: stamp
      };
    }));
    return { ledger: ledgerOut_(entry), months: unique };
  });
}

/** 作廢一筆月費：連同同一次繳的其他月份與那筆收入一起作廢 */
function voidDues_(d, ctx) {
  const reason = cleanText_(d.reason, 100);
  if (!reason) throw new Error('請填寫作廢原因');
  return withLock_(function () {
    const dues = duesTable_();
    const rec = dues.rows.filter(function (r) { return r.id === d.id && !isVoid_(r); })[0];
    if (!rec) throw new Error('找不到這筆月費，請重新整理');
    const t = ledgerTable_();
    const entry = t.rows.filter(function (r) { return r.id === rec.ledgerId; })[0];
    if (entry && !isVoid_(entry)) voidLedgerRow_(t, entry, reason, ctx);
    else Db.update(dues, rec._row, { status: LEDGER_VOID });
    return true;
  });
}

// ---------- 首頁 ----------

/** 首頁財務卡片：目前餘額、本月收支、本月還沒繳月費的在籍會員數 */
function financeCard_() {
  const s = getSettings_();
  const month = todayIso_().slice(0, 7);
  let balance = s.openingBalance;
  let income = 0;
  let expense = 0;
  ledgerTable_().rows.forEach(function (r) {
    if (isVoid_(r)) return;
    balance += signedAmount_(r);
    if (parseDateLoose(r.date).slice(0, 7) !== month) return;
    if (isExpense_(r)) expense += toNumber(r.amount);
    else income += toNumber(r.amount);
  });
  let duesUnpaid = null;
  if (s.monthlyDues > 0) {
    const paid = {};
    duesTable_().rows.forEach(function (r) {
      if (!isVoid_(r) && parseMonth(r.month) === month) paid[r.memberId] = true;
    });
    duesUnpaid = listMembers_(false).filter(function (m) {
      return !paid[m.id] && !(m.joinDate && m.joinDate.slice(0, 7) > month);
    }).length;
  }
  return { month: month, balance: roundMoney_(balance), income: roundMoney_(income), expense: roundMoney_(expense), duesUnpaid: duesUnpaid };
}
