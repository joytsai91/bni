/**
 * 帳號與權限：每位幹部各自的帳號密碼。
 * - 密碼雜湊後存在指令碼屬性（PWD_帳號ID），試算表裡看不到。
 * - 登入後發簽章 token（14 天）；改密碼、重設密碼、停用或刪除帳號，舊 token 立即失效。
 * - 第一個管理員帳號只能從試算表選單建立，避免陌生人先打開網址搶先註冊。
 */

const TOKEN_DAYS = 14;
const HASH_ITERATIONS = 300;
const ACCOUNT_ACTIVE = '啟用';
const ACCOUNT_DISABLED = '停用';

function scriptProps_() {
  return PropertiesService.getScriptProperties();
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ((b < 0 ? b + 256 : b) + 0x100).toString(16).slice(1); }).join('');
}

function hmacHex_(value, key) {
  return bytesToHex_(Utilities.computeHmacSha256Signature(value, key));
}

function randomHex_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function authSecret_() {
  const props = scriptProps_();
  let secret = props.getProperty('AUTH_SECRET');
  if (!secret) {
    secret = randomHex_();
    props.setProperty('AUTH_SECRET', secret);
  }
  return secret;
}

/** 固定時間比對，避免從回應時間猜出 token */
function safeEqual_(a, b) {
  a = String(a);
  b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------- 密碼 ----------

function hashPassword_(password, salt, iterations) {
  let h = salt;
  for (let i = 0; i < iterations; i++) h = hmacHex_(h + '|' + password, salt);
  return h;
}

function validatePassword_(password) {
  const p = String(password == null ? '' : password);
  if (p.length < 8) throw new Error('密碼至少 8 碼');
  if (p.length > 64) throw new Error('密碼最多 64 碼');
  return p;
}

function setPassword_(accountId, password) {
  const p = validatePassword_(password);
  const salt = randomHex_().slice(0, 32);
  scriptProps_().setProperty('PWD_' + accountId, ['v1', HASH_ITERATIONS, salt, hashPassword_(p, salt, HASH_ITERATIONS)].join('$'));
  bumpTokenVersion_(accountId);
}

function verifyPassword_(accountId, password) {
  const stored = scriptProps_().getProperty('PWD_' + accountId);
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  return safeEqual_(hashPassword_(String(password == null ? '' : password), parts[2], Number(parts[1])), parts[3]);
}

// ---------- token ----------

function tokenVersion_(accountId) {
  return Number(scriptProps_().getProperty('TOKV_' + accountId) || 0);
}

/** 讓這個帳號所有已登入的裝置失效 */
function bumpTokenVersion_(accountId) {
  scriptProps_().setProperty('TOKV_' + accountId, String(tokenVersion_(accountId) + 1));
}

function issueToken_(accountId) {
  const payload = [accountId, nowDate_().getTime() + TOKEN_DAYS * 86400000, tokenVersion_(accountId)].join('.');
  return payload + '.' + hmacHex_(payload, authSecret_());
}

/** 驗證成功回傳帳號ID，失敗回傳空字串 */
function verifyToken_(token) {
  const parts = String(token == null ? '' : token).split('.');
  if (parts.length !== 4) return '';
  const payload = parts.slice(0, 3).join('.');
  if (!safeEqual_(hmacHex_(payload, authSecret_()), parts[3])) return '';
  if (Number(parts[1]) < nowDate_().getTime()) return '';
  if (Number(parts[2]) !== tokenVersion_(parts[0])) return '';
  return parts[0];
}

function authError_(message) {
  const err = new Error(message || '登入已過期，請重新登入');
  err.code = 'AUTH';
  return err;
}

// ---------- 帳號 ----------

function normalizeUsername_(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function validateUsername_(value) {
  const u = normalizeUsername_(value);
  if (!/^[a-z0-9][a-z0-9._@-]{2,39}$/.test(u)) throw new Error('帳號需 3～40 個英文、數字或 . _ - @');
  return u;
}

function isAccountActive_(r) {
  return (r.status || ACCOUNT_ACTIVE) !== ACCOUNT_DISABLED;
}

function permissionsFor_(roles) {
  return resolvePermissions(roles, ROLES, PERMISSIONS.map(function (p) { return p.code; }), BASE_PERMISSIONS);
}

function accountOut_(r) {
  return {
    id: r.id,
    username: r.username,
    displayName: r.displayName || r.username,
    title: r.title,
    roles: parseList(r.roles),
    memberId: r.memberId,
    email: r.email,
    status: r.status || ACCOUNT_ACTIVE,
    lastLoginAt: r.lastLoginAt,
    createdAt: r.createdAt
  };
}

function accountsTable_() {
  return Db.read(sheetDefs_().accounts);
}

function findAccountRow_(table, id) {
  const row = table.rows.filter(function (a) { return a.id === id; })[0];
  if (!row) throw new Error('找不到這個帳號，請重新整理');
  return row;
}

function cleanRoles_(value) {
  const known = ROLES.map(function (r) { return r.name; });
  return parseList(Array.isArray(value) ? value.join(',') : value).filter(function (r) { return known.indexOf(r) >= 0; });
}

function activeAdmins_(rows) {
  return rows.filter(function (a) { return isAccountActive_(a) && parseList(a.roles).indexOf(ADMIN_ROLE) >= 0; });
}

/** 每個需要登入的 API 都先經過這裡 */
function authenticate_(token) {
  const id = verifyToken_(token);
  if (!id) throw authError_();
  const row = accountsTable_().rows.filter(function (a) { return a.id === id; })[0];
  if (!row || !isAccountActive_(row)) throw authError_();
  const account = accountOut_(row);
  return { account: account, perms: permissionsFor_(account.roles) };
}

function requirePerm_(ctx, perm) {
  if (!hasPermission(ctx.perms, perm)) throw new Error('你沒有使用這個功能的權限');
}

function sessionPayload_(accountId) {
  const account = accountOut_(findAccountRow_(accountsTable_(), accountId));
  return { token: issueToken_(accountId), account: account, perms: permissionsFor_(account.roles) };
}

function login_(d) {
  const username = normalizeUsername_(d.username);
  if (!username || !d.password) throw new Error('請輸入帳號和密碼');
  const cache = CacheService.getScriptCache();
  const failKey = 'login_fail:' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 5) throw new Error('密碼錯誤太多次，請 15 分鐘後再試');
  throttle_('login', 60, 600);
  const row = accountsTable_().rows.filter(function (a) { return normalizeUsername_(a.username) === username; })[0];
  if (!row || !isAccountActive_(row) || !verifyPassword_(row.id, d.password)) {
    cache.put(failKey, String(fails + 1), 900);
    throw new Error('帳號或密碼錯誤');
  }
  cache.remove(failKey);
  withLock_(function () {
    const t = accountsTable_();
    Db.update(t, findAccountRow_(t, row.id)._row, { lastLoginAt: nowStamp_() });
  });
  return sessionPayload_(row.id);
}

function changeOwnPassword_(d, ctx) {
  if (!verifyPassword_(ctx.account.id, d.currentPassword)) throw new Error('目前的密碼不正確');
  setPassword_(ctx.account.id, d.newPassword);
  return { token: issueToken_(ctx.account.id) };
}

// ---------- 帳號管理（系統管理員） ----------

function listAccounts_() {
  return {
    accounts: accountsTable_().rows.map(accountOut_),
    roles: ROLES.map(function (r) { return { name: r.name, note: r.note }; })
  };
}

function accountFields_(d) {
  const displayName = cleanText_(d.displayName, 30);
  if (!displayName) throw new Error('請填寫顯示名稱');
  return {
    displayName: displayName,
    title: cleanText_(d.title, 20),
    roles: cleanRoles_(d.roles).join(','),
    memberId: cleanText_(d.memberId, 20),
    email: cleanText_(d.email, 100)
  };
}

function createAccount_(d) {
  const username = validateUsername_(d.username);
  const fields = accountFields_(d);
  validatePassword_(d.password);
  return withLock_(function () {
    const t = accountsTable_();
    if (t.rows.some(function (a) { return normalizeUsername_(a.username) === username; })) {
      throw new Error('這個帳號已經有人使用');
    }
    const row = {
      id: newId_('U'), username: username, status: ACCOUNT_ACTIVE, lastLoginAt: '', createdAt: nowStamp_(), deleted: ''
    };
    Object.keys(fields).forEach(function (k) { row[k] = fields[k]; });
    Db.append(t, [row]);
    setPassword_(row.id, d.password);
    return accountOut_(row);
  });
}

/** 最後一位啟用中的系統管理員，不能被停用、移除管理員角色或刪除 */
function guardLastAdmin_(rows, id, next) {
  const admins = activeAdmins_(rows);
  if (admins.length === 1 && admins[0].id === id && !(next && isAccountActive_(next) && parseList(next.roles).indexOf(ADMIN_ROLE) >= 0)) {
    throw new Error('至少要保留一位啟用中的系統管理員');
  }
}

function updateAccount_(d, ctx) {
  const fields = accountFields_(d);
  const status = d.status === ACCOUNT_DISABLED ? ACCOUNT_DISABLED : ACCOUNT_ACTIVE;
  if (d.id === ctx.account.id && status === ACCOUNT_DISABLED) throw new Error('不能停用自己的帳號');
  return withLock_(function () {
    const t = accountsTable_();
    const row = findAccountRow_(t, d.id);
    guardLastAdmin_(t.rows, row.id, { status: status, roles: fields.roles });
    const wasActive = isAccountActive_(row);
    Db.update(t, row._row, Object.assign({ status: status }, fields));
    if (wasActive && status === ACCOUNT_DISABLED) bumpTokenVersion_(row.id); // 停用：已登入的裝置立即登出
    return accountOut_(findAccountRow_(t, row.id));
  });
}

function resetAccountPassword_(d) {
  const row = findAccountRow_(accountsTable_(), d.id);
  setPassword_(row.id, d.password);
  return true;
}

function deleteAccount_(d, ctx) {
  if (d.id === ctx.account.id) throw new Error('不能刪除自己的帳號');
  return withLock_(function () {
    const t = accountsTable_();
    const row = findAccountRow_(t, d.id);
    guardLastAdmin_(t.rows, row.id, null);
    Db.softDelete(t, row._row);
    bumpTokenVersion_(row.id);
    return true;
  });
}

// ---------- 試算表選單（第一個管理員、忘記密碼） ----------

function promptText_(ui, title, message) {
  const res = ui.prompt(title, message, ui.ButtonSet.OK_CANCEL);
  return res.getSelectedButton() === ui.Button.OK ? res.getResponseText().trim() : null;
}

function menuCreateAdmin() {
  const ui = SpreadsheetApp.getUi();
  setupSheets_();
  const username = promptText_(ui, '建立管理員帳號（1/3）', '登入帳號：英文或數字，至少 3 碼');
  if (username === null) return;
  const displayName = promptText_(ui, '建立管理員帳號（2/3）', '顯示名稱，例如：Joy');
  if (displayName === null) return;
  const password = promptText_(ui, '建立管理員帳號（3/3）', '密碼：至少 8 碼（輸入時會顯示在畫面上，請留意旁人）');
  if (password === null) return;
  try {
    createAccount_({ username: username, displayName: displayName, roles: ADMIN_ROLE, password: password });
    ui.alert('已建立管理員帳號：' + normalizeUsername_(username) + '\n\n接著到「部署」取得網址後就能登入。');
  } catch (err) {
    ui.alert('建立失敗：' + err.message);
  }
}

function menuResetPassword() {
  const ui = SpreadsheetApp.getUi();
  const username = promptText_(ui, '重設帳號密碼（1/2）', '要重設哪個帳號？');
  if (username === null) return;
  const row = accountsTable_().rows.filter(function (a) { return normalizeUsername_(a.username) === normalizeUsername_(username); })[0];
  if (!row) {
    ui.alert('找不到帳號：' + username);
    return;
  }
  const password = promptText_(ui, '重設帳號密碼（2/2）', '新密碼：至少 8 碼（輸入時會顯示在畫面上，請留意旁人）');
  if (password === null) return;
  try {
    setPassword_(row.id, password);
    ui.alert('已重設 ' + row.username + ' 的密碼，這個帳號在其他裝置的登入都已失效。');
  } catch (err) {
    ui.alert('重設失敗：' + err.message);
  }
}
