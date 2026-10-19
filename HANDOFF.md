# HANDOFF — dsh-prompt-enhance

> 跨会话接力文档。接手先读本文件，再看 `README.md` 与 `lib/`。
> 最后更新：2026-10-19 23:40（0.2.0：模型跟随 / 多层撤销 / 差异高亮）

## 1. 项目概况与当前状态

对标 WorkBuddy 桌面端（`E:\workbuddy`）输入框里那颗 ✨「增强提示词」按钮，把它做成可部署在
本机 DSH（DeepSeek Harness，profile = `desktop`）上的双半插件：

- **宿主半** `lib/index.js`：注册 `POST /dsh-prompt-enhance/api/enhance`，调 `ctx.llm.stream()`
  走 profile 现有模型把草稿重写成更好的提示词。
- **客户端半** `lib/client.js`：注册到 `conversation.input.right` 槽位，在模型选择器左侧渲染 ✨ 按钮。

状态：**v0.2.0。31 项自动化测试全绿（`node --test "tests/*.test.mjs"`）。重启后（GUI 端口 55451）已完成全部真机验收：✨ 在模型选择器左侧、请求体带界面当前模型（`reasoningEffort: max`）、宿主回显 `followed:true|false`、多层撤销 `data-depth` 2→1→0、差异卡自动弹出并可 Escape 关闭。**

## 2. 技术栈与运行基线

| 项 | 值 |
| --- | --- |
| DSH profile | `C:\Users\admin\.dsh\profiles\desktop` |
| 本插件源码 | `C:\Users\admin\.dsh\dsh-prompt-enhance`（junction 进 profile `node_modules\dsh-prompt-enhance`） |
| 登录 profile 的开关 | `package.json` → `dsh.profile.bundles` 末尾的 `dsh-prompt-enhance` |
| 插件图入口 | 本包 `cordis.patch.yml`（`- insert: - id: dsh-prompt-enhance`） |
| Node | `C:\Users\admin\AppData\Local\hermes\node\node.exe`（v22.23.2） |
| 默认增强模型 | `acme / cn:deepseek-v4.1-flash`（= profile `agent-default-model`），可在 patch 的 `config` 里改 |
| Web GUI | 端口每次启动随机（本次 `http://127.0.0.1:56531`，需 `client-connection` 签发的 cookie；用 `tools\\gui-cookie.mjs` 换） |

备份：改 `profiles\desktop\package.json` 之前的原件在同目录 `package.json.bak-20261019-2239`。

## 3. 核心架构与文件拓扑

```
C:\Users\admin\.dsh\dsh-prompt-enhance\
├─ package.json          # main=lib/index.js, exports["./client"], dsh.bundle.patch, dsh.client.platform=web
├─ cordis.patch.yml      # 宿主半进插件图（insert id=dsh-prompt-enhance）
├─ lib\index.js          # 宿主半：路由注册 + 请求围栏 + ctx.llm.stream 调用 + 错误码
├─ lib\prompt.mjs        # WorkBuddy 逐字复刻的 SYSTEM_PROMPT + buildUserPrompt + cleanEnhancedText
├─ lib\client.js         # 客户端半：✨ 按钮 + ↺ 撤销栈(最多 8 层) + ⇄ 词级差异卡（portal 到 body）
├─ tests\host.test.mjs   # 路由/调用链/模型透传白名单（假 ctx）+ 错误映射
├─ tests\prompt.test.mjs # 提示词契约、清洗、长度限制
├─ tests\client.test.mjs # 状态机（假 React 驱动，不需要真 DOM）
├─ tools\gui-cookie.mjs   # 本机 GUI 免 token 登录：签 cookie + 小服务投放（密钥只在内存）
└─ HANDOFF.md / README.md
```

### 关键契约（都不是猜的，来自 asar 逆向）

1. **客户端插件**是手写 bundle：`window.__ModuleLoader__.load({ id, factory: (require) => {...} })`，
   工厂返回 `{ apply, inject }`；样式自注入，组件用 `React.createElement`。
2. **槽位**：`scope.slots.inject('conversation.input.right', () => scope.slots.register({ name:'conversation.input.right', id, order, inject }, Comp))`。
   ⚠️ `register` 的 `name` 必须是**槽位名**，不是插件名（易错点）。
3. **读/写草稿**：`inject(sessionId)` 里 `sessions.scope(sessionId)` → `actx.get('conversation')`
   → `conversation.input.for(actx)` 得到 facade：`state.getSnapshot().draft` 读、`state.subscribe` 订阅、
   `actions.setDraft(text)` 整段替换。链路任何一步断掉都返回 `{}`（组件再退回父级透传的 `keyboard`），
   绝不让插槽渲染崩掉。
4. **宿主路由**：`hostCtx.inject(['webServer'], ctx => ctx.effect(() => ctx.webServer.register({ kind:'prefix', path, handler }), 'label'))`；
   没有 server-wide 认证，但要照抄 dsh-portable 的请求围栏（connection gate 或 loopback-only）。
5. **调模型**：`ctx.llm.stream({ provider, model, messages })` 逐块返回，终态必为 `finish`；
   错误码 `NO_ADAPTER / MISSING_CREDENTIAL / AUTH / RATE_LIMIT / CONTEXT_WINDOW_EXCEEDED / QUOTA / TIMEOUT`。

## 4. 最近一轮变更与交付成果

- 从 WorkBuddy 的 `app.asar` 里逆向出增强链路的**系统提示词原文**（`SYSTEM_PROMPT`）并逐字复刻进
  `lib/prompt.mjs`；报告原件见 `C:\Users\admin\AppData\Local\Temp\wb_enhance_findings.md`。
- 确认 WorkBuddy 的增强走官方客户端签名（`global:enhance-1.0` 经 wb2api 中继返回 503 `no_healthy_account`），
  所以本插件不复用那颗模型，改用 profile 自己的 chat 模型。
- 交互细节对标：空草稿置灰、点击转圈可取消、成功原地替换并支持一次撤销、失败变红 hover 出原因再次点击重试、
  用户中途改草稿则放弃结果不覆盖。
- 修掉一个真实 bug：`slots.register` 的 `name` 曾经写成插件名（导致按钮不会出现），已改为槽位名并加测试锁死。

## 5. 真机验收结果（2026-10-19 已完成）

重启 DSH（用户批准，`C:\Users\admin\AppData\Local\Temp\dsh_restart.ps1`，端口 `59543` → `56531`；端口每次启动随机）后逐项核对：

1. **插件已加载**：GUI 输入框右侧出现 ✨（`[data-dsh-prompt-enhance="sparkle"]`），祖先链在
   `div[data-slot="conversation.input.right"]` 内、`[data-composer-card]` 之下。
2. **真实点击走查**（CDP 真鼠标/真按键事件，非脚本 `click()`）：
   - 空草稿 → `disabled=true`，title「增强提示词」（`docs/03-disabled.png`）；
   - 输入「帮我写个周报」 → ✨ 亮起，位于「Deepseek-V4.1-Flash」左侧（`docs/01-before.png`）；
   - 点击 ✨ → `phase=busy` → `phase=done`，草稿替换成 122 字结构化提示词，按钮变 ↺「恢复原文」（`docs/02-enhanced.png`）；
   - 再点一次 → 草稿逐字恢复「帮我写个周报」，`phase=idle`。
3. **接口直测**（页面内同源 fetch，自动带 Cookie）：正常 200；`EMPTY_INPUT` / `INVALID_JSON` / `INPUT_TOO_LONG` 均 400。
4. **位置微调**：`order` 20 → 50，落到视觉路由「识图」（order 40）之后、紧贴模型选择器左侧，对齐 WorkBuddy。
   **客户端 bundle 改完刷新页面即生效**，宿主半（`lib/index.js`、`lib/prompt.mjs`）改动才需重启。
5. 四文档齐备：`package.json` 0.1.0 / `CHANGELOG.md` / `README.md`（含验收表与截图）/ 本文件；测试 23/23。

下一步可选：④ 打包上架 dshmarket。

## 5.1 v0.2.0（2026-10-19 23:40）：三项增强

- **跟随界面当前模型**：`lib/client.js` 的 `makeModelReader` 读 `modelDirectories.directoryFor(sessionId).store.current`，
  把 `provider/model/reasoningEffort` 带进请求；`lib/index.js` 的 `resolveModel` 用白名单
  `[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}` 校验后透传，非法/缺省整组回落默认，响应带 `followed` 便于排查。
- **多层撤销**：撤销栈（最多 8 层）；主按钮在增强后仍是 ✨（可再增强），旁边出现 `↺ 撤销` 与 `⇄ 差异`。
- **差异高亮**：`tokenize` + LCS（`Uint16Array`，token 上限 800）生成 equal/ins/del 段，
  `DiffCard` 用 `react-dom.createPortal` 挂到 body、锚在 ✨ 上方，Escape 关闭，卡内可直接撤销。
- 测试 23 → 31：多层撤销、差异两侧可还原、readModel 降级、宿主模型白名单。

### v0.2.0 重启后真机验收（2026-10-19 23:45，GUI 端口 55451）

| 检查 | 结果 |
| --- | --- |
| 宿主路由恢复 | `GET /dsh-prompt-enhance/api/health` → 200 `{"ok":true,"provider":"acme","model":"cn:deepseek-v4.1-flash"}`（同类 dsh-portable 路由仍 404，属其自身行为） |
| 位置 | `[data-slot="conversation.input.right"]` 子节点依次为「识图 → ✨ → ↺ → ⇄」 |
| 请求体 | fetch 录制到 `{"text":"帮我写个周报","provider":"acme","model":"cn:deepseek-v4.1-flash","reasoningEffort":"max"}` |
| 宿主跟随 | `cn:deepseek-v4-pro`+`high` → 200、`followed:true`；`../etc/passwd` → 回落默认、`followed:false` |
| 差异卡 | 自动弹出，实测「6 处改动 · 88 字新增 / 1 字替换 · 净 +87 字」，`span.dsh-prompt-enhance__ins/__del`；Escape 关闭 |
| 多层撤销 | depth 2 → 1（93 字首版）→ 0（原文「帮我写个周报」），撤销/差异按钮消失、组件退回裸按钮 |

**踩坑（重要）**：重启与手工改码交错时，首屏可能拿到**旧客户端 bundle**——表现为按钮在、`data-depth` 也对，
但缺少 `span.dsh-prompt-enhance__group` 与 ↺/⇄。判断方法：`fetch` 当前页面实际使用的
`/plugins/??…dsh-prompt-enhance/client.js&rev=…` 后 grep `__group`。补救=刷新页面（客户端半不需要重启）。
另外浏览器里清 Lexical 草稿不能用 `dsh_browser_clear`（写 value 无效）：先 `document.execCommand('selectAll')`
再用真实 Backspace。

### 5.2 v0.2.1（2026-10-19 23:55）：差异卡「看不清」修复

- **根因**：卡片背景用会随主题变浅的 `--dsw-alias-bg-module-platform`，但增/删文字色写死成深色主题的浅绿/浅红
  （`#7ee2a8` / `#ff9d98`），浅色主题下对比度只有 1.5:1 / 1.8:1。
- **改法**：`__ins` 用 `color: inherit` + 20% 绿底 + 底部绿线；`__del` 用
  `color-mix(in srgb, currentColor 82%, #b91c1c)` + 13% 红底 + 删除线；加「新增 / 删除」色块图例做非颜色线索。
- **排版**：正文 13px/1.6、去等宽字体、差异段按换行切行（`segmentsToLines`）、卡片标题与统计拆层级、底部分隔线。
- **浮层**：锚点改成 `[data-composer-card]`（整张输入卡），卡片浮在输入卡上方，`maxHeight` 按可用空间算；
  实测 `cardRect.bottom=562 < composerTop=572`，不再压住正在对比的草稿；宽度 `min(560, 100vw-24)` + resize 重算。
- **验收**：浅色 14.0:1 / 13.1:1、深色 10.5:1 / 7.9:1（自定义深色面自检，截图 `docs/05-dark-contrast.png`）；
  33 项测试全绿，其中新增样式守门用例防止浅色字回流。
- **教训**：凡是浮层/卡片在 DSH 里既可能落浅色也可能落深色主题，**颜色必须从 `currentColor` 推导**，
  只有背景可以用主题变量；写死十六进制色只在单一主题下成立。

### 运行态事故记录（2026-10-19 23:32）

profile 里的插件管理器自动跑了一次 `pnpm install`（日志 `profiles\desktop\.plugin-manager\logs\operation-n9YP0u\pnpm.log`，
6 分 17 秒），期间把 `dsh-config-manager` 等依赖从 profile 移除，并导致**所有插件 HTTP 路由消失**：
`/dsh-prompt-enhance/api/health` 与 `/dsh-portable/api/status` 都 404，SPA 首页仍 200。
结论：**插件路由丢失 ≠ 代码坏了**，先探两个插件的路由再下结论；恢复手段就是重启宿主。这也再次说明
「宿主半改动必须重启」是同一个动作。

## 6. 关键避坑与运行约束

- **改 DSH 行为只准动 `profiles\desktop\cordis.patch.yml`**，不要给 `app.asar` 打补丁。
- 该 patch 有 691 行、260+ 模型条目，改前必须备份成 `*.bak-<日期>`。
- **重启桌面应用会杀掉正在跑的会话**（agent 进程住在应用里）：重启只能由用户批准后由脱离的脚本执行，
  重启后回原会话说「继续」。
- `node --test tests`（传目录）在 v22.23.2 下会报 `Cannot find module ...\tests`，必须用 `node --test "tests/*.test.mjs"`。
- Web GUI 没有可绕过的 server-wide 认证；cookie 名/值绑定 `host[:port]`，由
  `.credentials.yaml` 的 `client-connection/browser-session` 密钥签名。`tools\gui-cookie.mjs` 只在内存里用密钥，
  不打印、不落盘。
- 超过 200KiB 的图片不会内联（读到的只是 base64 前缀），视觉验收用可编程断言，截图只作留档。
