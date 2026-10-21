# 变更记录

## Unreleased（未发布，对应仓库 main）

### 修复

- **超时只清 timer，不中止上游流**（`lib/index.js`）：`Promise.race([consume(), timeout])` 超时后上游流仍在后台继续产出 token（照旧计费）。现在超时会显式 `stream.return?.()` 关闭上游；同时给 `consume()` 挂上 catch，避免它在 race 结束后才失败而变成 unhandledRejection 把宿主进程带崩。
- **请求体超限时 413 发不出去**（`lib/index.js`）：原实现先 `req.destroy()` 再回 413，客户端只会收到 `ECONNRESET`。现在先回响应，靠 drain 收尾。
- **测试硬编码作者本机的绝对路径**（`tests/client.test.mjs`）：`readFileSync('C:/Users/admin/.dsh/...')` 让除作者机器外的环境整套测试必失败。改用 `new URL('../lib/client.js', import.meta.url)` 相对解析，现在 36 项全过。
- **清洗引号时不处理嵌套**（`lib/prompt.mjs`）：`^(["“'])([\s\S]*)(["”'])$` 允许开闭引号不同族，且只检查正文是否含"开头那个字符"，`"He said "hi""` 这类会被剥掉外层吃掉正文。现在只认成对引号（`""` / `“”` / `''` / `‘’`），且正文含任何引号就原样保留。

### 新增

- `package.json` 补 `scripts.test` / `scripts.check`，补最小 CI（Node 22/24：语法检查 + 测试）；此前测试存在但无法 `npm test` 触发，也没有任何 CI。
- 导出 `MODEL_ID_PATTERN` 与 `DEFAULTS`（`resolveModel` 原本已导出），方便上层或客户端复用同一套白名单。
- `tests/client.test.ts` 之外新增「客户端与宿主半 API 前缀一致」的漂移测试：客户端是运行时拼接的脚本片段、不能 import 本地模块，前缀只能两处各写一份，用测试锁住一致性。
- 新增「超时会关闭上游流」回归测试。

### 已知偏差（未处理）

- README 顶部新增**版本漂移警示**：npm 上最新 `0.2.7` 是重构后的另一套实现（约 2.2k 行），尚未回流本仓库；npm 源码回流与 `tag → publish` 流程需要作者本人在有 npm 凭证的环境完成。

## 0.2.1 — 2026-10-19

差异卡「看不清」修复：对比度、字号行距、排版层级、浮层遮挡四类问题。

### 根因

差异卡默认按深色主题挑的语法色（新增 `#7ee2a8`、删除 `#ff9d98`），但卡片背景取的是会随主题变浅的
`--dsw-alias-bg-module-platform`。浅色主题下等于「浅色字压白底」：

| 元素 | 修复前实测对比度 | WCAG AA（正文 4.5:1） |
| --- | --- | --- |
| 新增 `#7ee2a8` on `#f5f6f7` | ≈ 1.5 : 1 | 不达标 |
| 删除 `#ff9d98` on `#f5f6f7` | ≈ 1.8 : 1 | 不达标 |

### 修复

- **配色**：`__ins` 改为 `color: inherit` + 20% 绿色底 + 底部 0.14em 绿线；`__del` 文字色由
  `color-mix(in srgb, currentColor 82%, #b91c1c)` 从主题色推导、13% 红底 + 删除线。两处都不再写死浅色。
  修复后实测：浅色 14.0 : 1 / 13.1 : 1，深色 10.5 : 1 / 7.9 : 1。
- **非颜色线索**：新增有下划线色块、删除有删除线，并新增「新增 / 删除」色块图例（`__legendSwatch`），
  色觉障碍用户不依赖色相也能区分。
- **字号行距**：卡片正文 12px/18px → 13px/1.6（20.8px）；统计行改 `tabular-nums`，正文不再用等宽字体（中文等宽导致字距发挤）。
- **层级**：标题拆成 `__cardTitle`（13px/600）与 `__cardStat`（12px/66% 透明主题色）；底部分隔线 + 图例左置、按钮右置。
- **排版**：差异段按换行切成行（`segmentsToLines`），逐行 `<div>` 渲染，段间 6px；实测长提示词从「一大坨」变成 2–5 行。
- **浮层位置**：锚点从 ✨ 按钮改为整张 `[data-composer-card]`，卡片浮在输入卡上方（实测 bottom 562 < composerTop 572，不再遮住正在对比的草稿）；`maxHeight` 按可用空间计算，超出时正文内部滚动。
- **响应式**：宽度 `min(560, 100vw − 24)`、左右 12px 约束，并监听 `resize` 重新定位。
- 测试 33 个：新增 `segmentsToLines` 切行用例、样式守门用例（禁止残留 `#7ee2a8/#ff9d98`、断言 13px/1.6/滚动/图例存在）。

## 0.2.0 — 2026-10-19

三项增强：跟随界面模型、多层撤销、增强前后差异高亮。

### 新增

- **跟随界面当前模型**：客户端从 `modelDirectories.directoryFor(sessionId).store.current` 读 `provider/model/reasoningEffort` 带进请求；宿主按标识符白名单校验后透传 `ctx.llm.stream`，非法或缺省时整组回落插件默认模型；响应新增 `provider/model/followed` 便于排查。
- **多层撤销**：增强结果改为撤销栈（最多 8 层），↺ 一次退一层，退空回原文；等待期间用户改草稿仍会整栈作废。
- **差异高亮**：增强后自动弹出对比卡（portal 到 body，锚在 ✨ 上方），词级 LCS 逐字标出删除线与新增高亮，展示「N 处改动 · X 字新增 / Y 字替换 · 净 ±Z 字」，支持 Escape 关闭与卡内撤销。
- UI 形态调整：增强后主按钮仍是 ✨（可连续再增强），旁边新增 `↺ 撤销` 与 `⇄ 差异` 两个小按钮——否则主按钮变成撤销后多层栈不可达。
- 测试从 23 个增至 31 个：多层撤销、差异算法自洽性（去除增/删可还原两侧文本）、readModel 降级、宿主模型透传与非法标识符回落。

### 修复

- `resolveModel` 单元测试暴露的默认值口径：`followed` 只在真实跟随到非默认模型时为 true。

### 验证（重启后真机，GUI 端口 55451）

- 请求体实测带 `provider/model/reasoningEffort`（当前档位 Max → `max`）；显式 `cn:deepseek-v4-pro` 回 `followed:true`，非法标识符回落默认且 `followed:false`。
- 差异卡自动弹出：「6 处改动 · 88 字新增 / 1 字替换 · 净 +87 字」，Escape 关闭。
- 多层撤销 `data-depth` 2→1→0，草稿逐字回到原文，撤销/差异按钮随之消失。
- 截图：`docs/02-enhanced.png`（新 UI：✨+↺+⇄）、`docs/04-diff.png`（差异卡）。

## 0.1.0 — 2026-10-19

首个可部署版本，对标 WorkBuddy 的「增强提示词」按钮（m00004）。

### 新增

- 宿主半 `lib/index.js`：`POST /dsh-prompt-enhance/api/enhance` 单轮增强接口，`GET .../health` 自检；复用 `dsh-client-connection` 的浏览器 Cookie 栅栏（隧道暴露时不当免费代理），错误码 `EMPTY_INPUT / INPUT_TOO_LONG / INVALID_JSON / NO_LLM_SERVICE / TIMEOUT / <模型错误码>`。
- 浏览器半 `lib/client.js`：`conversation.input.right` 槽位渲染 ✨ 按钮（`order: 50`，紧贴模型选择器左侧，与 WorkBuddy 位置一致）；原地改写草稿 + 单层撤销（↺ 恢复原文）；空草稿置灰、加载中再点取消、等待期间用户改动则放弃结果、失败短暂变红并在 tooltip 给中文原因。
- `lib/prompt.mjs`：逐字复刻 WorkBuddy 的 system prompt 与 user prompt 模板（含中英混排语言一致性约束、禁语言标签、禁围栏、800 字符软约束），外加输出清洗（剥围栏 / `Enhanced prompt:` 前缀 / 包裹引号）。
- `tools/gui-cookie.mjs`：从凭据库换出带认证的 GUI 会话 Cookie，`--check` 校验、`--serve` 起本地跳板，供真实浏览器走查。
- `tests/`：23 个用例覆盖路由守卫、认证栅栏、错误码、提示词完整性、客户端状态机（点击→busy→替换→撤销→取消→被编辑放弃→失败重试）。
- `docs/`：真机验收截图三张（置灰 / 增强前 / 增强后）。

### 决策与边界

- 不复用 `global:enhance-1.0`：该模型经中继调用被官方客户端校验挡掉（`request illegal` / `no_healthy_account`），改为复用 profile 默认 chat 模型 `acme/cn:deepseek-v4.1-flash` + 复刻提示词。
- 增强模型固定为配置项，不跟随界面当前选择；撤销只有一层；只做单轮、不带会话上下文（与 WorkBuddy 一致）。
- 客户端半改动刷新页面即生效，宿主半改动需重启 DSH。
