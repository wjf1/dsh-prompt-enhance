import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { API_PREFIX } from '../lib/index.js';

/**
 * 客户端半是运行时用 `new Function` 拼接的脚本片段，不能 `import` 本地模块，
 * 所以前缀只能在两处各写一份。这里用测试锁住"两份必须相同"，
 * 避免哪天改了 host 的 API_PREFIX 却忘了客户端。
 */
test('客户端与宿主半的 API 前缀保持一致', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const found = /const\s+API\s*=\s*'([^']+)'/.exec(source);
  assert.notEqual(found, null, 'lib/client.js 里应能定位到 API 常量');
  assert.equal(found[1], API_PREFIX, 'client 的 API 前缀与 lib/index.js 的 API_PREFIX 不一致');
});

/**
 * 客户端半的验收不需要真 React/DOM：插件工厂只从 require('react') 取
 * useState/useRef/useEffect/useCallback 与 createElement。这里用一个最小实现
 * 驱动组件函数，直接断言它产出的元素树和副作用（setDraft / fetch），
 * 从而在重启 DSH 之前就锁死「点击→加载→替换→撤销→取消→失败」的状态机。
 */
function makeRuntime() {
  const slots = [];
  let cursor = 0;
  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      const slot = slots[index];
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(fn) {
      cursor += 1;
      fn(); // 每个渲染周期都跑一次；组件里的 effect 都是幂等的。
    },
    useCallback(fn) {
      cursor += 1;
      return fn;
    },
    useMemo(fn) {
      cursor += 1;
      return fn();
    },
    Fragment: Symbol.for('react.fragment'),
    /**
     * 极简版 useSyncExternalStore：只返回当前快照，不做订阅重放。
     * 组件里读草稿的正确性不依赖它（点击时会重新 getSnapshot），
     * 所以这一层只验证「取到的快照形状对了」。
     */
    useSyncExternalStore(_subscribe, getSnapshot) {
      cursor += 1;
      return getSnapshot();
    },
  };
  return {
    React,
    reset() {
      slots.length = 0;
      cursor = 0;
    },
    render(Component, props) {
      cursor = 0;
      return Component(props);
    },
  };
}

/** 加载 client.js，返回它注册给 __ModuleLoader__ 的模块。 */
function loadClient() {
  // 相对本测试文件解析，测试才能在任何机器上跑（原来硬编码作者本机的绝对路径）。
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  const runtime = makeRuntime();
  let factory;
  const windowStub = {
    __ModuleLoader__: {
      load(options) {
        assert.equal(options.id, 'dsh-prompt-enhance');
        factory = options.factory;
      },
    },
  };
  new Function('window', 'require', `${source}\n;return window.__ModuleLoader__;`)(windowStub, (name) =>
    name === 'react' ? runtime.React : undefined,
  );
  assert.equal(typeof factory, 'function', 'client.js 必须向 __ModuleLoader__ 注册工厂');
  return { module: factory((name) => (name === 'react' ? runtime.React : undefined)), runtime };
}

const { module: client, runtime } = loadClient();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 在元素树里按 data-dsh-prompt-enhance 找按钮（组件可能返回 Fragment）。 */
function findSlot(node, marker) {
  if (node === null || node === void 0 || typeof node !== 'object') return void 0;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findSlot(child, marker);
      if (hit !== void 0) return hit;
    }
    return void 0;
  }
  if (node.props && node.props['data-dsh-prompt-enhance'] === marker) return node;
  const children = node.props && node.props.children;
  if (children !== void 0) return findSlot(children, marker);
  return void 0;
}

/**
 * 挂载按钮，并模拟真实的草稿存储：setDraft 会真的改草稿并触发下一次渲染。
 * @param {string} draft 初始草稿
 * @param {object} extra 追加的 props（例如 readModel）
 */
function mount(draft = '帮我写个周报', extra = {}) {
  runtime.reset();
  const state = { draft };
  const writes = [];
  const props = {
    useInput: () => ({ draft: state.draft }),
    inputActions: {
      setDraft(text) {
        writes.push(text);
        state.draft = text;
      },
    },
    ...extra,
  };
  const view = {
    state,
    writes,
    tree: undefined,
    element: undefined,
    diff: undefined,
    render() {
      view.tree = runtime.render(client.EnhanceButton, props);
      view.element = findSlot(view.tree, 'sparkle');
      view.undo = findSlot(view.tree, 'undo');
      view.diff = findSlot(view.tree, 'diff');
      return view.element;
    },
    click() {
      view.element.props.onClick();
      return view;
    },
  };
  view.render();
  return view;
}

test('空草稿：置灰 + 中文无障碍名称 + 相位属性', () => {
  const view = mount('   ');
  assert.equal(view.element.type, 'button');
  assert.equal(view.element.props.disabled, true);
  assert.equal(view.element.props.title, '增强提示词');
  assert.equal(view.element.props['aria-label'], '增强提示词');
  assert.equal(view.element.props['data-dsh-prompt-enhance'], 'sparkle');
  assert.equal(view.element.props['data-phase'], 'idle');
  assert.equal(view.element.props.type, 'button');
});

test('有草稿可点：busy → 写回增强文本 → 出现撤销/差异按钮 → 撤销回原文', async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ text: '请把周报写清楚：进展、风险、下周计划' }) };
  };
  const view = mount('帮我写个周报');
  assert.equal(view.element.props.disabled, false);
  assert.equal(view.undo, undefined, '未增强时不出现撤销按钮');
  assert.equal(view.diff, undefined, '未增强时不出现差异按钮');

  view.click().render();
  assert.equal(view.element.props['data-phase'], 'busy');
  assert.equal(view.element.props.title, '正在增强（点击取消）');

  await flush();
  view.render();
  assert.equal(view.element.props['data-phase'], 'idle');
  assert.equal(view.element.props['data-depth'], 1);
  assert.match(view.element.props.title, /还有 1 层可撤销/);
  assert.deepEqual(view.writes, ['请把周报写清楚：进展、风险、下周计划']);
  assert.equal(view.state.draft, '请把周报写清楚：进展、风险、下周计划');

  // 接口契约：POST 到固定端点，带 same-origin 凭据与 {text} 体。
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/dsh-prompt-enhance/api/enhance');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(requests[0].options.body), { text: '帮我写个周报' });

  // ↺ 撤销：恢复原文，撤销按钮随之消失。
  assert.equal(view.undo.props.title, '恢复原文');
  view.undo.props.onClick();
  view.render();
  assert.deepEqual(view.writes, ['请把周报写清楚：进展、风险、下周计划', '帮我写个周报']);
  assert.equal(view.state.draft, '帮我写个周报');
  assert.equal(view.element.props['data-depth'], 0);
  assert.equal(view.undo, undefined);
});

test('加载中再点一次 = 取消：abort 请求、不写草稿、回到 idle', async () => {
  let abortSignal;
  globalThis.fetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      abortSignal = options.signal;
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    });
  const view = mount();
  view.click().render();
  view.click(); // 此时 handler 属于 busy 相位，等于取消
  await flush();
  view.render();
  assert.equal(abortSignal.aborted, true);
  assert.equal(view.element.props['data-phase'], 'idle');
  assert.deepEqual(view.writes, []);
  assert.equal(view.state.draft, '帮我写个周报');
});

test('期间用户改了草稿：放弃结果，绝不覆盖用户输入', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ text: '增强后的提示词' }) });
  const view = mount('帮我写个周报');
  view.click().render();
  view.state.draft = '帮我写个周报，重点写埋点'; // 用户在等待期间继续打字
  view.render();
  await flush();
  view.render();
  assert.deepEqual(view.writes, []);
  assert.equal(view.element.props['data-phase'], 'error');
  assert.match(view.element.props.title, /草稿已修改/);
  assert.equal(view.state.draft, '帮我写个周报，重点写埋点');
});

test('失败：显示中文原因并可点击重试', async () => {
  let fail = true;
  globalThis.fetch = async () =>
    fail
      ? { ok: false, status: 502, json: async () => ({ error: 'TIMEOUT', message: '增强调用超时' }) }
      : { ok: true, status: 200, json: async () => ({ text: '增强后的提示词' }) };
  const view = mount();
  view.click().render();
  await flush();
  view.render();
  assert.equal(view.element.props['data-phase'], 'error');
  assert.match(view.element.props.title, /模型响应超时/);
  assert.deepEqual(view.writes, []);

  fail = false;
  view.click().render(); // 错误态下再点 = 重试
  await flush();
  view.render();
  assert.equal(view.element.props['data-phase'], 'idle');
  assert.equal(view.element.props['data-depth'], 1);
  assert.deepEqual(view.writes, ['增强后的提示词']);
});

test('用户改完草稿后撤销点失效，不会把旧文本盖回来', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ text: '增强后的提示词' }) });
  const view = mount('原始草稿');
  view.click().render();
  await flush();
  view.render();
  assert.equal(view.element.props['data-depth'], 1);
  assert.equal(view.undo.props['data-dsh-prompt-enhance'], 'undo');

  view.state.draft = '增强后的提示词，再加一句';
  view.render(); // effect 发现草稿被改，安排回 idle
  view.render(); // 下一帧读到 idle
  assert.equal(view.element.props['data-phase'], 'idle');
  // 此时按钮回到 ✨ 语义，撤销点也随之消失：不会把旧文本盖回来。
  assert.equal(view.element.props.title, '增强提示词');
  assert.equal(view.undo, undefined);
  assert.deepEqual(view.writes, ['增强后的提示词']);
  assert.equal(view.state.draft, '增强后的提示词，再加一句');
});

test('错误码翻译覆盖宿主真正会返回的取值', () => {
  const { describeError } = client;
  assert.equal(describeError('UNAUTHORIZED'), '会话校验失败，请刷新页面');
  assert.equal(describeError('NO_LLM_SERVICE'), '宿主没有可用的模型服务');
  assert.equal(describeError('TIMEOUT'), '模型响应超时');
  assert.equal(describeError('INPUT_TOO_LONG'), '草稿太长');
  assert.equal(describeError('SOMETHING_ELSE', '底层炸了'), '底层炸了');
  assert.equal(describeError('SOMETHING_ELSE'), '增强失败');
});

/**
 * 造一个与 SessionInputShell 同形的输入 facade：state 是快照 store，actions 带 setDraft。
 * @param {string} draft 初始草稿
 */
function makeFacade(draft) {
  const state = { draft };
  const writes = [];
  const listeners = new Set();
  const facade = {
    state: {
      getSnapshot: () => ({ draft: state.draft, phase: 'idle' }),
      subscribe: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    actions: {
      setDraft(text) {
        writes.push(text);
        state.draft = text;
        for (const fn of listeners) fn();
      },
    },
  };
  return { facade, state, writes };
}

/** 用 input facade（本插件 inject 的正常路径）挂载按钮。 */
function mountWithFacade(draft = '帮我写个周报') {
  runtime.reset();
  const made = makeFacade(draft);
  const view = {
    state: made.state,
    writes: made.writes,
    element: undefined,
    diff: undefined,
    render() {
      const tree = runtime.render(client.EnhanceButton, { input: made.facade });
      view.element = findSlot(tree, 'sparkle');
      view.undo = findSlot(tree, 'undo');
      view.diff = findSlot(tree, 'diff');
      return view.element;
    },
    click() {
      view.element.props.onClick();
      return view;
    },
  };
  view.render();
  return view;
}

test('主路径：inject 传入的 input facade 能读草稿、能写回', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ text: '增强后的提示词' }) });
  const view = mountWithFacade('帮我写个周报');
  assert.equal(view.element.props.disabled, false, '有草稿时按钮可点');
  view.click().render();
  await flush();
  view.render();
  assert.equal(view.element.props['data-depth'], 1);
  assert.deepEqual(view.writes, ['增强后的提示词']);
  assert.equal(view.state.draft, '增强后的提示词');
});

test('主路径：空草稿置灰，disabled 来自 facade 快照而不是 props.useInput', () => {
  const view = mountWithFacade('');
  assert.equal(view.element.props.disabled, true);
});

test('兜底路径：只有父级透传的 keyboard（shell 同形）也能工作', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ text: '增强后的提示词' }) });
  runtime.reset();
  const made = makeFacade('帮我写个周报');
  runtime.render(client.EnhanceButton, { keyboard: made.facade }).props.onClick();
  await flush();
  assert.deepEqual(made.writes, ['增强后的提示词']);
});

test('apply 注册到 conversation.input.right，且 id/order 固定', () => {
  const registered = [];
  const injected = [];
  const ctx = {
    inject(names, fn) {
      injected.push(names);
      fn({
        slots: {
          inject(name, factory) {
            return factory();
          },
          register(descriptor, component) {
            registered.push({ descriptor, component });
            return () => {};
          },
        },
        sessions: { scope: () => undefined },
      });
    },
  };
  client.apply(ctx);
  assert.deepEqual(injected, [['slots', 'sessions']]);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].descriptor.name, 'conversation.input.right');
  assert.equal(registered[0].descriptor.id, 'prompt-enhance');
  // 50：排在视觉路由「识图」（40）之后，紧贴模型选择器左侧，对齐 WorkBuddy 的 ✨ 位置
  assert.equal(registered[0].descriptor.order, 50);
  assert.equal(registered[0].component, client.EnhanceButton);
  assert.deepEqual(client.inject, ['slots', 'sessions']);
});

test('resolveInputProps：正常链路拿到会话输入 facade，链路缺失时安全返回 {}', () => {
  const { resolveInputProps } = client;
  const facade = { state: { getSnapshot: () => ({ draft: 'x' }) }, actions: {} };
  const actx = {
    get: (name) => (name === 'conversation' ? { input: { for: (scope) => (scope === actx ? facade : undefined) } } : undefined),
  };
  const scope = { sessions: { scope: (id) => (id === 'session-1' ? actx : undefined) } };
  assert.deepEqual(resolveInputProps(scope, 'session-1'), { input: facade });
  // 会话不存在：不抛错，返回空对象（组件退回 keyboard/legacy 路径）
  assert.deepEqual(resolveInputProps(scope, 'session-2'), {});
  // 服务完全不可用
  assert.deepEqual(resolveInputProps({}, 'session-1'), {});
  // input.for 抛错也不许冒泡到插槽渲染
  const throwing = {
    sessions: { scope: () => ({ get: () => ({ input: { for: () => { throw new Error('no retained binding'); } } }) }) },
  };
  assert.deepEqual(resolveInputProps(throwing, 'session-1'), {});
});

test('多层撤销：连续增强两层后可逐层退回原文', async () => {
  let round = 0;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ text: round++ === 0 ? '第一版增强' : '第二版增强' }),
  });
  const view = mount('原文草稿');
  view.click().render();
  await flush();
  view.render();
  assert.equal(view.state.draft, '第一版增强');
  assert.equal(view.element.props['data-depth'], 1);

  // 对已增强的文本再点一次 ✨ = 再增强一层（而不是撤销）。
  view.click().render();
  await flush();
  view.render();
  assert.equal(view.state.draft, '第二版增强');
  assert.equal(view.element.props['data-depth'], 2);
  assert.match(view.undo.props.title, /还有 1 层/);

  view.undo.props.onClick();
  view.render();
  assert.equal(view.state.draft, '第一版增强');
  assert.equal(view.element.props['data-depth'], 1);

  view.undo.props.onClick();
  view.render();
  assert.equal(view.state.draft, '原文草稿');
  assert.equal(view.element.props['data-depth'], 0);
  assert.equal(view.undo, undefined);
});

test('跟随界面模型：readModel 的 provider/model/reasoningEffort 进请求体', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ text: '增强后' }) };
  };
  const view = mount('写个周报', {
    readModel: () => ({ provider: 'acme', model: 'cn:deepseek-v4.1-flash', reasoningEffort: 'max' }),
  });
  view.click().render();
  await flush();
  view.render();
  assert.deepEqual(bodies[0], {
    text: '写个周报',
    provider: 'acme',
    model: 'cn:deepseek-v4.1-flash',
    reasoningEffort: 'max',
  });
});

test('readModel 抛错或返回畸形值时退回宿主默认，不影响增强', async () => {
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ text: '增强后' }) };
  };
  const boom = mount('写个周报', {
    readModel: () => {
      throw new Error('模型目录没就绪');
    },
  });
  boom.click().render();
  await flush();
  boom.render();
  assert.deepEqual(bodies[0], { text: '写个周报' });
  assert.equal(boom.state.draft, '增强后');
});

test('差异算法：删/增逐字标出，统计与净字数自洽', () => {
  const { diffSegments, diffStats } = client;
  const before = '请帮我写周报';
  const after = '请帮我写一份结构化的周报';
  const segs = diffSegments(before, after);
  assert.ok(segs.length > 1);
  for (const seg of segs) assert.ok(['equal', 'ins', 'del'].includes(seg.type), seg.type);
  const keep = segs.filter((s) => s.type !== 'ins').map((s) => s.text).join('');
  const keepAdd = segs.filter((s) => s.type !== 'del').map((s) => s.text).join('');
  assert.equal(keep, before, '去掉新增后必须还原原文');
  assert.equal(keepAdd, after, '去掉删除后必须还原增强文本');

  const stats = diffStats(before, after);
  assert.equal(stats.added, segs.filter((s) => s.type === 'ins').reduce((n, s) => n + s.text.length, 0));
  assert.equal(stats.removed, segs.filter((s) => s.type === 'del').reduce((n, s) => n + s.text.length, 0));
  assert.equal(stats.delta, after.length - before.length);
  assert.ok(stats.changed >= 1);

  const same = diffStats('一样的内容', '一样的内容');
  assert.equal(same.changed, 0);
  assert.equal(same.delta, 0);
  assert.deepEqual(diffSegments('一样', '一样'), [{ type: 'equal', text: '一样' }]);
});

test('makeModelReader：正常读到当前模型，服务缺失或抛错时安全返回 undefined', () => {
  const { makeModelReader } = client;
  const current = { provider: 'acme', model: 'cn:deepseek-v4.1-flash', reasoningEffort: 'max' };
  const scope = {
    get: (name) =>
      name === 'modelDirectories'
        ? { directoryFor: () => ({ store: { getSnapshot: () => ({ current }) } }) }
        : undefined,
  };
  assert.deepEqual(makeModelReader(scope, 's1')(), current);
  assert.equal(makeModelReader({ get: () => undefined }, 's1'), undefined);

  const broken = {
    get: (name) =>
      name === 'modelDirectories'
        ? {
            directoryFor: () => {
              throw new Error('未就绪');
            },
          }
        : undefined,
  };
  assert.equal(makeModelReader(broken, 's1')(), undefined);
});

test('segmentsToLines：按换行切行，类型保留，空行丢弃', () => {
  const { segmentsToLines } = client;
  const lines = segmentsToLines([
    { type: 'equal', text: '第一行完整' },
    { type: 'ins', text: '新增A\n新增B' },
    { type: 'del', text: '删掉' },
    { type: 'equal', text: '\n\n第三行' },
  ]);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], [
    { type: 'equal', text: '第一行完整' },
    { type: 'ins', text: '新增A' },
  ]);
  assert.deepEqual(lines[1], [
    { type: 'ins', text: '新增B' },
    { type: 'del', text: '删掉' },
  ]);
  assert.deepEqual(lines[2], [{ type: 'equal', text: '第三行' }]);
  const joined = lines.flat().map((seg) => seg.text).join('');
  assert.equal(joined.includes('\n'), false, '切行后不应残留换行符');
});

test('差异卡样式：深浅主题都可读（不写死浅色文字，字号/行距/滚动齐备）', () => {
  const css = client.css;
  assert.ok(typeof css === 'string' && css.length > 0);
  const insRule = css.match(/\.dsh-prompt-enhance__ins \{([^}]*)\}/);
  const delRule = css.match(/\.dsh-prompt-enhance__del \{([^}]*)\}/);
  assert.ok(insRule, '缺少 __ins 规则');
  assert.ok(delRule, '缺少 __del 规则');
  assert.match(insRule[1], /color: inherit/, '新增高亮必须继承主题文字色，不能写死浅绿');
  assert.match(delRule[1], /color-mix\(in srgb, currentColor/, '删除文字色必须由主题色推导');
  assert.doesNotMatch(css, /#7ee2a8|#ff9d98/, '不得残留只适配深色主题的浅色字');
  assert.match(css, /font-size: 13px/, '卡片正文字号不应小于 13px');
  assert.match(css, /line-height: 1\.6/, '正文行距应 >= 1.6');
  assert.match(css, /flex: 1 1 auto/, '正文应自适应卡片高度');
  assert.match(css, /overflow: auto/, '长文需要滚动');
  assert.match(css, /\.dsh-prompt-enhance__line/, '需要逐行渲染');
  assert.match(css, /__legendSwatch/, '需要颜色图例');
});


