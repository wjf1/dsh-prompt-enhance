/**
 * 部署副本同步脚本（本仓库运维用，不属于 npm 包内容）。
 *
 * 背景：宿主 DSH profile 经 junction 实际加载 `C:\Users\admin\.dsh\dsh-prompt-enhance`
 * （镜像副本，只含构建产物 lib/ 等，无 src）。历史上纯手工复制无任何校验，出现过
 * 部署副本落后仓库 8 个版本（0.2.1 vs 0.3.4）带病运行的事故。本脚本消除该类脱节：
 *
 *   1. 版本门禁：仓库与部署副本 package.json 版本不一致才复制，一致则明确拒绝（防误刷）；
 *   2. 清单复制：按白名单覆盖（lib/、package.json、cordis.patch.yml、README*、CHANGELOG、
 *      docs/），部署副本多出的文件（tests/、tools/、HANDOFF 等宿主侧资产）不碰；
 *   3. 校验回读：逐文件 sha256 源/目标比对 + 复制后重读目标版本断言一致，任一失败 exit 1。
 *
 * 用法：node scripts/sync-to-profile.mjs [--target <部署目录>]
 * 前置：镜像仓不含构建链（ci.yml：门禁为类型检查），lib/ 以仓库内已提交产物为准；
 *       改过 src 后先 `npx tsc -p .` 并确认 `git diff lib/` 为空再同步。
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const DEFAULT_TARGET = "C:\\Users\\admin\\.dsh\\dsh-prompt-enhance";
const target = argTarget() ?? DEFAULT_TARGET;

function argTarget() {
  const i = process.argv.indexOf("--target");
  return i >= 0 ? resolve(process.argv[i + 1]) : undefined;
}

function readVersion(pkgPath) {
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

const srcVersion = readVersion(join(REPO, "package.json"));
if (!existsSync(join(target, "package.json"))) {
  console.error(`部署副本不存在或缺 package.json：${target}`);
  process.exit(1);
}
const dstVersion = readVersion(join(target, "package.json"));
if (srcVersion === dstVersion) {
  console.log(`已是同版本（${srcVersion}），无需同步。如确需强制刷写请先改版本号。`);
  process.exit(0);
}
console.log(`同步：仓库 ${srcVersion} → 部署副本 ${dstVersion}`);

/** 复制白名单：文件或目录（目录整体覆盖，含子树）。 */
const MANIFEST = ["lib", "package.json", "cordis.patch.yml", "README.md", "README.zh-CN.md", "CHANGELOG.md", "docs"];
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** 递归收集文件（返回绝对路径列表）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const copied = [];
for (const item of MANIFEST) {
  const src = join(REPO, item);
  if (!existsSync(src)) {
    console.error(`清单项缺失：${item}（镜像仓形态变化？请核对该项是否仍应同步）`);
    process.exit(1);
  }
  const dst = join(target, item);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
  const files = statSync(src).isDirectory() ? walk(src) : [src];
  for (const f of files) {
    const rel = relative(REPO, f);
    if (sha256(f) !== sha256(join(target, rel))) {
      console.error(`校验失败（源/目标 sha256 不一致）：${rel}`);
      process.exit(1);
    }
    copied.push(rel);
  }
}

const syncedVersion = readVersion(join(target, "package.json"));
if (syncedVersion !== srcVersion) {
  console.error(`版本回读不一致：目标仍为 ${syncedVersion}，预期 ${srcVersion}`);
  process.exit(1);
}
console.log(`完成：${copied.length} 个文件校验一致，部署副本现为 ${srcVersion}。`);
console.log("注意：宿主进程需重启（或插件重载）后才会加载新版本。");
