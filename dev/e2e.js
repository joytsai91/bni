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
const { start } = require('./server');
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
    assert.deepEqual(await navItems(page), ['home', 'guests', 'checkin', 'palms', 'settings']);
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
    step('手機版（首頁、側邊選單、底部分頁）');

    // 9. 權限：來賓接待只看得到自己的功能
    const staff = watch(await browser.newPage({ viewport: DESKTOP }));
    await login(staff, url, seeded.staff);
    assert.deepEqual(await navItems(staff), ['home', 'guests', 'checkin']);
    assert.match(await staff.textContent('#who-title'), /來賓接待/);
    step('權限（來賓接待只看到首頁、活動來賓、簽到與列印）');

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
