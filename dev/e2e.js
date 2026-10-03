#!/usr/bin/env node
'use strict';
/**
 * 端對端測試：啟動本機預覽，用 Chromium 實際操作畫面，輸出截圖與列印 PDF。
 *   npm run e2e [輸出資料夾，預設 .e2e-output]
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const XLSX = require('xlsx');
const { chromium } = require('playwright');
const { start, simulateLineText } = require('./server');
const { MEMBERS } = require('./seed');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '.e2e-output'));
const NOW = '2026-10-08T06:55:00+08:00'; // 週四例會當天，遲到判定 07:00 之前
const MTG = 'MTG-2026-10-08';
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };

function writeSamplePalms(file) {
  const rows = [
    ['PALMS Summary Report'],
    ['Chapter', 'BNI 示範分會'],
    ['From: 9/24/2026 To: 9/30/2026'],
    [],
    ['First Name', 'Last Name', 'P', 'A', 'L', 'M', 'S', 'RGI', 'RGO', 'RRI', 'RRO', 'V', '1-2-1', 'TYFCB', 'CEU', 'T']
  ];
  MEMBERS.concat([['黃新人']]).forEach(([name], i) => {
    rows.push([name.slice(1), name.slice(0, 1), i % 5 ? 1 : 0, i % 5 ? 0 : 1, 0, 0, 0, i % 4, i % 2, i % 3, 0, i % 6 === 0 ? 1 : 0, i % 3 + 1, i * 15000, 1, 0]);
  });
  rows.push(['Total']);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'PALMS');
  XLSX.writeFile(wb, file);
}

function pdfPages(file) {
  return (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
}

async function login(page, url, account) {
  await page.goto(url + '/exec');
  await page.waitForSelector('#login-view:not([hidden])');
  await page.fill('#login-username', account.username);
  await page.fill('#login-password', account.password);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('#shell:not([hidden]) .hello h1');
}

async function goTo(page, id) {
  if (await page.isVisible('#menu-btn')) {
    await page.click('#menu-btn');
    await page.waitForSelector('#drawer.open');
  }
  await page.click(`.nav-item[data-go=${id}]`);
}

async function navItems(page) {
  return page.$$eval('#drawer-nav .nav-item', (els) => els.map((e) => e.getAttribute('data-go')));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, gas, seeded, url } = await start({ port: 0, now: NOW });
  const browser = await chromium.launch();
  const errors = [];
  const shot = (page, name, full) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: !!full });
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    return page;
  };
  const step = (msg) => console.log('✓ ' + msg);

  try {
    // 1. 報名頁（手機）：例會來賓＋個人邀請連結；聯誼活動用會員身分報名
    const phone = watch(await browser.newPage(PHONE));
    await phone.goto(`${url}/exec?page=register&event=${MTG}&inviter=${encodeURIComponent('林美麗')}`);
    await phone.waitForSelector('#reg-form:not([hidden])');
    assert.equal(await phone.textContent('#reg-title'), 'BNI 示範分會｜活動報名');
    assert.equal(await phone.inputValue('#reg-event'), MTG);
    assert.equal(await phone.inputValue('#reg-inviter'), '林美麗');
    assert.equal(await phone.isVisible('#reg-role-box'), false, '例會不顯示身分選項');
    await shot(phone, '01-register', true);
    await phone.click('#reg-submit');
    assert.match(await phone.textContent('#reg-error'), /姓名/);
    await phone.fill('[name=name]', '測試來賓');
    await phone.fill('[name=company]', '測試顧問有限公司');
    await phone.fill('[name=category]', '企業顧問');
    await phone.fill('[name=phone]', '0911222333');
    await phone.click('#reg-submit');
    await phone.waitForSelector('#reg-done:not([hidden])');
    assert.match(await phone.textContent('#done-title'), /報名完成/);
    await phone.goto(`${url}/exec?page=register&event=${seeded.partyId}`);
    await phone.waitForSelector('#reg-role-box:not([hidden])');
    await phone.check('input[name=role][value=會員]');
    await phone.selectOption('#reg-member', 'M002');
    await shot(phone, '02-register-member', true);
    await phone.click('#reg-submit');
    await phone.waitForSelector('#reg-done:not([hidden])');
    assert.match(await phone.textContent('#done-text'), /陳大華/);
    step('報名頁（例會來賓、邀請人帶入、活動以會員身分報名）');

    // 2. 登入與首頁（電腦）
    const page = watch(await browser.newPage({ viewport: DESKTOP }));
    await page.goto(url + '/exec');
    await page.waitForSelector('#login-view:not([hidden])');
    await page.fill('#login-username', seeded.admin.username);
    await page.fill('#login-password', 'wrong-password');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#login-error:not([hidden])');
    assert.match(await page.textContent('#login-error'), /帳號或密碼錯誤/);
    await page.fill('#login-password', seeded.admin.password);
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#home-body .week');
    assert.match(await page.textContent('.hello h1'), /Joy$/);
    assert.equal(await page.locator('.week button').count(), 7);
    assert.match(await page.textContent('#home-body'), /共識會議/);
    assert.match(await page.textContent('#top-title'), /示範分會/);
    assert.deepEqual(await navItems(page), ['home', 'events', 'dashboard', 'guests', 'checkin', 'showcase', 'wheel', 'followup', 'industry', 'palms',
      'members', 'finance', 'mail', 'line', 'settings']);
    assert.match(await page.textContent('#home-body'), /目前餘額/);
    await shot(page, '03-home-desktop', true);
    step('登入（錯誤密碼擋下）與首頁（這一週、下一場例會與活動）');

    // 3. 簽到：準時、遲到、代理、來賓簽到繳費、現場來賓、出席結果、未簽到記缺席
    await goTo(page, 'checkin');
    await page.waitForSelector('.member-card[data-id=M001]');
    assert.equal(await page.inputValue('#ck-picker select'), MTG);
    assert.equal(await page.locator('.member-card').count(), 12);
    assert.equal(await page.locator('#ck-regs .guest-row').count(), 4);
    await page.click('.member-card[data-id=M001]');
    await page.waitForSelector('.member-card[data-id=M001].st-P:not(.pending)');
    gas.setNow('2026-10-08T07:12:00+08:00');
    await page.click('.member-card[data-id=M002]');
    await page.waitForSelector('.member-card[data-id=M002].st-L:not(.pending)');
    assert.match(await page.textContent('.member-card[data-id=M002] .mc-badge'), /遲到 07:12/);
    await page.click('.member-card[data-id=M001]');
    await page.waitForSelector('#modal:not([hidden])');
    await page.fill('#sub-name', '代理人小陳');
    await page.click('#modal [data-modal-value=S]');
    await page.waitForSelector('.member-card[data-id=M001].st-S:not(.pending)');
    await page.locator('#ck-regs .guest-row').first().locator('[data-act=checkin]').click();
    await page.waitForSelector('#ck-regs .guest-row.is-in');
    await page.locator('#ck-regs .guest-row').first().locator('[data-act=paid]').click();
    await page.waitForFunction(() => document.querySelector('#ck-regs [data-act=paid]').textContent === '已繳費');
    await page.click('#ck-walkin');
    await page.fill('#modal [name=name]', '現場來賓甲');
    await page.fill('#modal [name=category]', '餐飲');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('#ck-regs .guest-row').length === 5);
    await shot(page, '04-checkin', true);
    await page.click('#ck-text');
    assert.match(await page.inputValue('#modal textarea'), /出席 0、遲到 1、代理 1、病假 0、缺席 0、未簽到 10/);
    await page.click('#modal .modal-actions .btn >> nth=0');
    await page.click('#ck-absent');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('.member-card.st-A').length === 10);
    step('簽到（P/L 自動判定、代理、來賓簽到繳費、現場來賓、出席結果、未簽到記缺席）');

    // 4. 列印：預覽截圖 + 實際列印 PDF
    await page.click('.subtabs [data-tab=print]');
    const expectedPages = { memberSheet: 1, guestSheet: 1, guestBadges: 1, guestTents: 5, memberTents: 12 };
    for (const kind of Object.keys(expectedPages)) {
      await page.click(`[data-print=${kind}]`);
      await page.waitForSelector('#print-root:not([hidden]) .print-pages > *');
      await page.waitForTimeout(400);
      await shot(page, 'print-' + kind);
      const pdf = path.join(OUT, 'print-' + kind + '.pdf');
      await page.pdf({ path: pdf, preferCSSPageSize: true, printBackground: true });
      assert.equal(pdfPages(pdf), expectedPages[kind], kind + ' 頁數');
      if (kind === 'guestBadges') {
        const [tab] = await Promise.all([page.context().waitForEvent('page'), page.click('[data-print-action=tab]')]);
        await tab.waitForLoadState();
        assert.equal(await tab.locator('.badge').count(), 5, '新分頁的名牌數');
        await tab.close();
      }
      await page.click('[data-print-action=close]');
      await page.waitForSelector('#print-root', { state: 'hidden' });
    }
    step('列印（會員簽到表、來賓簽到表、名牌、來賓桌牌、會員桌牌；PDF 頁數正確）');

    // 5. 活動管理：停會、新增活動
    await goTo(page, 'events');
    await page.waitForSelector('.ev-row');
    assert.match(await page.textContent('#ev-list'), /共識會議/);
    assert.match(await page.textContent('#ev-list'), /中秋烤肉聯誼/);
    await page.click('.ev-row[data-id="MTG-2026-10-15"]');
    await page.click('#modal .modal-actions >> text=停會');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => {
      const row = document.querySelector('.ev-row[data-id="MTG-2026-10-15"]');
      return row && /停會/.test(row.textContent);
    });
    await page.click('#ev-add');
    await page.selectOption('#modal select[name=type]', '培訓');
    await page.fill('#modal [name=name]', '新會員培訓');
    await page.fill('#modal [name=date]', '2026-10-21');
    await page.fill('#modal [name=startTime]', '19:00');
    await page.fill('#modal [name=endTime]', '21:00');
    await page.check('#modal [name=openRegistration]');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /新會員培訓/.test(document.querySelector('#ev-list').textContent));
    await shot(page, '11-events', true);
    step('活動管理（例會停會、新增培訓）');

    // 6. 報名儀表板
    await goTo(page, 'dashboard');
    await page.waitForSelector('#db-body .grid-2');
    assert.match(await page.textContent('#db-body'), /邀請排行榜/);
    assert.match(await page.textContent('#db-body'), /王小明/);
    await shot(page, '12-dashboard', true);
    step('報名儀表板（未來四週、本月來賓、邀請排行榜、最新報名）');

    // 7. 來賓速覽：只看已到場、投影模式
    await goTo(page, 'showcase');
    await page.waitForSelector('.sc-card');
    assert.equal(await page.locator('.sc-card').count(), 5);
    await page.check('#sc-arrived');
    assert.equal(await page.locator('.sc-card').count(), 2);
    await shot(page, '13-showcase', true);
    await page.click('#sc-present');
    await page.waitForSelector('.stage');
    assert.equal(await page.textContent('#stage-count'), '1 / 2');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.textContent('#stage-count'), '2 / 2');
    await shot(page, '14-showcase-stage');
    await page.click('.stage [data-close]');
    await page.waitForSelector('.stage', { state: 'detached' });
    step('來賓速覽（卡片、只看已到場、投影模式切換）');

    // 8. 幸運轉盤：到場會員抽獎、存紀錄、抽過的人不再抽
    await goTo(page, 'wheel');
    await page.waitForFunction(() => /名單 \d+ 人/.test(document.querySelector('#wh-count').textContent));
    await page.selectOption('#wh-source', 'arrivedMembers');
    assert.equal(await page.textContent('#wh-count'), '名單 2 人');
    await page.fill('#wh-prize', '咖啡券');
    await page.click('#wh-spin');
    await page.waitForSelector('#modal .winner', { timeout: 15000 });
    const winner = (await page.textContent('#modal .winner')).trim();
    assert.ok(['王小明', '陳大華'].includes(winner), '得獎者在名單內：' + winner);
    await shot(page, '15-wheel');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('#wh-history li').length === 1);
    assert.equal(await page.textContent('#wh-count'), '名單 1 人');
    step('幸運轉盤（到場會員抽獎、紀錄、抽過的人移出名單）');

    // 9. 評議與追蹤：簽到的來賓自動加入、改階段與紀錄、轉為會員
    await goTo(page, 'followup');
    await page.waitForSelector('#fu-list .ev-row');
    assert.equal(await page.locator('#fu-list .ev-row').count(), 2, '簽到過的兩位來賓自動加入追蹤');
    await page.click('#fu-list .ev-row:has-text("周品妤")');
    await page.waitForSelector('#modal select[name=stage]');
    await page.selectOption('#modal select[name=stage]', '已聯繫');
    await page.fill('#modal [name=nextDate]', '2026-10-10');
    await page.fill('#modal [name=note]', '已電話聯繫，約下週一對一');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /最新進度：已電話聯繫/.test(document.querySelector('#fu-list').textContent));
    await shot(page, '16-followup', true);
    await page.click('#fu-list .ev-row:has-text("現場來賓甲")');
    await page.waitForSelector('#modal select[name=stage]');
    await page.click('#modal .modal-actions >> text=轉為會員');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /已入會/.test(document.querySelector('#fu-filter').textContent) && !/現場來賓甲/.test(document.querySelector('#fu-list').textContent));
    assert.ok((await page.evaluate(() => App.session.members.map((m) => m.name))).includes('現場來賓甲'), '轉為會員後出現在會員名單');
    step('評議與追蹤（簽到自動加入、改階段與紀錄、轉為會員）');

    // 10. 產業分析：產業群組分布、新增招募目標、來賓檢查
    await goTo(page, 'industry');
    await page.waitForSelector('.bar-row');
    assert.ok(await page.locator('.bar-row').count() >= 8);
    await page.click('#in-add');
    await page.fill('#modal [name=category]', '牙醫');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /蔡宜君/.test((document.querySelector('#in-body table') || {}).textContent || ''));
    assert.match(await page.textContent('#in-body'), /可邀請/);
    await shot(page, '17-industry', true);
    step('產業分析（群組分布、招募目標、來賓專業別檢查）');

    // 5. 活動來賓：名單、個人邀請連結、活動代為登記會員、惡意字串不會被當成 HTML
    gas.api('public.register', { eventId: MTG, name: '<img src=x onerror="window.__xss=1">', category: '測試' });
    await goTo(page, 'guests');
    await page.waitForSelector('#g-table table');
    assert.equal(await page.locator('#g-table tbody tr').count(), 6);
    assert.equal(await page.locator('#g-table img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await page.selectOption('#g-inviter', '王小明');
    assert.match(await page.inputValue('#g-url'), new RegExp(`page=register&event=${MTG}&inviter=%E7%8E%8B%E5%B0%8F%E6%98%8E$`));
    await shot(page, '05-guests', true);
    await page.selectOption('#g-picker select', seeded.partyId);
    await page.waitForFunction(() => /陳大華/.test(document.querySelector('#g-table').textContent));
    await page.click('#g-add');
    await page.check('#modal input[name=role][value=會員]');
    await page.selectOption('#modal select[name=memberId]', 'M003');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /林美麗/.test(document.querySelector('#g-table').textContent));
    assert.equal(await page.locator('#g-table tbody tr').count(), 2);
    step('活動來賓（名單、個人邀請連結、代為登記會員、防止惡意字串）');

    // 6. PALMS 匯入、統計、LINE 週報
    await goTo(page, 'palms');
    const xlsx = path.join(OUT, 'palms-sample.xlsx');
    writeSamplePalms(xlsx);
    await page.setInputFiles('#pm-file', xlsx);
    await page.waitForSelector('#pm-preview:not([hidden])');
    assert.equal(await page.inputValue('#pv-from'), '2026-09-24');
    assert.equal(await page.inputValue('#pv-to'), '2026-09-30');
    assert.match(await page.textContent('#pm-preview'), /黃新人/);
    await shot(page, '06-palms-preview', true);
    await page.click('#pv-save');
    await page.waitForSelector('#pm-periods tbody tr');
    await page.fill('#pm-from', '2026-09-01');
    await page.fill('#pm-to', '2026-10-31');
    await page.click('#pm-run');
    await page.waitForSelector('#pm-summary table');
    assert.equal(await page.locator('#pm-summary tbody tr').count(), 14);
    await page.click('#pm-periods [data-act=line]');
    await page.waitForSelector('#modal textarea');
    assert.match(await page.inputValue('#modal textarea'), /BNI 示範分會｜PALMS 週報/);
    await page.click('#modal .modal-actions .btn >> nth=0');
    step('PALMS（上傳 Excel、自動判斷期間、儲存、統計、LINE 週報）');

    // 7. 系統設定：分會名稱、每週提醒、帳號管理
    await goTo(page, 'settings');
    await page.waitForSelector('#st-form [name=chapterName]');
    await page.waitForSelector('#ac-list table');
    await page.fill('#st-form [name=chapterName]', 'BNI 新名稱分會');
    await page.click('#st-form button[type=submit]');
    await page.waitForFunction(() => /新名稱分會/.test(document.querySelector('#top-title').textContent));
    await page.click('#rm-add');
    await page.selectOption('#modal select[name=weekday]', '四');
    await page.fill('#modal [name=time]', '20:00');
    await page.fill('#modal [name=content]', '明天{{例會時間}}例會');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /明天/.test(document.querySelector('#rm-list').textContent));
    assert.match(await page.textContent('#ac-list'), /amy/);
    await shot(page, '07-settings', true);
    step('系統設定（分會名稱、每週提醒、帳號清單）');

    // 11. 會員名冊：到期篩選、搜尋、新增、改休會、邀請連結、刪除
    await goTo(page, 'members');
    await page.waitForSelector('#mb-list .ev-row');
    assert.equal(await page.locator('#mb-list .ev-row').count(), 14, '在籍會員（含追蹤轉入、PALMS 匯入新增的會員）');
    await page.click('#mb-filter [data-f=expiring]');
    await page.waitForFunction(() => document.querySelectorAll('#mb-list .ev-row').length === 2);
    assert.match(await page.locator('#mb-list .ev-row').first().textContent(), /黃建國12 天後到期/);
    await page.click('#mb-filter [data-f=active]');
    await page.fill('#mb-q', '牙醫');
    await page.waitForFunction(() => document.querySelectorAll('#mb-list .ev-row').length === 1);
    await page.fill('#mb-q', '');
    await page.click('#mb-add');
    await page.fill('#modal [name=name]', '新會員丁');
    await page.fill('#modal [name=company]', '丁丁活動企劃');
    await page.fill('#modal [name=category]', '活動企劃');
    await page.fill('#modal [name=industryGroup]', '行銷設計');
    await page.fill('#modal [name=expiryDate]', '2027-10-31');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('#mb-list .ev-row').length === 15);
    await page.click('#mb-list .ev-row:has-text("新會員丁")');
    await page.selectOption('#modal [name=status]', '休會');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('#mb-list .ev-row').length === 14 && /休會 1/.test(document.querySelector('#mb-filter').textContent));
    await page.click('#mb-list .ev-row:has-text("王小明")');
    await page.click('#modal .modal-actions >> text=邀請連結');
    await page.waitForSelector('#modal .link-box input');
    assert.match(await page.inputValue('#modal .link-box input'), /page=register&inviter=%E7%8E%8B%E5%B0%8F%E6%98%8E$/);
    await page.click('#modal .modal-actions .btn');
    await shot(page, '18-members', true);
    await page.click('#mb-filter [data-f="休會"]');
    await page.click('#mb-list .ev-row:has-text("新會員丁")');
    await page.click('#modal .modal-actions >> text=刪除');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /休會 0/.test(document.querySelector('#mb-filter').textContent));
    step('會員名冊（到期篩選、搜尋、新增、改休會、邀請連結、刪除）');

    // 12. 財務中心：簽到繳費自動入帳、記支出與作廢、月費一次繳兩個月與作廢、月結
    await goTo(page, 'finance');
    await page.waitForSelector('#fi-body table.data');
    assert.match(await page.textContent('#fi-body'), /來賓費周品妤/, '簽到頁標記繳費自動記一筆來賓費');
    assert.match(await page.textContent('#fi-body .stat-row'), /NT\$11,000/);
    await page.click('[data-add=支出]');
    await page.selectOption('#modal [name=category]', '文具印刷');
    await page.fill('#modal [name=amount]', '880');
    await page.fill('#modal [name=note]', '名牌套');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /名牌套/.test(document.querySelector('#fi-body').textContent));
    await page.click('#fi-body tr:has-text("名牌套") [data-void]');
    await page.click('#modal .btn-danger');
    assert.equal(await page.isVisible('#modal [name=reason]'), true, '沒填作廢原因不能作廢');
    await page.fill('#modal [name=reason]', '金額打錯');
    await page.click('#modal .btn-danger');
    await page.waitForSelector('#fi-body tr.dim:has-text("名牌套")');
    await shot(page, '19-finance', true);
    await page.click('#fi-tabs [data-tab=dues]');
    await page.waitForSelector('table.dues');
    await page.click('[data-cell="M008|2026-10"]');
    await page.check('#modal input[name=months][value="2026-11"]');
    assert.match(await page.textContent('#fi-sum'), /合計 NT\$3,000（2 個月）/);
    await page.click('#modal .btn-primary');
    await page.waitForSelector('.dues-cell.paid [data-cell="M008|2026-11"]');
    await shot(page, '20-finance-dues', true);
    await page.click('[data-cell="M008|2026-11"]');
    await page.waitForSelector('#modal [name=reason]');
    assert.match(await page.textContent('#modal'), /10月、11月/);
    await page.fill('#modal [name=reason]', '收錯人');
    await page.click('#modal .btn-danger');
    await page.waitForSelector('.dues-cell.due [data-cell="M008|2026-10"]');
    await page.click('#fi-tabs [data-tab=monthly]');
    await page.waitForSelector('tr[data-month="2026-10"]');
    await shot(page, '21-finance-monthly', true);
    await page.click('tr[data-month="2026-09"]');
    await page.waitForFunction(() => document.querySelector('#fi-month') && document.querySelector('#fi-month').value === '2026-09');
    step('財務中心（簽到繳費自動入帳、記支出與作廢、一次繳兩個月與作廢、月結）');

    // 13. 信件管理：範本 → 已簽到來賓 → 預覽 → 寄出；新增範本（插入欄位）；寄信紀錄
    await goTo(page, 'mail');
    await page.waitForSelector('#ml-tpl');
    await page.selectOption('#ml-tpl', { label: '感謝來賓蒞臨' });
    assert.match(await page.inputValue('#ml-subject'), /感謝您蒞臨/);
    await page.selectOption('#ml-group', 'eventArrived');
    await page.waitForSelector('#ml-event select:not([disabled])');
    await page.selectOption('#ml-event select', MTG);
    await page.click('#ml-preview');
    await page.waitForSelector('#ml-result:not([hidden]) .mail-sample');
    assert.match(await page.textContent('#ml-result'), /收件人 1 位・略過 1 位/);
    assert.match(await page.textContent('#ml-result .mail-text'), /^周品妤 您好/);
    await shot(page, '22-mail', true);
    await page.fill('#ml-subject', '感謝您蒞臨 BNI 新名稱分會！');
    assert.equal(await page.isVisible('#ml-result'), false, '改過內容要重新預覽才能寄');
    await page.click('#ml-preview');
    await page.click('#ml-send');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /已寄出 1 封/.test(document.querySelector('#ml-result').textContent));
    assert.deepEqual(gas.outbox.map((m) => [m.to, m.subject, m.name]), [['pinyu@example.com', '感謝您蒞臨 BNI 新名稱分會！', 'BNI 新名稱分會']]);
    await page.click('.subtabs [data-tab=templates]');
    await page.click('[data-act=add]');
    await page.fill('#modal [name=name]', '測試範本');
    await page.fill('#modal [name=subject]', '測試主旨');
    await page.click('#modal [name=body]');
    await page.click('#modal [data-field="活動日期"]');
    assert.equal(await page.inputValue('#modal [name=body]'), '{{活動日期}}');
    await page.click('#modal .btn-primary');
    await page.waitForSelector('.ev-row:has-text("測試範本")');
    await page.click('.subtabs [data-tab=log]');
    await page.waitForSelector('[data-tab-body] table');
    assert.match(await page.textContent('[data-tab-body] table'), /pinyu@example\.com/);
    step('信件管理（範本、已簽到來賓、預覽、改內容要重新預覽、寄出、插入欄位、寄信紀錄）');

    // 14. LINE 小助理：Token、綁定群組、自動推播開關、產生文字、推播、額度、紀錄
    await goTo(page, 'line');
    await page.waitForSelector('#ln-compose');
    await page.click('.subtabs [data-tab=bot]');
    await page.waitForSelector('#ln-token-form');
    await page.fill('#ln-token-form [name=token]', 'dev-token-' + 'x'.repeat(30));
    await page.click('#ln-token-form [type=submit]');
    await page.waitForSelector('#ln-bind');
    await page.click('#ln-bind');
    await page.waitForSelector('.bind-code');
    const bindCode = (await page.textContent('.bind-code')).replace(/\D/g, '');
    assert.match(simulateLineText(gas, '綁定 ' + bindCode), /已綁定「BNI 示範分會群組」/);
    await page.click('[data-reload]');
    await page.waitForSelector('#ln-groups li');
    await page.check('#ln-cron');
    await page.waitForFunction(() => !document.querySelector('#ln-cron').disabled);
    assert.deepEqual(gas.triggers.map((t) => t.getHandlerFunction()), ['cronHourly']);
    await shot(page, '23-line-bot', true);
    await page.click('.subtabs [data-tab=send]');
    await page.waitForSelector('#ln-push');
    await page.selectOption('#ln-event select', MTG);
    await page.click('#ln-compose');
    await page.waitForFunction(() => /BNI 新名稱分會】例會提醒/.test(document.querySelector('#ln-text').value));
    assert.match(await page.getAttribute('#ln-share', 'href'), /^https:\/\/line\.me\/R\/share\?text=%E3%80%90/);
    await page.click('#ln-push');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => /已推播到 1 個群組/.test(document.querySelector('#toast').textContent));
    assert.equal(gas.requests.filter((r) => r.url.endsWith('/message/push')).length, 1);
    await page.selectOption('#ln-kind', 'attendance');
    await page.click('#ln-compose');
    await page.waitForFunction(() => /出席結果/.test(document.querySelector('#ln-text').value));
    await page.click('#ln-quota');
    await page.waitForFunction(() => /還剩 136 則/.test(document.querySelector('#ln-quota-box').textContent));
    await shot(page, '24-line', true);
    await page.click('.subtabs [data-tab=log]');
    await page.waitForSelector('[data-tab-body] table');
    assert.match(await page.textContent('[data-tab-body] table'), /BNI 示範分會群組/);
    step('LINE 小助理（Token、綁定群組、自動推播開關、產生文字、推播、額度、紀錄）');

    // 8. 手機版：首頁、底部分頁、側邊選單
    const mobile = watch(await browser.newPage(PHONE));
    await login(mobile, url, seeded.admin);
    await mobile.waitForSelector('#home-body .week');
    assert.equal(await mobile.isVisible('#bottom-nav'), true);
    await shot(mobile, '08-home-phone', true);
    await mobile.click('#menu-btn');
    await mobile.waitForSelector('#drawer.open');
    await mobile.waitForTimeout(300);
    await shot(mobile, '09-drawer-phone');
    await mobile.click('#drawer-close');
    await mobile.click('#bottom-nav [data-go=checkin]');
    await mobile.waitForSelector('.member-card');
    await shot(mobile, '10-checkin-phone');
    await goTo(mobile, 'finance');
    await mobile.waitForSelector('#fi-body table.data');
    await mobile.click('#fi-tabs [data-tab=dues]');
    await mobile.waitForSelector('table.dues');
    await shot(mobile, '25-finance-dues-phone');
    step('手機版（首頁、側邊選單、底部分頁、月費繳納表）');

    // 9. 權限：來賓接待只看得到自己的功能
    const staff = watch(await browser.newPage({ viewport: DESKTOP }));
    await login(staff, url, seeded.staff);
    assert.deepEqual(await navItems(staff), ['home', 'events', 'guests', 'checkin', 'showcase', 'wheel', 'line']);
    assert.match(await staff.textContent('#who-title'), /來賓接待/);
    await goTo(staff, 'events');
    await staff.waitForSelector('.ev-row');
    assert.equal(await staff.isVisible('#ev-add'), false, '來賓接待不能新增活動');
    await goTo(staff, 'line');
    await staff.waitForSelector('#ln-push');
    assert.equal(await staff.locator('.subtabs [data-tab=bot]').count(), 0, '來賓接待不能設定機器人');
    step('權限（來賓接待只看到自己的功能，活動只能看，LINE 只能發送）');

    assert.deepEqual(errors, [], '瀏覽器錯誤');
    console.log('\n全部通過，截圖與 PDF：' + OUT);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
