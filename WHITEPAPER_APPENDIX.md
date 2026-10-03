# BNI 分會管理系統：技術附錄

這份文件是規格：程式架構、資料表欄位、設定項目、權限代碼、API 路由、指令碼屬性與外部服務。業務規則與設計理由看 [WHITEPAPER.md](WHITEPAPER.md)，操作與現況看 [README.md](README.md)。

> 資料表、設定、權限、API 這幾張表是從 `src/Config.js` 與 `src/Code.js` 直接產生的；改程式時請一併更新這裡。

## A. 架構

```
瀏覽器（App.html／Register.html）
  └─ google.script.run.apiCall({ action, data, token })
       └─ Code.js apiCall：查路由 → 驗證 token（Auth.js）→ 檢查權限 → 執行
            └─ 各模組（Events、Guests、Attendance、Finance、Messages、Line…）
                 └─ Db.js：讀寫 Google 試算表（依標題對應欄位、同一請求快取、寫入加鎖）
LINE 平台 ── POST /exec ──→ Line.js doPost（綁定群組）
時間觸發器 ── 每小時 ──→ Line.js cronHourly（每週提醒推播）
```

| 檔案 | 負責 |
| --- | --- |
| `Code.js` | 網頁入口 `doGet`、試算表選單、API 路由表 `apiRoutes_`、`apiCall`、限流 `throttle_`、時間工具 |
| `Auth.js` | 密碼雜湊、token、登入鎖定、帳號管理、選單建立管理員與重設密碼 |
| `Config.js` | 設定項目、權限代碼、角色、資料表定義 `sheetDefs_`、範本欄位與預設範本 |
| `Db.js` | 試算表讀寫：`Db.read／append／update／softDelete`、`withLock_`、`newId_` |
| `Lib.js` | 純邏輯（可在 Node 單元測試）：日期、PALMS 解析、權限判斷、範本代換、月份、出席結果文字 |
| `Events.js` | 每週例會產生與覆寫、活動 CRUD、活動管理頁、報名儀表板 |
| `Guests.js` | 報名（公開、代登、現場）、繳費連動 `paymentChanges_`、簽到連動 `afterRegistrationChange_` |
| `Attendance.js` | 會員點名、未簽到記缺席、列印資料、出席結果文字 |
| `Meeting.js` | 來賓速覽、幸運轉盤 |
| `Followups.js` | 評議與追蹤、簽到自動建立追蹤、轉為會員、我的追蹤 |
| `Industry.js` | 產業分析、招募目標 |
| `Members.js` | 會員名冊、會員ID 自動補號、會籍到期 |
| `Finance.js` | 收支帳、作廢連動、報名繳費自動入帳、會員月費、月結、首頁財務卡片 |
| `Messages.js` | 訊息範本、收件人、Email 預覽與寄送、發送紀錄 |
| `Line.js` | LINE API、群組綁定 Webhook `doPost`、推播、額度、每小時排程 `cronHourly` |
| `Palms.js` | PALMS 預覽、匯入、統計、LINE 週報 |
| `Home.js`、`Settings.js` | 首頁資料、分會設定與每週提醒 |
| `Common.html` | 前端共用：API 呼叫、跳脫、提示、對話框、按鈕鎖定 `App.withButton`、活動選單 |
| `ShellJs.html` | 登入、側邊選單、底部分頁、換頁 |
| `Page*.html` | 各功能頁；`PageMail.html` 另外提供共用的範本管理、發送紀錄、分頁元件 |
| `Print*.html` | 簽到表、名牌、桌牌列印 |

### A.1 API 慣例

- 網頁只呼叫 `apiCall`；回傳 `{ ok: true, data }` 或 `{ ok: false, error, code }`，`code` 為 `AUTH` 時前端回到登入畫面。
- 名稱以底線結尾的函式是私有的，網頁無法直接呼叫；公開函式只有 `doGet`、`doPost`、`include`、`apiCall`、`onOpen`、選單函式與 `cronHourly`。
- 路由的 `perm` 可以是單一代碼或陣列（有其中一個就可以）；`public: true` 不用登入。

### A.2 Db 層

- 每張表第一列是標題；欄位依標題文字對應，找不到的欄位會自動補在最右邊。
- 同一次請求內同一張表只讀一次；`withLock_` 進入時清空快取並取得指令碼鎖（最多等 20 秒），可巢狀呼叫。
- 寫入的文字經過 `toSheetText`：開頭是 `= + - @ '`、或看起來像數字／日期的字串前面加 `'`，避免公式執行、電話掉 0、日期被轉換。
- 有「已刪除」欄的表，`Db.read` 預設不回傳已刪除的列；`softDelete` 只把那欄標成「是」。

## B. 資料表

### 設定（`settings`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 項目 | `item` | 文字 |
| 內容 | `value` | 文字 |
| 說明 | `note` | 文字 |

### 帳號（`accounts`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 帳號ID | `id` | 文字 |
| 帳號 | `username` | 文字 |
| 顯示名稱 | `displayName` | 文字 |
| 職稱 | `title` | 文字 |
| 角色 | `roles` | 文字 |
| 會員ID | `memberId` | 文字 |
| Email | `email` | 文字 |
| 狀態 | `status` | 文字 |
| 最後登入 | `lastLoginAt` | 文字 |
| 建立時間 | `createdAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 會員名單（`members`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 會員ID | `id` | 文字 |
| 姓名 | `name` | 文字 |
| 公司 | `company` | 文字 |
| 專業別 | `category` | 文字 |
| 產業群組 | `industryGroup` | 文字 |
| 分會職務 | `position` | 文字 |
| 手機 | `phone` | 電話 |
| Email | `email` | 文字 |
| LINE ID | `lineId` | 文字 |
| 入會日 | `joinDate` | 文字 |
| 到期日 | `expiryDate` | 文字 |
| 引薦人 | `sponsor` | 文字 |
| 狀態 | `status` | 文字 |
| 備註 | `note` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 活動（`events`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 活動ID | `id` | 文字 |
| 類型 | `type` | 文字 |
| 名稱 | `name` | 文字 |
| 日期 | `date` | 文字 |
| 開始時間 | `startTime` | 文字 |
| 結束時間 | `endTime` | 文字 |
| 地點 | `place` | 文字 |
| 開放報名 | `openRegistration` | 文字 |
| 費用 | `fee` | 文字 |
| 名額 | `capacity` | 文字 |
| 說明 | `description` | 文字 |
| 狀態 | `status` | 文字 |
| 建立者 | `createdBy` | 文字 |
| 建立時間 | `createdAt` | 文字 |
| 更新時間 | `updatedAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 報名名單（`registrations`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 報名ID | `id` | 文字 |
| 活動ID | `eventId` | 文字 |
| 活動日期 | `eventDate` | 文字 |
| 身分 | `role` | 文字 |
| 會員ID | `memberId` | 文字 |
| 姓名 | `name` | 文字 |
| 公司 | `company` | 文字 |
| 專業別 | `category` | 文字 |
| 手機 | `phone` | 電話 |
| Email | `email` | 文字 |
| 邀請人 | `inviter` | 文字 |
| 來源 | `source` | 文字 |
| 簽到時間 | `checkedInAt` | 文字 |
| 已繳費 | `paid` | 文字 |
| 繳費金額 | `paidAmount` | 數字 |
| 帳目ID | `ledgerId` | 文字 |
| 備註 | `note` | 文字 |
| 建立時間 | `createdAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 會員出席（`attendance`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 例會日期 | `date` | 文字 |
| 會員ID | `memberId` | 文字 |
| 姓名 | `name` | 文字 |
| 狀態 | `status` | 文字 |
| 代理人 | `substitute` | 文字 |
| 簽到時間 | `checkedInAt` | 文字 |
| 更新時間 | `updatedAt` | 文字 |

### 每週提醒（`reminders`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 提醒ID | `id` | 文字 |
| 星期 | `weekday` | 文字 |
| 時間 | `time` | 文字 |
| 內容 | `content` | 文字 |
| 推播LINE | `pushLine` | 文字 |
| 啟用 | `enabled` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 抽獎紀錄（`wheel`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 紀錄ID | `id` | 文字 |
| 活動ID | `eventId` | 文字 |
| 活動日期 | `eventDate` | 文字 |
| 獎項 | `prize` | 文字 |
| 得獎者 | `winner` | 文字 |
| 名單人數 | `poolSize` | 數字 |
| 操作人 | `drawnBy` | 文字 |
| 抽獎時間 | `drawnAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 追蹤名單（`leads`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 追蹤ID | `id` | 文字 |
| 姓名 | `name` | 文字 |
| 公司 | `company` | 文字 |
| 專業別 | `category` | 文字 |
| 手機 | `phone` | 電話 |
| Email | `email` | 文字 |
| 邀請人 | `inviter` | 文字 |
| 首次來訪 | `firstVisit` | 文字 |
| 最近來訪 | `lastVisit` | 文字 |
| 來訪活動 | `visitEvents` | 文字 |
| 來訪次數 | `visits` | 數字 |
| 階段 | `stage` | 文字 |
| 負責人 | `owner` | 文字 |
| 下次追蹤日 | `nextDate` | 文字 |
| 最新進度 | `latest` | 文字 |
| 會員ID | `memberId` | 文字 |
| 建立時間 | `createdAt` | 文字 |
| 更新時間 | `updatedAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 追蹤紀錄（`leadLogs`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 紀錄ID | `id` | 文字 |
| 追蹤ID | `leadId` | 文字 |
| 時間 | `at` | 文字 |
| 記錄人 | `by` | 文字 |
| 階段 | `stage` | 文字 |
| 內容 | `content` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 招募目標（`targets`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 目標ID | `id` | 文字 |
| 專業別 | `category` | 文字 |
| 產業群組 | `industryGroup` | 文字 |
| 優先度 | `priority` | 文字 |
| 備註 | `note` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 收支帳（`ledger`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 帳目ID | `id` | 文字 |
| 日期 | `date` | 文字 |
| 類型 | `type` | 文字 |
| 科目 | `category` | 文字 |
| 金額 | `amount` | 數字 |
| 對象 | `party` | 文字 |
| 說明 | `note` | 文字 |
| 關聯ID | `relatedId` | 文字 |
| 經手人 | `handledBy` | 文字 |
| 狀態 | `status` | 文字 |
| 作廢原因 | `voidReason` | 文字 |
| 作廢人 | `voidedBy` | 文字 |
| 作廢時間 | `voidedAt` | 文字 |
| 建立時間 | `createdAt` | 文字 |

### 會費紀錄（`dues`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 會費ID | `id` | 文字 |
| 會員ID | `memberId` | 文字 |
| 姓名 | `name` | 文字 |
| 月份 | `month` | 文字 |
| 金額 | `amount` | 數字 |
| 繳費日 | `paidDate` | 文字 |
| 帳目ID | `ledgerId` | 文字 |
| 經手人 | `handledBy` | 文字 |
| 狀態 | `status` | 文字 |
| 建立時間 | `createdAt` | 文字 |

### 訊息範本（`templates`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 範本ID | `id` | 文字 |
| 管道 | `channel` | 文字 |
| 名稱 | `name` | 文字 |
| 主旨 | `subject` | 文字 |
| 內容 | `body` | 文字 |
| 更新時間 | `updatedAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

### 發送紀錄（`sendLog`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 紀錄ID | `id` | 文字 |
| 時間 | `at` | 文字 |
| 管道 | `channel` | 文字 |
| 範本 | `template` | 文字 |
| 對象 | `recipient` | 文字 |
| 信箱／群組 | `address` | 文字 |
| 主旨 | `subject` | 文字 |
| 結果 | `result` | 文字 |
| 發送人 | `by` | 文字 |

### PALMS（`palms`）

| 欄位標題 | 程式 key | 型別 |
| --- | --- | --- |
| 期間起 | `from` | 文字 |
| 期間迄 | `to` | 文字 |
| 姓名 | `name` | 文字 |
| P | `P` | 數字 |
| A | `A` | 數字 |
| L | `L` | 數字 |
| M | `M` | 數字 |
| S | `S` | 數字 |
| RGI | `RGI` | 數字 |
| RGO | `RGO` | 數字 |
| RRI | `RRI` | 數字 |
| RRO | `RRO` | 數字 |
| V | `V` | 數字 |
| 1-2-1 | `121` | 數字 |
| TYFCB | `TYFCB` | 數字 |
| CEU | `CEU` | 數字 |
| T | `T` | 數字 |
| 匯入時間 | `importedAt` | 文字 |
| 已刪除 | `deleted` | 文字 |

## C. 分會設定（「設定」工作表）

| 項目 | key | 預設值 | 說明 |
| --- | --- | --- | --- |
| 系統名稱 | `systemName` | 分會管理系統 | 顯示在選單最上方 |
| 分會名稱 | `chapterName` | BNI 台中市中心區湧泉分會 | 顯示在畫面、簽到表、名牌與桌牌上 |
| 例會星期 | `meetingWeekday` | 四 | 填 一～日，系統每週自動排出例會 |
| 例會時間 | `meetingTime` | 07:00 | 例會開始時間 |
| 例會結束時間 | `meetingEndTime` | 09:00 |  |
| 例會地點 | `meetingPlace` | （空白） | 顯示在首頁、報名頁與提醒訊息 |
| 遲到判定時間 | `lateAfter` | 07:00 | 超過這個時間才簽到，自動記為遲到 (L) |
| 來賓費用 | `guestFee` | （空白） | 例如 500；留空代表不收費 |
| 每月會費 | `monthlyDues` | （空白） | 會員月費繳納表的預設金額 |
| 期初餘額 | `openingBalance` | 0 | 財務中心計算累計餘額用 |
| 到期提醒天數 | `expiryNoticeDays` | 60 | 會籍到期前幾天開始在首頁提醒 |
| 寄件人名稱 | `mailSenderName` | （空白） | 寄信時顯示的名稱，留空就用分會名稱 |
| 回覆信箱 | `replyTo` | （空白） | 收件人按「回覆」時寄到這個信箱 |
| 名牌寬度(mm) | `badgeWidth` | 90 | 依名牌套內卡尺寸調整 |
| 名牌高度(mm) | `badgeHeight` | 55 |  |
| 缺席提醒次數 | `absenceAlert` | 3 | PALMS 統計期間內缺席達到這個次數就標示提醒 |

## D. 權限代碼與角色

代碼格式 `{模組}.{資源}.{動作}`。

| 代碼 | 名稱 |
| --- | --- |
| `home.dashboard.view` | 首頁 |
| `events.event.view` | 查看活動 |
| `events.event.manage` | 管理活動 |
| `events.dashboard.view` | 報名儀表板 |
| `guests.registration.view` | 查看活動來賓 |
| `guests.registration.manage` | 管理活動來賓 |
| `checkin.attendance.manage` | 簽到 |
| `checkin.print.view` | 列印 |
| `meeting.showcase.view` | 來賓速覽 |
| `meeting.wheel.use` | 幸運轉盤 |
| `followup.lead.view` | 查看評議與追蹤 |
| `followup.lead.manage` | 管理評議與追蹤 |
| `analysis.industry.view` | 產業分析 |
| `analysis.target.manage` | 管理招募目標 |
| `palms.report.view` | 查看 PALMS |
| `palms.report.manage` | 匯入 PALMS |
| `members.member.view` | 查看會員名冊 |
| `members.member.manage` | 管理會員名冊 |
| `finance.ledger.view` | 查看財務 |
| `finance.ledger.manage` | 記帳與作廢 |
| `finance.dues.manage` | 收月費 |
| `messages.email.send` | 寄信 |
| `messages.template.manage` | 管理訊息範本 |
| `line.message.send` | LINE 小助理 |
| `line.bot.manage` | 設定 LINE 機器人 |
| `system.settings.manage` | 系統設定 |
| `system.account.manage` | 帳號管理 |

角色授權規則：`*` 是全部、`finance.*` 是整組、前面加 `-` 是排除。每個登入的人另外都有 `home.dashboard.view`、`events.event.view`。

| 角色 | 授權規則 | 說明 |
| --- | --- | --- |
| 系統管理員 | `*` | 全部功能 |
| 主席團 | `*`、`-system.account.manage` | 全部功能，但不能管理帳號 |
| 財務 | `finance.*`、`members.member.view`、`guests.registration.view` | 財務中心；會員名冊、活動來賓只能看 |
| 會員委員會 | `followup.*`、`analysis.*`、`members.*`、`guests.registration.*` | 評議與追蹤、產業分析、會員名冊、活動來賓 |
| 來賓接待 | `checkin.*`、`guests.registration.*`、`meeting.*`、`line.message.send` | 簽到與列印、活動來賓、來賓速覽、幸運轉盤、LINE 小助理 |

## E. API 路由

| action | 權限 | 伺服器函式 |
| --- | --- | --- |
| `public.bootstrap` | 公開 | `publicBootstrap_` |
| `public.register` | 公開 | `registerPublic_` |
| `auth.status` | 公開 | `authStatus_` |
| `auth.login` | 公開 | `login_` |
| `app.bootstrap` | 登入即可 | `appBootstrap_` |
| `auth.changePassword` | 登入即可 | `changeOwnPassword_` |
| `home.data` | `home.dashboard.view` | `homeData_` |
| `events.options` | `events.event.view` | `eventOptions_` |
| `events.page` | `events.event.view` | `eventsPage_` |
| `events.dashboard` | `events.dashboard.view` | `registrationDashboard_` |
| `events.list` | `events.event.view` | `listEvents_` |
| `events.get` | `events.event.view` | `getEvent_` |
| `events.save` | `events.event.manage` | `saveEvent_` |
| `events.status` | `events.event.manage` | `setEventStatus_` |
| `events.delete` | `events.event.manage` | `deleteEvent_` |
| `registrations.list` | `guests.registration.view` | `listRegistrations_` |
| `registrations.add` | `guests.registration.manage` | `addRegistrationByAdmin_` |
| `registrations.walkin` | `guests.registration.manage` 或 `checkin.attendance.manage` | `addWalkin_` |
| `registrations.update` | `guests.registration.manage` 或 `checkin.attendance.manage` | `updateRegistration_` |
| `registrations.delete` | `guests.registration.manage` | `deleteRegistration_` |
| `checkin.board` | `checkin.attendance.manage` 或 `checkin.print.view` | `checkinBoard_` |
| `checkin.member` | `checkin.attendance.manage` | `setMemberStatus_` |
| `checkin.markAbsent` | `checkin.attendance.manage` | `markUncheckedAbsent_` |
| `checkin.attendanceText` | `checkin.attendance.manage` 或 `checkin.print.view` 或 `line.message.send` | `attendanceText_` |
| `print.data` | `checkin.print.view` | `printData_` |
| `meeting.showcase` | `meeting.showcase.view` | `showcaseData_` |
| `meeting.wheel` | `meeting.wheel.use` | `wheelData_` |
| `meeting.wheelRecord` | `meeting.wheel.use` | `recordWheel_` |
| `meeting.wheelDelete` | `meeting.wheel.use` | `deleteWheelRecord_` |
| `followup.list` | `followup.lead.view` | `listLeads_` |
| `followup.get` | `followup.lead.view` | `getLead_` |
| `followup.create` | `followup.lead.manage` | `createLead_` |
| `followup.update` | `followup.lead.manage` | `updateLead_` |
| `followup.convert` | `followup.lead.manage` | `convertLead_` |
| `followup.delete` | `followup.lead.manage` | `deleteLead_` |
| `industry.analysis` | `analysis.industry.view` | `industryAnalysis_` |
| `industry.saveTarget` | `analysis.target.manage` | `saveTarget_` |
| `industry.deleteTarget` | `analysis.target.manage` | `deleteTarget_` |
| `palms.preview` | `palms.report.manage` | `previewPalms_` |
| `palms.save` | `palms.report.manage` | `savePalms_` |
| `palms.periods` | `palms.report.view` | `listPalmsPeriods_` |
| `palms.summary` | `palms.report.view` | `palmsSummary_` |
| `palms.lineText` | `palms.report.view` | `palmsLineText_` |
| `palms.delete` | `palms.report.manage` | `deletePalmsPeriod_` |
| `members.list` | `members.member.view` | `listMembers_` |
| `members.save` | `members.member.manage` | `saveMember_` |
| `members.delete` | `members.member.manage` | `deleteMember_` |
| `finance.page` | `finance.ledger.view` | `financePage_` |
| `finance.create` | `finance.ledger.manage` | `createLedger_` |
| `finance.void` | `finance.ledger.manage` | `voidLedger_` |
| `finance.dues` | `finance.ledger.view` 或 `finance.dues.manage` | `duesPage_` |
| `finance.payDues` | `finance.dues.manage` | `payDues_` |
| `finance.voidDues` | `finance.dues.manage` | `voidDues_` |
| `messages.templates` | `messages.email.send` 或 `messages.template.manage` 或 `line.message.send` | `listTemplates_` |
| `messages.saveTemplate` | `messages.template.manage` | `saveTemplate_` |
| `messages.deleteTemplate` | `messages.template.manage` | `deleteTemplate_` |
| `messages.log` | `messages.email.send` 或 `line.message.send` | `listSendLog_` |
| `mail.page` | `messages.email.send` 或 `messages.template.manage` | `mailPage_` |
| `mail.preview` | `messages.email.send` | `previewEmail_` |
| `mail.send` | `messages.email.send` | `sendEmail_` |
| `line.page` | `line.message.send` 或 `line.bot.manage` | `linePage_` |
| `line.compose` | `line.message.send` | `lineCompose_` |
| `line.send` | `line.message.send` | `sendLine_` |
| `line.quota` | `line.message.send` 或 `line.bot.manage` | `lineQuota_` |
| `line.settings` | `line.bot.manage` | `lineSettings_` |
| `line.saveToken` | `line.bot.manage` | `saveLineToken_` |
| `line.bind` | `line.bot.manage` | `startLineBinding_` |
| `line.unbind` | `line.bot.manage` | `removeLineGroup_` |
| `line.cron` | `line.bot.manage` | `setCron_` |
| `settings.get` | `system.settings.manage` | `settingsPage_` |
| `settings.save` | `system.settings.manage` | `saveSettings_` |
| `reminders.save` | `system.settings.manage` | `saveReminder_` |
| `reminders.delete` | `system.settings.manage` | `deleteReminder_` |
| `accounts.list` | `system.account.manage` | `listAccounts_` |
| `accounts.create` | `system.account.manage` | `createAccount_` |
| `accounts.update` | `system.account.manage` | `updateAccount_` |
| `accounts.resetPassword` | `system.account.manage` | `resetAccountPassword_` |
| `accounts.delete` | `system.account.manage` | `deleteAccount_` |

## F. 指令碼屬性與快取

| 指令碼屬性 | 內容 |
| --- | --- |
| `SPREADSHEET_ID` | 資料試算表 ID（「初始化資料表」時寫入） |
| `AUTH_SECRET` | token 簽章金鑰（第一次使用時隨機產生） |
| `PWD_<帳號ID>` | 密碼雜湊：`v1$次數$鹽$雜湊` |
| `TOKV_<帳號ID>` | token 版本；改密碼、重設、停用、刪除時加一，舊 token 全部失效 |
| `LINE_TOKEN` | LINE Channel access token（只寫不讀） |
| `LINE_BOT_NAME` | 驗證 Token 時取得的官方帳號名稱 |
| `LINE_GROUPS` | 已綁定群組 JSON：`[{ id, name, boundAt, boundBy }]` |
| `REMINDER_SENT_<提醒ID>` | 這則每週提醒最後一次推播的日期（每天只推一次） |

| 快取 key | 用途 | 有效時間 |
| --- | --- | --- |
| `login_fail:<帳號>` | 登入失敗次數（5 次鎖定） | 15 分鐘 |
| `<名稱>:<時間窗>` | `throttle_` 限流計數：登入 60 次／10 分鐘、公開報名 30 次／分鐘、寄信 10 次／分鐘、LINE 推播 20 次／分鐘、Webhook 120 次／分鐘 | 時間窗 |
| `line_bind:<綁定碼>` | 群組綁定碼（用一次就刪除） | 10 分鐘 |
| `line_bind_fail` | 綁定碼猜錯次數（10 次暫停綁定） | 10 分鐘 |

## G. ID 規則

| 前綴 | 資料 | 例子 |
| --- | --- | --- |
| `M` + 3 碼 | 會員 | `M001` |
| `MTG-` + 日期 | 每週例會 | `MTG-2026-10-08` |
| `E` | 其他活動 | `E1A2B3C4D5E` |
| `G` | 報名 | |
| `U` | 帳號 | |
| `R` | 每週提醒（預設的是 `R0001`） | |
| `W` | 抽獎紀錄 | |
| `L`、`F` | 追蹤、追蹤紀錄 | |
| `T` | 招募目標 | |
| `J` | 收支帳 | |
| `D` | 會費紀錄 | |
| `TP` | 訊息範本（預設的是 `TP001`～`TP006`） | |
| `S` | 發送紀錄 | |

`newId_` 產生的 ID 是前綴加 10 碼隨機英數字。

## H. 訊息範本欄位

可用欄位：`{{姓名}}`、`{{公司}}`、`{{專業別}}`、`{{邀請人}}`、`{{到期日}}`、`{{活動名稱}}`、`{{活動日期}}`、`{{活動時間}}`、`{{活動地點}}`、`{{報名連結}}`、`{{來賓人數}}`、`{{來賓名單}}`、`{{已到來賓}}`、`{{例會日期}}`、`{{例會時間}}`、`{{例會地點}}`、`{{分會名稱}}`

| 欄位 | 來源 |
| --- | --- |
| 姓名、公司、專業別、邀請人、到期日 | 每位收件人自己的資料（LINE 推播到群組時是空白） |
| 活動名稱、活動日期、活動時間、活動地點 | 選定的活動 |
| 報名連結 | 選定活動的報名頁網址（`?page=register&event=活動ID`） |
| 來賓人數、來賓名單、已到來賓 | 選定活動的來賓（已到來賓每行一位，附專業別） |
| 例會日期、例會時間、例會地點 | 下一場還沒結束、沒有停會的例會 |
| 分會名稱 | 系統設定 |

範本或信件裡出現上表以外的 `{{欄位}}` 會被拒絕。

## I. 外部服務

| 服務 | 用在 | 說明 |
| --- | --- | --- |
| `MailApp.sendEmail` | 信件管理 | 以部署者身分寄出純文字信；`name` 是寄件人名稱、`replyTo` 是回覆信箱；寄前檢查 `getRemainingDailyQuota()` |
| `GET /v2/bot/info` | 儲存 Token | 驗證 Token 並取得官方帳號名稱 |
| `POST /v2/bot/message/push` | 推播 | 帶 `X-Line-Retry-Key`（每次推播一個 UUID），避免網路重試造成重複推播 |
| `POST /v2/bot/message/reply` | Webhook | 回覆綁定結果與加入群組的問候 |
| `GET /v2/bot/group/{id}/summary` | 綁定群組 | 取得群組名稱 |
| `GET /v2/bot/group/{id}/members/count` | 額度 | 群組人數（推播一次約用的則數） |
| `GET /v2/bot/message/quota`、`/quota/consumption` | 額度 | 本月上限與已用則數 |
| `ScriptApp` 時間觸發器 | 每週提醒 | `cronHourly` 每小時一次；在「LINE 小助理 → 機器人設定」開關 |

Webhook 處理的事件：

| 事件 | 處理 |
| --- | --- |
| `join`（機器人被加進群組） | 回覆綁定說明 |
| 群組文字訊息「綁定 六位數字」 | 驗證綁定碼 → 存進 `LINE_GROUPS` → 回覆結果 |
| 其他訊息、私訊 | 不處理 |

## J. 測試

| 指令 | 內容 |
| --- | --- |
| `npm test` | `test/lib.test.js`（純邏輯）、`test/server.test.js`（用 `dev/gas-fake.js` 跑完整後端：帳號、權限、活動、報名、簽到、列印、PALMS、追蹤、產業分析、財務、月費、寄信、LINE 綁定與推播、排程）、`test/bundle.test.js`（打包版可以獨立執行） |
| `npm run e2e` | `dev/e2e.js` 用 Chromium 操作本機預覽：19 個流程，輸出截圖與列印 PDF 到 `.e2e-output/` |
| `npm run dev` | 本機預覽（假試算表、假寄信、假 LINE API） |
| `npm run bundle` | `dev/bundle.js` 產生複製貼上部署用的 4 個檔案到 `dist/`：`src/*.js` 依檔名合併成一份 Code.gs，App、Register 的 include 全部內嵌（內嵌後不能留下 `<?` 模板標籤） |

`dev/gas-fake.js` 模擬的行為：試算表自動轉型（電話掉 0、日期字串變日期、公式字串直接報錯）、指令碼屬性、快取、鎖、`MailApp`（含每日額度）、`UrlFetchApp`（可設定回應）、時間觸發器、`ContentService`。
