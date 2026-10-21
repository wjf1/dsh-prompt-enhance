/**
 * Host 半：注册一个受浏览器会话保护的 HTTP 端点，用 DSH 自己的 LLM 服务
 * 把草稿改写成更高质量的提示词。不新增工具、不碰会话历史，单轮无工具调用。
 */
import { SYSTEM_PROMPT, buildUserPrompt, cleanEnhancedText } from './prompt.mjs';

export const name = 'dsh-prompt-enhance';

/** 端点前缀，客户端固定请求 `${API_PREFIX}/enhance`。 */
export const API_PREFIX = '/dsh-prompt-enhance/api';

/** 默认配置；cordis.patch.yml 里的 config 逐键覆盖。 */
const DEFAULTS = {
  provider: 'acme',
  model: 'cn:deepseek-v4.1-flash',
  /** 空字符串表示不显式传推理档，交给模型/provider 默认。 */
  reasoningEffort: '',
  maxInputChars: 20000,
  maxBodyBytes: 256 * 1024,
  timeoutMs: 120000,
  systemPrompt: '',
};

/** provider/model/推理档的取值白名单：只放行常规标识符，杜绝把任意字符串拼进上游请求。 */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/;

/**
 * 决定这一次调用用哪个模型：请求里带了合法的 provider+model 就跟随界面选择，
 * 否则退回插件配置的默认模型（客户端读不到模型时也不会失败）。
 * @param {any} payload 请求体
 * @param {typeof DEFAULTS} options 生效配置
 * @returns {{ provider: string, model: string, reasoningEffort: string }}
 */
function resolveModel(payload, options) {
  const pick = (value) => (typeof value === 'string' && MODEL_ID_PATTERN.test(value.trim()) ? value.trim() : void 0);
  const provider = pick(payload?.provider);
  const model = pick(payload?.model);
  const follow = provider !== void 0 && model !== void 0;
  const effort = follow ? pick(payload?.reasoningEffort) : void 0;
  return {
    provider: follow ? provider : options.provider,
    model: follow ? model : options.model,
    reasoningEffort: effort !== void 0 ? effort : options.reasoningEffort,
  };
}

/**
 * 读请求体，超过上限直接拒绝，避免把大对象读进内存。
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<string>}
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        // 不能在这里 req.destroy()：调用方要回 413，而销毁 socket 会让浏览器
        // 收到 ECONNRESET 而不是状态码。改为丢弃已读数据、继续 drain 剩余
        // 请求体，让响应能正常写出去。
        settled = true;
        chunks.length = 0;
        reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

/**
 * 统一的 JSON 响应。
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * 单轮调用模型并把 text-delta 拼起来。
 * @param {{ stream: (options: unknown) => AsyncIterable<any> }} llm
 * @param {{ provider: string, model: string, reasoningEffort?: string, system: string, input: string, timeoutMs: number }} options
 * @returns {Promise<{ ok: true, text: string } | { ok: false, status: number, code: string, message: string }>}
 */
async function enhance(llm, options) {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: options.system }] },
    { role: 'user', content: [{ type: 'text', text: buildUserPrompt(options.input) }] },
  ];

  let stream;
  const consume = async () => {
    let acc = '';
    let failure;
    const request = { provider: options.provider, model: options.model, messages };
    if (typeof options.reasoningEffort === 'string' && options.reasoningEffort !== '') {
      request.reasoningEffort = options.reasoningEffort;
    }
    stream = llm.stream(request);
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') acc += chunk.text;
      else if (chunk.type === 'finish') {
        if (chunk.reason && chunk.reason.kind === 'error') failure = chunk.reason.failure;
        else if (chunk.reason && chunk.reason.kind === 'aborted') {
          return { ok: false, status: 499, code: 'ABORTED', message: '增强调用被中止' };
        }
        break;
      }
    }
    if (failure) {
      return {
        ok: false,
        status: 502,
        code: String(failure.code ?? 'LLM_FAILED'),
        message: String(failure.message ?? '模型调用失败'),
      };
    }
    return { ok: true, text: cleanEnhancedText(acc) };
  };

  let timer;
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve({ ok: false, status: 504, code: 'TIMEOUT', message: '增强调用超时' });
    }, options.timeoutMs);
  });

  // consume() 可能在本函数返回之后才失败（超时已经赢了 race）。
  // 不接住这个 rejection 会变成 unhandledRejection，直接把宿主进程带崩。
  const consuming = consume().catch((error) => ({
    ok: false,
    status: 502,
    code: String(error?.code ?? 'LLM_FAILED'),
    message: String(error?.message ?? '模型调用失败'),
  }));

  try {
    return await Promise.race([consuming, timeout]);
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: String(error?.code ?? 'LLM_FAILED'),
      message: String(error?.message ?? '模型调用失败'),
    };
  } finally {
    clearTimeout(timer);
    // 超时只是不再等待，上游流仍然活着并继续产生 token（照旧计费）。
    // 必须显式关闭它——对异步生成器调用 return() 会执行其 finally，
    // 从而断开上游连接。
    if (timedOut && stream !== undefined) {
      try {
        await stream.return?.();
      } catch {
        // 已经结束/已经关闭，无需处理。
      }
    }
  }
}

/**
 * 插件入口。
 * @param {any} ctx cordis Context
 * @param {Partial<typeof DEFAULTS>} [config]
 */
export function apply(ctx, config) {
  const options = { ...DEFAULTS, ...(config ?? {}) };
  const system = options.systemPrompt && options.systemPrompt.trim() !== ''
    ? options.systemPrompt
    : SYSTEM_PROMPT;

  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
      const handler = async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = url.pathname;
        if (!pathname.startsWith(`${API_PREFIX}/`)) {
          sendJson(res, 404, { error: 'NOT_FOUND' });
          return;
        }

        // 认证：交给 dsh-client-connection 的 Host/Origin 栅栏 + 浏览器 Cookie 校验，
        // 这样即便 59543 端口被隧道暴露到公网，本端点也不会变成公开的免费模型代理。
        const connection = hostCtx.get('connection');
        if (connection && typeof connection.requestRejection === 'function') {
          const rejection = connection.requestRejection(req);
          if (rejection !== undefined) {
            sendJson(res, rejection, { error: rejection === 403 ? 'FORBIDDEN' : 'UNAUTHORIZED' });
            return;
          }
        }

        const action = pathname.slice(API_PREFIX.length + 1);
        if (action === 'health') {
          if (req.method !== 'GET') {
            sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
            return;
          }
          sendJson(res, 200, { ok: true, provider: options.provider, model: options.model });
          return;
        }

        if (action !== 'enhance') {
          sendJson(res, 404, { error: 'NOT_FOUND' });
          return;
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }

        let payload;
        try {
          payload = JSON.parse(await readBody(req, options.maxBodyBytes));
        } catch (error) {
          const tooLarge = error?.code === 'BODY_TOO_LARGE';
          sendJson(res, tooLarge ? 413 : 400, { error: tooLarge ? 'BODY_TOO_LARGE' : 'INVALID_JSON' });
          return;
        }

        const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
        if (text === '') {
          sendJson(res, 400, { error: 'EMPTY_INPUT' });
          return;
        }
        if (text.length > options.maxInputChars) {
          sendJson(res, 400, { error: 'INPUT_TOO_LONG', limit: options.maxInputChars });
          return;
        }

        const llm = hostCtx.get('llm');
        if (!llm || typeof llm.stream !== 'function') {
          sendJson(res, 503, { error: 'NO_LLM_SERVICE' });
          return;
        }

        const target = resolveModel(payload, options);
        const result = await enhance(llm, {
          provider: target.provider,
          model: target.model,
          reasoningEffort: target.reasoningEffort,
          system,
          input: text,
          timeoutMs: options.timeoutMs,
        });

        if (!result.ok) {
          sendJson(res, result.status, { error: result.code, message: result.message });
          return;
        }
        if (result.text === '') {
          sendJson(res, 502, { error: 'EMPTY_ENHANCEMENT', message: '模型没有返回可用文本' });
          return;
        }
        sendJson(res, 200, {
          text: result.text,
          provider: target.provider,
          model: target.model,
          followed: target.provider !== options.provider || target.model !== options.model,
        });
      };

      const dispose = hostCtx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler });
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    }, 'dsh-prompt-enhance: http routes');
  });
}

/**
 * 导出给测试与上层复用：
 *  - `resolveModel`：请求体 → 生效模型的解析（含白名单校验）；
 *  - `MODEL_ID_PATTERN`：provider/model 的白名单正则，客户端若要预校验可复用；
 *  - `DEFAULTS`：生效默认值，便于断言。
 */
export { resolveModel, MODEL_ID_PATTERN, DEFAULTS };
