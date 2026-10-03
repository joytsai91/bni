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

async function login(page, url, pin) {
  await page.goto(url + '/exec');
  await page.waitForSelector('#login-view:not([hidden])');
  await page.fill('#pin-input', pin);
  await page.click('#login-form button[type=submit]');
  await page.waitForSelector('.member-card');
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
    // 1. 來賓報名（手機，帶入個人邀請連結）
    const phone = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }));
    await phone.goto(url + '/exec?page=register&inviter=' + encodeURIComponent('林美麗'));
    await phone.waitForSelector('#reg-form:not([hidden])');
    assert.equal(await phone.textContent('#reg-title'), 'BNI 示範分會｜來賓報名');
    assert.equal(await phone.inputValue('#reg-inviter'), '林美麗');
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
    await shot(phone, '02-register-done');
    step('來賓報名（邀請人自動帶入、必填檢查、送出）');

    // 2. 管理登入
    const page = watch(await browser.newPage({ viewport: { width: 1280, height: 900 } }));
    await page.goto(url + '/exec');
    await page.waitForSelector('#login-view:not([hidden])');
    await page.fill('#pin-input', '0000');
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('#login-error:not([hidden])');
    assert.match(await page.textContent('#login-error'), /管理密碼錯誤/);
    await page.fill('#pin-input', seeded.pin);
    await page.click('#login-form button[type=submit]');
    await page.waitForSelector('.member-card');
    assert.equal(await page.inputValue('#meeting-date'), '2026-10-08');
    assert.equal(await page.locator('.member-card').count(), 12);
    assert.equal(await page.locator('.guest-row').count(), 4);
    step('管理登入（錯誤密碼擋下、正確密碼進入）');

    // 3. 簽到：準時、遲到、代理、來賓簽到繳費、現場來賓、未簽到記缺席
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
    assert.match(await page.textContent('.member-card[data-id=M001] .mc-badge'), /代理・代理人小陳/);
    await page.locator('.guest-row').first().locator('[data-act=checkin]').click();
    await page.waitForSelector('.guest-row.is-in');
    await page.locator('.guest-row').first().locator('[data-act=paid]').click();
    await page.waitForFunction(() => document.querySelector('.guest-row [data-act=paid]').textContent === '已繳費');
    await page.click('#walkin-btn');
    await page.fill('#modal [name=name]', '現場來賓甲');
    await page.fill('#modal [name=category]', '餐飲');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('.guest-row').length === 5);
    await shot(page, '03-checkin', true);
    await page.click('#attendance-text-btn');
    assert.match(await page.inputValue('#modal textarea'), /出席 0、遲到 1、代理 1、病假 0、缺席 0、未簽到 10/);
    await shot(page, '04-attendance-text');
    await page.click('#modal .modal-actions .btn >> nth=0');
    await page.click('#mark-absent-btn');
    await page.click('#modal .btn-primary');
    await page.waitForFunction(() => document.querySelectorAll('.member-card.st-A').length === 10);
    step('簽到（P/L 自動判定、代理、來賓簽到繳費、現場來賓、出席結果、未簽到記缺席）');

    // 4. 手機版簽到畫面
    const phoneAdmin = watch(await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }));
    await login(phoneAdmin, url, seeded.pin);
    await shot(phoneAdmin, '05-checkin-phone');
    step('手機版簽到畫面');

    // 5. 列印：預覽截圖 + 實際列印 PDF
    await page.click('#tabs [data-tab=print]');
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

    // 6. PALMS 匯入、統計、LINE 週報
    await page.click('#tabs [data-tab=palms]');
    const xlsx = path.join(OUT, 'palms-sample.xlsx');
    writeSamplePalms(xlsx);
    await page.setInputFiles('#palms-file', xlsx);
    await page.waitForSelector('#palms-preview:not([hidden])');
    assert.equal(await page.inputValue('#pv-from'), '2026-09-24');
    assert.equal(await page.inputValue('#pv-to'), '2026-09-30');
    assert.match(await page.textContent('#palms-preview'), /黃新人/);
    await shot(page, '06-palms-preview', true);
    await page.click('#pv-save');
    await page.waitForSelector('#palms-periods tbody tr');
    await page.fill('#sum-from', '2026-09-01');
    await page.fill('#sum-to', '2026-10-31');
    await page.click('#sum-run');
    await page.waitForSelector('#palms-summary table');
    assert.equal(await page.locator('#palms-summary tbody tr').count(), 14); // 13 位 + 合計
    await shot(page, '07-palms-summary', true);
    await page.click('#palms-periods [data-act=line]');
    await page.waitForSelector('#modal textarea');
    assert.match(await page.inputValue('#modal textarea'), /BNI 示範分會｜PALMS 週報/);
    await shot(page, '08-palms-line');
    await page.click('#modal .modal-actions .btn >> nth=0');
    step('PALMS（上傳 Excel、自動判斷期間、儲存、統計、LINE 週報）');

    // 7. 來賓分頁：名單、個人邀請連結；惡意字串不會被當成 HTML
    gas.api('guest.register', { date: '2026-10-08', name: '<img src=x onerror="window.__xss=1">', category: '測試' });
    await page.click('#tabs [data-tab=guests]');
    await page.waitForSelector('#guest-table table');
    assert.equal(await page.locator('#guest-table tbody tr').count(), 6);
    assert.equal(await page.locator('#guest-table img').count(), 0);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await page.selectOption('#link-inviter', '王小明');
    assert.match(await page.inputValue('#register-url'), /page=register&inviter=%E7%8E%8B%E5%B0%8F%E6%98%8E$/);
    await shot(page, '09-guests', true);
    step('來賓名單、個人邀請連結、防止惡意字串');

    // 8. 設定
    await page.click('#tabs [data-tab=settings]');
    await page.fill('#settings-form [name=chapterName]', 'BNI 新名稱分會');
    await page.click('#settings-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#chapter-name').textContent === 'BNI 新名稱分會');
    await shot(page, '10-settings', true);
    step('設定儲存');

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
