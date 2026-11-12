# 变更记录

## Unreleased（未发布，对应仓库 main）

## 0.3.4 — 2026-11-08（镜像同步）

仓库定位改为**第三方镜像**：`main` 全量同步 npm 包 `dsh-prompt-enhance@0.3.4`（上游 maintainer rongxingda，上游仓库 `rongxingda/dsh-prompt-enhance`，Apache-2.0）。

### 变更

- **主进程半整体替换为上游实现**（`lib/index.js`，约 1.4k 行）：原自研实现换成上游 0.3.x 的 `src/` 全量 TS 源码（`config` / `context` / `enhancer` / `enhance-routes` / `orchestrate` / `sse` / `settings-source` / `loopback` / `http` 等）及其编译产物。0.3.x 相对本仓库此前的 0.2.x 实现多了 schemastery 配置体系、SSE 流式回推、上下文感知与速率限制。
- **`lib/prompt.mjs` 保留本仓库版本**：0.2.x 时代的 `SYSTEM_PROMPT` 复刻与 `cleanEnhancedText` 未被上游覆盖，`cleanEnhancedText` 的成对引号清洗（见 0.2.2 段）继续生效。
- **LICENSE 换为上游 Apache-2.0**；README 双语补镜像同步声明与代码归属说明（上游代码 Apache-2.0，仓库自有文件归 wjf1）。
- **自增 `tsconfig.json`**：npm 包不含 `tsconfig.json` 与 `scripts/build.mjs`，镜像侧补齐以支持 `npm run typecheck`。
- **删除旧 `tests/` 与 `tools/`**：0.2.1 时代的测试与脚本与新源码不匹配，上游也未随包发布测试。
- **CI 重写为镜像形态**：`npm ci` + `npm run typecheck`（Node 22）；`npm test` 保留在 `scripts` 里，但镜像仓当前无测试文件，执行会报「No test files found」——这是镜像的已知边界，不是回归。

### 修复（自研实现时代的两项，已随上游实现继续成立）

- **超时只清 timer，不中止上游流**：`Promise.race([consume(), timeout])` 超时后上游流仍在后台继续产出 token（照旧计费）。现在超时显式 `iterator.return?.()` 关闭上游（镜像后位于 `src/enhancer.ts` 的 `finally` 段）；并给消费侧挂 catch，避免它在 race 结束后才失败而变成 `unhandledRejection` 把宿主进程带崩。
- **请求体超限时 413 发不出去**：原实现先 `req.destroy()` 再回 413，客户端只会收到 `ECONNRESET`。现在先回响应、并把连接声明为 `connection: close` 让 Node 自行丢弃未读 body（镜像后位于 `src/enhance-routes.ts`）。
- **清洗引号时不处理嵌套**（`lib/prompt.mjs`）：原正则允许开闭引号不同族且只检查正文是否含「开头那个字符」，`"He said "hi""` 这类会被剥掉外层吃掉正文。现在只认成对引号（`""` / `“”` / `''` / `‘’`），且正文含任何引号就原样保留。

### 已知偏差（未处理）

- **仓库无测试门禁**：镜像同步删除了旧 `tests/`（与上游 0.3.x 源码不匹配），上游也未随 npm 包发布测试。当前 CI 只有 `typecheck` 一道闸。
- **`tag → publish` 流程仍需作者本人在有 npm 凭证的环境完成**：本仓库只做镜像，不代发 npm。
- 本仓库的 `package.json` 版本号跟随上游 npm 包，不另起产品序列；历史上 0.1.0 / 0.2.0 / 0.2.1 三个 tag 属自研实现时代，与 npm 上的同号包**不是同一套代码**。

## 0.2.1 — 2026-10-19
