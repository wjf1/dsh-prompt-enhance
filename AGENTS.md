# AGENTS.md — dsh-prompt-enhance

## 项目概览

DeepSeek Harness（DSH）编辑器提示词增强插件：在 composer 输入框注入 ✨ 按钮，经 harness LLM 把草稿
改写成可执行提示词，带多级撤销栈与 token 级前后 diff；以 `cordis.patch.yml` 补丁描述接入 DSH 桌面端。
镜像定位：本仓库为 npm 包 dsh-prompt-enhance（rongxingda，Apache-2.0）的第三方镜像，当前同步至 **0.3.4**（2026-11-08）。上游未随包发布测试，门禁为 typecheck。

## 构建与测试命令

Node >= 22，DSH >= 0.2.0，ESM，零第三方依赖。以下命令均来自 `package.json` scripts 与 `.github/workflows/ci.yml`：

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | tsc -p . 全量类型检查（镜像自增 tsconfig；上游 tests/ 未随包发布，暂无测试门禁） |
| `npm run check` | 语法检查三个入口（node --check lib/index.js、lib/client.js、lib/prompt.mjs） |
| `npm ci` | CI 安装（仓库无依赖，秒级） |

CI（ci.yml）：Node 22，`npm ci` → `npm run typecheck`（0.3.4 同步时重写；npm 包不含 build 脚本与测试）。

## 代码风格约定

- 纯 ESM（`"type": "module"`）；`lib/index.js`（host 侧服务）、`lib/client.js`（web 注入）、`lib/prompt.mjs`（清洗纯函数）三层职责清晰，prompt 清洗保持纯函数可直测。
- 错误处理对宿主负责：race 输掉的 promise 必须挂 catch，防 unhandledRejection 带崩宿主进程；超时必须显式 `stream.return?.()` 关闭上游流（否则上游继续计费）。
- HTTP 语义正确性：先回响应再收尾连接（413 修复先例：先 destroy 再回响应会让客户端只见 ECONNRESET）。
- 测试不写绝对路径（曾硬编码作者本机路径导致其他环境整套失败），用 `new URL(..., import.meta.url)` 相对解析。

## 提交与发布规范

- 本仓库为浅克隆无完整历史，采用 Conventional Commits 通用风格（`feat:` / `fix:` / `docs:` / `chore:`）+ 中文描述；变更记录写入 CHANGELOG.md 的 Unreleased 段。
- 发布走 annotated tag：`git tag -a vX.Y.Z -m "vX.Y.Z: <中文核心摘要>"`，GitHub Release 标题与正文对齐 CHANGELOG（标题格式 `vX.Y.Z: 中文摘要`）。

## 项目专属注意

1. **改 DSH 行为只准动 `cordis.patch.yml`**，不给 `app.asar` 打补丁；该文件 691 行、260+ 模型条目，改前必须备份成 `*.bak-<日期>`。
2. **`node --test tests`（传目录）在 Node v22.23.2 下报错**，统一用 `npm test`（无参 `node --test` 自动发现测试文件）或 `node --test "tests/*.test.mjs"` 形式。
3. **Web GUI 无 server-wide 认证可绕过**：cookie 名/值绑定 `host[:port]`，由 `.credentials.yaml` 签名；`tools/gui-cookie.mjs` 的密钥只在内存使用，不打印、不落盘。
4. **重启 DSH 桌面应用会杀掉正在跑的会话**（agent 进程住在应用里）：重启只能由用户批准后由脱离脚本执行。

接力开发优先阅读 `HANDOFF.md`（§6 关键避坑）与 `CHANGELOG.md`（Unreleased 即当前 main 状态）。
