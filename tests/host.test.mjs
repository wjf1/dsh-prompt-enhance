import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { apply, API_PREFIX, resolveModel } from '../lib/index.js';

/** 造一个够用的假 ctx：捕获路由、按名字交付服务。 */
function makeHost({ llm, connection, config } = {}) {
  const routes = [];
  const ctx = {
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
    get(name) {
      if (name === 'llm') return llm;
      if (name === 'connection') return connection;
      return undefined;
    },
    inject(_names, callback) {
      callback(ctx);
    },
    effect(effect) {
      return effect();
    },
  };
  apply(ctx, config);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].kind, 'prefix');
  assert.equal(routes[0].path, API_PREFIX);
  return routes[0];
}

/** 假响应对象，收集 status / headers / body。 */
function makeResponse() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = { ...headers };
      return this;
    },
    end(body) {
      this.body = body ?? '';
      return this;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
  return res;
}

/** 把 JSON 请求体包成 IncomingMessage 形状。 */
function makeRequest({ method = 'POST', path = `${API_PREFIX}/enhance`, body, headers = {} } = {}) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(payload);
  req.method = method;
  req.url = path;
  req.headers = headers;
  return req;
}

/** 默认假 LLM：一次 text-delta + 正常结束。 */
function makeLlm(reply = '请解释这段代码的主要功能、执行流程和关键逻辑。') {
  const calls = [];
  return {
    calls,
    stream(options) {
      calls.push(options);
      // 用 | 分段模拟流式输出，段之间补换行（真实模型的代码围栏自带换行）。
      const pieces = reply.split('|');
      return (async function* () {
        for (let i = 0; i < pieces.length; i += 1) {
          yield { type: 'text-delta', text: i === 0 ? pieces[i] : `\n${pieces[i]}` };
        }
        yield { type: 'finish', reason: { kind: 'stop' } };
      })();
    },
  };
}

test('成功路径：返回清洗后的文本，且两条消息结构正确', async () => {
  const llm = makeLlm('```text|请把周报写清楚：包含本周进展、风险与下周计划|```');
  const route = makeHost({ llm });
  const res = makeResponse();
  await route.handler(makeRequest({ body: { text: '帮我写个周报' } }), res);

  assert.equal(res.status, 200);
  assert.equal(res.json().text, '请把周报写清楚：包含本周进展、风险与下周计划');
  assert.equal(res.json().provider, 'acme');
  assert.equal(res.json().model, 'cn:deepseek-v4.1-flash');
  assert.equal(res.json().followed, false);
  assert.equal(llm.calls.length, 1);
  const call = llm.calls[0];
  assert.equal(call.provider, 'acme');
  assert.equal(call.model, 'cn:deepseek-v4.1-flash');
  assert.equal(call.messages[0].role, 'system');
  assert.equal(call.messages[1].role, 'user');
  assert.match(call.messages[1].content[0].text, /帮我写个周报/);
  assert.ok(!call.messages[1].content[0].text.includes('{{input}}'));
});

test('空输入 / 超长输入 / 坏 JSON 分别返回 400 且不调用模型', async () => {
  const llm = makeLlm();
  const route = makeHost({ llm, config: { maxInputChars: 5 } });

  const empty = makeResponse();
  await route.handler(makeRequest({ body: { text: '   ' } }), empty);
  assert.equal(empty.status, 400);
  assert.equal(empty.json().error, 'EMPTY_INPUT');

  const tooLong = makeResponse();
  await route.handler(makeRequest({ body: { text: '一二三四五六' } }), tooLong);
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.json().error, 'INPUT_TOO_LONG');

  const badJson = makeResponse();
  const badReq = Readable.from([Buffer.from('{not json')]);
  badReq.method = 'POST';
  badReq.url = `${API_PREFIX}/enhance`;
  badReq.headers = {};
  await route.handler(badReq, badJson);
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json().error, 'INVALID_JSON');

  assert.equal(llm.calls.length, 0);
});

test('方法与路径守卫：GET 增强 405，未知动作 404，health 200', async () => {
  const route = makeHost({ llm: makeLlm() });

  const getEnhance = makeResponse();
  await route.handler(makeRequest({ method: 'GET' }), getEnhance);
  assert.equal(getEnhance.status, 405);

  const unknown = makeResponse();
  await route.handler(makeRequest({ path: `${API_PREFIX}/nope`, body: {} }), unknown);
  assert.equal(unknown.status, 404);

  const health = makeResponse();
  await route.handler(makeRequest({ method: 'GET', path: `${API_PREFIX}/health` }), health);
  assert.equal(health.status, 200);
  assert.deepEqual(health.json(), { ok: true, provider: 'acme', model: 'cn:deepseek-v4.1-flash' });
});

test('浏览器会话栅栏拒绝时必须 403，且不消耗模型调用', async () => {
  const llm = makeLlm();
  const route = makeHost({ llm, connection: { requestRejection: () => 403 } });
  const res = makeResponse();
  await route.handler(makeRequest({ body: { text: '帮我写个周报' } }), res);
  assert.equal(res.status, 403);
  assert.equal(res.json().error, 'FORBIDDEN');
  assert.equal(llm.calls.length, 0);
});

test('模型报错时透传 502 与错误码', async () => {
  const llm = {
    stream() {
      return (async function* () {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'bad key' } } };
      })();
    },
  };
  const route = makeHost({ llm });
  const res = makeResponse();
  await route.handler(makeRequest({ body: { text: '帮我写个周报' } }), res);
  assert.equal(res.status, 502);
  assert.equal(res.json().error, 'AUTH');
  assert.equal(res.json().message, 'bad key');
});

test('模型返回空文本时 502 EMPTY_ENHANCEMENT', async () => {
  const route = makeHost({ llm: makeLlm('   ') });
  const res = makeResponse();
  await route.handler(makeRequest({ body: { text: '帮我写个周报' } }), res);
  assert.equal(res.status, 502);
  assert.equal(res.json().error, 'EMPTY_ENHANCEMENT');
});

test('缺少 llm 服务时 503 而不是抛异常', async () => {
  const route = makeHost({ llm: undefined });
  const res = makeResponse();
  await route.handler(makeRequest({ body: { text: '帮我写个周报' } }), res);
  assert.equal(res.status, 503);
  assert.equal(res.json().error, 'NO_LLM_SERVICE');
});

test('跟随界面模型：合法 provider/model/reasoningEffort 透传给 llm.stream', async () => {
  const llm = makeLlm('增强结果');
  const route = makeHost({ llm });
  const res = makeResponse();
  await route.handler(
    makeRequest({
      body: { text: '写周报', provider: 'acme', model: 'cn:deepseek-v4.1-pro', reasoningEffort: 'max' },
    }),
    res,
  );
  assert.equal(res.status, 200);
  assert.equal(llm.calls[0].provider, 'acme');
  assert.equal(llm.calls[0].model, 'cn:deepseek-v4.1-pro');
  assert.equal(llm.calls[0].reasoningEffort, 'max');
  assert.equal(res.json().followed, true);
  assert.equal(res.json().text, '增强结果');
});

test('非法模型标识回落插件默认值（不让请求体决定上游路由）', async () => {
  const llm = makeLlm('增强结果');
  const route = makeHost({ llm, config: { provider: 'acme', model: 'safe-model' } });
  const res = makeResponse();
  await route.handler(makeRequest({ body: { text: '写周报', provider: '../../etc', model: 'x y' } }), res);
  assert.equal(res.status, 200);
  assert.equal(llm.calls[0].provider, 'acme');
  assert.equal(llm.calls[0].model, 'safe-model');
  assert.equal(llm.calls[0].reasoningEffort, undefined);
  assert.equal(res.json().followed, false);
});

test('resolveModel 单元：缺字段、空串、超长都回落默认', () => {
  const defaults = { provider: 'acme', model: 'safe-model', reasoningEffort: '' };
  assert.deepEqual(resolveModel({}, defaults), { provider: 'acme', model: 'safe-model', reasoningEffort: '' });
  assert.deepEqual(resolveModel({ provider: '', model: 'x' }, defaults), {
    provider: 'acme',
    model: 'safe-model',
    reasoningEffort: '',
  });
  assert.deepEqual(resolveModel({ provider: 'p', model: 'm'.repeat(300) }, defaults), {
    provider: 'acme',
    model: 'safe-model',
    reasoningEffort: '',
  });
  assert.deepEqual(resolveModel({ provider: 'p', model: 'm' }, { ...defaults, reasoningEffort: 'high' }), {
    provider: 'p',
    model: 'm',
    reasoningEffort: 'high',
  });
});
