/**
 * 为「本机 Web GUI」签发一个临时浏览器会话 cookie，并提供一个只在本机回环上
 * 投放该 cookie 的小服务，好让浏览器能以已认证身份打开 http://127.0.0.1:<port>/。
 *
 * 为什么需要它：DSH 的 Web 入口没有 server-wide 认证旁的旁路，第一次访问必须带
 * `dsh web` 打印的 launch token，之后靠 client-connection 自己签发的签名 cookie。
 * 桌面宿主不会把那个 token 打到任何日志里，所以这里用同一份签名密钥
 * （`.credentials.yaml` 里 `client-connection/browser-session` 记录的 secret）
 * 在本地现签一枚短效 cookie，并由本进程的 Set-Cookie 直接塞进浏览器。
 *
 * 密钥只在内存里出现，绝不打印；cookie 有效期默认 10 分钟。
 *
 * 用法：
 *   node tools/gui-cookie.mjs --check            # 自检：签 cookie → 请求 GUI → 报告状态
 *   node tools/gui-cookie.mjs --serve 59611      # 起投放服务，浏览器访问后可进 GUI
 */

import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const requireFromProfile = createRequire('C:/Users/admin/.dsh/profiles/desktop/package.json');
const YAML = requireFromProfile('yaml');

const DSH_HOME = process.env.DSH_HOME || 'C:/Users/admin/.dsh';
const CREDENTIALS = join(DSH_HOME, '.credentials.yaml');
const RECORD_KEY = 'client-connection/browser-session';
/** 与宿主签名算法保持一致：cookie 名 = 前缀 + base64url(sha256(authority))。 */
const COOKIE_PREFIX = 'dsh-auth-';
/** cookie 值里的版本号；client-connection 的 COOKIE_PAYLOAD_VERSION。 */
const PAYLOAD_VERSION = 1;

/** 读取签名密钥（只在内存里保留字节）。 */
function readSecret() {
  const document = YAML.parse(readFileSync(CREDENTIALS, 'utf8'));
  const record = document?.records?.[RECORD_KEY];
  const encoded = record?.payload?.secret;
  if (typeof encoded !== 'string') throw new Error(`credentials 里缺少 ${RECORD_KEY}.payload.secret`);
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.byteLength !== 32) throw new Error(`secret 长度异常：${bytes.byteLength} 字节`);
  return bytes;
}

/**
 * 现签一枚 cookie。
 * @param {string} authority host[:port]，必须与浏览器请求的 Host 头一致。
 * @param {Buffer} secret 32 字节签名密钥。
 * @param {number} ttlSeconds 有效期秒数。
 * @returns {{ name: string, value: string, expiresAt: number }} 名字/值/过期时间。
 */
function mintCookie(authority, secret, ttlSeconds) {
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlSeconds * 1000;
  const payload = { version: PAYLOAD_VERSION, authority, issuedAt, expiresAt };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  const name = COOKIE_PREFIX + createHash('sha256').update(authority).digest('base64url');
  return { name, value: `v${PAYLOAD_VERSION}.${body}.${signature}`, expiresAt };
}

/** 拼出 Set-Cookie 头（与宿主的 sessionCookie 同形，不含 Secure，因为走 http）。 */
function setCookieHeader(cookie, ttlSeconds) {
  return `${cookie.name}=${cookie.value}; Max-Age=${ttlSeconds}; Path=/; Expires=${new Date(cookie.expiresAt).toUTCString()}; HttpOnly; SameSite=Strict`;
}

/** 自检：签一枚 cookie，用它请求 GUI 首页，报告是否越过认证门。 */
async function check() {
  const authority = process.argv[3] || '127.0.0.1:59543';
  const cookie = mintCookie(authority, readSecret(), 600);
  const response = await fetch(`http://${authority}/`, { headers: { cookie: `${cookie.name}=${cookie.value}` } });
  const body = await response.text();
  const blocked = body.includes('dsh web authentication required');
  console.log(JSON.stringify({
    status: response.status,
    bytes: body.length,
    authenticated: response.status === 200 && !blocked,
    looksLikeApp: /<div id="root"|<script/i.test(body),
    cookieNamePrefix: cookie.name.slice(0, 12) + '…',
  }, null, 2));
  if (!(response.status === 200 && !blocked)) process.exitCode = 1;
}

/** 起投放服务：GET / → Set-Cookie → 302 到 GUI。 */
function serve(port) {
  const authority = process.argv[4] || '127.0.0.1:59543';
  const ttlSeconds = 600;
  const secret = readSecret();
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' }).end('method not allowed');
      return;
    }
    const cookie = mintCookie(authority, secret, ttlSeconds);
    res.writeHead(302, {
      'set-cookie': setCookieHeader(cookie, ttlSeconds),
      location: `http://${authority}/`,
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
    });
    res.end(req.method === 'HEAD' ? undefined : `已投放会话 cookie（有效期 ${ttlSeconds}s），正在跳转 http://${authority}/ …\n`);
  });
  server.listen(Number(port), '127.0.0.1', () => {
    console.log(`cookie 投放服务已就绪：http://127.0.0.1:${port}/  →  http://${authority}/`);
  });
  return server;
}

const mode = process.argv[2];
if (mode === '--check') {
  await check();
} else if (mode === '--serve') {
  const port = process.argv[3];
  if (port === undefined) throw new Error('用法：node tools/gui-cookie.mjs --serve <port> [authority]');
  serve(port);
} else {
  throw new Error('用法：node tools/gui-cookie.mjs --check | --serve <port>');
}
