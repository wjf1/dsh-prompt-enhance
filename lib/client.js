/**
 * Client 半：在输入框右侧（模型选择器左边）渲染 WorkBuddy 同款的「增强提示词」✨ 按钮。
 *
 * 交互对标 WorkBuddy 桌面端：
 *  - 空草稿时按钮置灰不可点；
 *  - 点击 → 转圈，再点一次 = 取消（不发第二次请求、不吞掉草稿）；
 *  - 成功 → 原地替换草稿，按钮变成「↺ 恢复原文」，再点一次撤销回增强前的文本；
 *  - 失败 → 按钮短暂变红，hover 显示原因，再点即重试；
 *  - 用户自己改了草稿 → 自动放弃撤销点，避免把用户的编辑覆盖回旧文本。
 *
 * 输入框读写不依赖未文档化的 props：宿主半通过 slot 的 inject(sessionId)
 * 把会话输入 facade 直接算好交给组件；同时兼容父级插槽透传的 keyboard（即 shell）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-enhance',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useSyncExternalStore, useRef, useState } = React;

    /** react-dom 只用来挂浮层；拿不到时差异卡退化成不显示（按钮与撤销不受影响）。 */
    let ReactDOM = null;
    try {
      ReactDOM = require('react-dom');
    } catch (_) {
      ReactDOM = null;
    }

    /** 端点前缀，必须与宿主半 lib/index.js 的 API_PREFIX 一致。 */
    const API = '/dsh-prompt-enhance/api';
    /** 样式表 id，避免重复注入；前缀已做命名空间隔离。 */
    const STYLE_ID = 'dsh-prompt-enhance-style';

    const CSS = `
.dsh-prompt-enhance__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  opacity: 0.72;
  cursor: pointer;
  transition: background-color 120ms ease, opacity 120ms ease, color 120ms ease;
}
.dsh-prompt-enhance__btn:hover:not(:disabled) { background: color-mix(in srgb, currentColor 14%, transparent); opacity: 1; }
.dsh-prompt-enhance__btn:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 45%, transparent); outline-offset: 1px; }
.dsh-prompt-enhance__btn:disabled { opacity: 0.32; cursor: not-allowed; }
.dsh-prompt-enhance__btn[data-tone="error"] { color: #e5484d; opacity: 1; }
.dsh-prompt-enhance__btn[data-tone="busy"] { opacity: 1; }
.dsh-prompt-enhance__btn[data-tone="done"] { opacity: 0.95; }
.dsh-prompt-enhance__spin { animation: dsh-prompt-enhance__spin 900ms linear infinite; }
@keyframes dsh-prompt-enhance__spin { to { transform: rotate(360deg); } }
.dsh-prompt-enhance__btn[data-role="diff"],
.dsh-prompt-enhance__btn[data-role="undo"] { width: 24px; height: 24px; opacity: 0.68; font-size: 13px; line-height: 1; }
.dsh-prompt-enhance__group { display: inline-flex; align-items: center; gap: 2px; }
.dsh-prompt-enhance__card {
  position: fixed;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 10px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-module-platform, #1b1b1f);
  color: var(--dsw-alias-label-primary, inherit);
  border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  max-height: min(60vh, 480px);
  box-sizing: border-box;
}
.dsh-prompt-enhance__cardHead { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; }
.dsh-prompt-enhance__cardTitle { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }
.dsh-prompt-enhance__cardStat {
  font-size: 12px;
  font-weight: 400;
  color: color-mix(in srgb, currentColor 66%, transparent);
  font-variant-numeric: tabular-nums;
}
.dsh-prompt-enhance__cardBody {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  word-break: break-word;
}
.dsh-prompt-enhance__line { white-space: pre-wrap; }
.dsh-prompt-enhance__ins {
  color: inherit;
  background: color-mix(in srgb, #16a34a 20%, transparent);
  box-shadow: inset 0 -0.14em 0 color-mix(in srgb, #16a34a 38%, transparent);
  border-radius: 3px;
  padding: 0.02em 0.08em;
}
.dsh-prompt-enhance__del {
  color: color-mix(in srgb, currentColor 82%, #b91c1c);
  background: color-mix(in srgb, #dc2626 13%, transparent);
  text-decoration: line-through;
  text-decoration-thickness: 0.08em;
  text-decoration-color: color-mix(in srgb, #b91c1c 72%, transparent);
  border-radius: 3px;
  padding: 0.02em 0.08em;
}
.dsh-prompt-enhance__cardFoot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 9px;
  border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent);
}
.dsh-prompt-enhance__legend {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-right: auto;
  font-size: 11.5px;
  color: color-mix(in srgb, currentColor 68%, transparent);
}
.dsh-prompt-enhance__legendItem { display: inline-flex; align-items: center; gap: 5px; }
.dsh-prompt-enhance__legendSwatch { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
.dsh-prompt-enhance__legendSwatch[data-kind="ins"] { background: color-mix(in srgb, #16a34a 55%, transparent); }
.dsh-prompt-enhance__legendSwatch[data-kind="del"] { background: color-mix(in srgb, #dc2626 50%, transparent); }
.dsh-prompt-enhance__cardBtn {
  min-height: 28px;
  padding: 4px 12px;
  border: 0;
  border-radius: 7px;
  font-family: inherit;
  font-size: 12.5px;
  cursor: pointer;
  background: color-mix(in srgb, currentColor 10%, transparent);
  color: inherit;
}
.dsh-prompt-enhance__cardBtn:hover { background: color-mix(in srgb, currentColor 18%, transparent); }
.dsh-prompt-enhance__cardBtn:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 45%, transparent); outline-offset: 1px; }
.dsh-prompt-enhance__cardBtn[data-variant="primary"] { background: color-mix(in srgb, currentColor 17%, transparent); font-weight: 500; }
`;

    /** 只在缺少时插入 <style>，热重载重复 apply 也不会堆叠。 */
    function ensureStyles() {
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    /** 订阅空实现，供没有 store 的兜底路径复用。 */
    function noopSubscribe() {
      return () => {};
    }

    /**
     * 从若干候选里挑出可用的输入 facade（约定形状：state.getSnapshot() + actions）。
     * @param candidates - 依次尝试的对象。
     * @returns facade 或 undefined。
     */
    function pickInput(candidates) {
      for (const candidate of candidates) {
        if (candidate === void 0 || candidate === null) continue;
        if (typeof candidate === 'object' && candidate.state !== void 0) return candidate;
        if (typeof candidate.get === 'function' || typeof candidate.setDraft === 'function') continue;
      }
      return void 0;
    }

    /** ✨ 图标（sparkles）。 */
    function SparklesIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', {
          d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z',
        }),
        h('path', { d: 'M20 3v4' }),
        h('path', { d: 'M22 5h-4' }),
      );
    }

    /** 转圈图标。 */
    function SpinnerIcon() {
      return h(
        'svg',
        {
          className: 'dsh-prompt-enhance__spin',
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M12 3a9 9 0 1 0 9 9', opacity: 0.9 }),
      );
    }

    /** 撤销图标。 */
    function UndoIcon() {
      return h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M3 12a9 9 0 1 0 3-6.7' }),
        h('path', { d: 'M3 4v5h5' }),
      );
    }

    /** 把宿主返回的错误码翻译成中文提示。 */
    function describeError(code, fallback) {
      switch (code) {
        case 'UNAUTHORIZED':
        case 'FORBIDDEN':
          return '会话校验失败，请刷新页面';
        case 'NO_LLM_SERVICE':
          return '宿主没有可用的模型服务';
        case 'NO_ADAPTER':
        case 'MISSING_CREDENTIAL':
        case 'AUTH':
          return '模型未就绪（渠道或密钥问题）';
        case 'RATE_LIMIT':
          return '触发限流，稍后再试';
        case 'CONTEXT_WINDOW_EXCEEDED':
          return '草稿太长，超出模型上下文';
        case 'TIMEOUT':
          return '模型响应超时';
        case 'INPUT_TOO_LONG':
          return '草稿太长';
        case 'EMPTY_ENHANCEMENT':
          return '模型没有返回内容';
        default:
          return fallback || '增强失败';
      }
    }

    /**
     * 切成可比较的最小单元：连续空白、单个汉字、拉丁词/数字、其它单字符。
     * 中英混排下按汉字切能给出精确到字的增删高亮。
     * @param text - 原文。
     * @returns token 数组。
     */
    function tokenize(text) {
      return String(text).match(/\s+|[\u3400-\u9fff]|[A-Za-z0-9_]+|[^\s]/g) || [];
    }

    /** LCS 表规模上限（token 数），超了就退化成「整段替换」，避免卡住输入框。 */
    const DIFF_TOKEN_CAP = 800;

    /**
     * 词级 LCS 差异。
     * @param before - 原文。
     * @param after - 增强后文本。
     * @returns [{ type: 'equal'|'del'|'ins', text }]，相邻同类已合并。
     */
    function diffSegments(before, after) {
      const a = tokenize(before);
      const b = tokenize(after);
      if (a.length > DIFF_TOKEN_CAP || b.length > DIFF_TOKEN_CAP) {
        return [
          { type: 'del', text: String(before) },
          { type: 'ins', text: String(after) },
        ];
      }
      const n = a.length;
      const m = b.length;
      const w = m + 1;
      // table[i * w + j] = LCS(a[i:], b[j:]) 的长度；Uint16 足够（上限 800）
      const table = new Uint16Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          table[i * w + j] =
            a[i] === b[j]
              ? table[(i + 1) * w + j + 1] + 1
              : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
        }
      }
      const out = [];
      const push = (type, text) => {
        const last = out[out.length - 1];
        if (last !== void 0 && last.type === type) last.text += text;
        else out.push({ type, text });
      };
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (a[i] === b[j]) {
          push('equal', a[i]);
          i += 1;
          j += 1;
        } else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) {
          push('del', a[i]);
          i += 1;
        } else {
          push('ins', b[j]);
          j += 1;
        }
      }
      while (i < n) {
        push('del', a[i]);
        i += 1;
      }
      while (j < m) {
        push('ins', b[j]);
        j += 1;
      }
      return out;
    }

    /**
     * 差异统计：改动块数、新增字数、删去字数。
     * @param before - 原文。
     * @param after - 增强后文本。
     * @returns {{ segments: Array, changed: number, added: number, removed: number, delta: number }}。
     */
    function diffStats(before, after) {
      const segments = diffSegments(before, after);
      let changed = 0;
      let added = 0;
      let removed = 0;
      for (const seg of segments) {
        if (seg.type === 'ins') {
          added += seg.text.length;
          changed += 1;
        } else if (seg.type === 'del') {
          removed += seg.text.length;
          changed += 1;
        }
      }
      return { segments, changed, added, removed, delta: added - removed };
    }

    /**
     * 增强前后差异浮层：锚定在 ✨ 按钮上方，逐字标出删（红删除线）与增（绿底）。
     * 用 portal 挂到 body，避免被输入框容器的 overflow 裁剪。
     */
    /** 把词级差异段按换行切成「行」，供卡片逐行渲染（长提示词按段落读更清楚）。 */
    function segmentsToLines(segments) {
      const lines = [[]];
      for (const seg of segments) {
        const parts = String(seg.text).split('\n');
        for (let index = 0; index < parts.length; index += 1) {
          if (index > 0) lines.push([]);
          if (parts[index].length > 0) lines[lines.length - 1].push({ type: seg.type, text: parts[index] });
        }
      }
      return lines.filter((line) => line.length > 0);
    }

    function DiffCard({ before, after, anchor, onUndo, onClose }) {
      const stats = useMemo(() => diffStats(before, after), [before, after]);
      const [box, setBox] = useState(null);

      useEffect(() => {
        const node = anchor && anchor.current;
        if (node === null || node === void 0) return;
        const place = () => {
          // 锚点取整张输入卡（而不是 ✨ 本身）：卡片浮在输入卡上方，避免遮住正在被对比的草稿。
          const composer = (typeof node.closest === 'function' && node.closest('[data-composer-card]')) || node;
          const rect = composer.getBoundingClientRect();
          const width = Math.min(560, window.innerWidth - 24);
          const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
          setBox({
            left,
            bottom: Math.max(12, window.innerHeight - rect.top + 10),
            width,
            maxHeight: Math.max(180, Math.round(rect.top - 24)),
          });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
      }, [anchor]);

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [onClose]);

      if (box === null || ReactDOM === null || typeof ReactDOM.createPortal !== 'function') return null;

      const sign = stats.delta >= 0 ? `+${stats.delta}` : String(stats.delta);
      const lines = segmentsToLines(stats.segments);
      const card = h(
        'div',
        {
          className: 'dsh-prompt-enhance__card',
          role: 'dialog',
          'aria-label': '增强前后差异',
          'data-dsh-prompt-enhance': 'diff-card',
          style: {
            left: `${box.left}px`,
            bottom: `${box.bottom}px`,
            width: `${box.width}px`,
            maxHeight: `${box.maxHeight}px`,
          },
          onMouseDown: (event) => event.stopPropagation(),
        },
        h(
          'div',
          { className: 'dsh-prompt-enhance__cardHead' },
          h('span', { className: 'dsh-prompt-enhance__cardTitle' }, '增强对比'),
          h(
            'span',
            { className: 'dsh-prompt-enhance__cardStat' },
            `${stats.changed} 处改动 · ${stats.added} 字新增 / ${stats.removed} 字替换 · 净 ${sign} 字`,
          ),
        ),
        h(
          'div',
          { className: 'dsh-prompt-enhance__cardBody' },
          lines.map((line, lineIndex) =>
            h(
              'div',
              { key: lineIndex, className: 'dsh-prompt-enhance__line' },
              line.map((seg, segIndex) =>
                seg.type === 'equal'
                  ? h('span', { key: segIndex }, seg.text)
                  : h('span', { key: segIndex, className: `dsh-prompt-enhance__${seg.type}` }, seg.text),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsh-prompt-enhance__cardFoot' },
          h(
            'div',
            { className: 'dsh-prompt-enhance__legend', 'aria-hidden': 'true' },
            h(
              'span',
              { className: 'dsh-prompt-enhance__legendItem' },
              h('span', { className: 'dsh-prompt-enhance__legendSwatch', 'data-kind': 'ins' }),
              '新增',
            ),
            h(
              'span',
              { className: 'dsh-prompt-enhance__legendItem' },
              h('span', { className: 'dsh-prompt-enhance__legendSwatch', 'data-kind': 'del' }),
              '删除',
            ),
          ),
          h(
            'button',
            { type: 'button', className: 'dsh-prompt-enhance__cardBtn', 'data-variant': 'primary', onClick: onClose },
            '保留增强',
          ),
          h('button', { type: 'button', className: 'dsh-prompt-enhance__cardBtn', onClick: onUndo }, '撤销'),
        ),
      );
      return ReactDOM.createPortal(card, document.body);
    }

    /**
     * 槽位组件。props 里可能同时存在：
     *  - input：本插件 inject(sessionId) 算好的会话输入 facade；
     *  - keyboard：composer.bar 透传的 shell（同一套 state/actions）；
     *  - useInput / inputActions：若宿主将来直接注入标准 props 也一并兼容。
     */
    /**
     * 槽位组件。props 里可能同时存在：
     *  - input：本插件 inject(sessionId) 算好的会话输入 facade；
     *  - keyboard：composer.bar 透传的 shell（同一套 state/actions）；
     *  - readModel：读界面当前模型选择（provider/model/reasoningEffort）；
     *  - useInput / inputActions：若宿主将来直接注入标准 props 也一并兼容。
     *
     * 相位：idle | busy | error。增强结果是否存在由「撤销栈」决定——
     * 栈里有几层就代表当前草稿被增强过几次，可以逐层撤销回原文。
     */
    function EnhanceButton(props) {
      const facade = pickInput([props && props.input, props && props.keyboard]);
      const actions = (facade && facade.actions) || (props && props.inputActions) || {};
      const store = facade && facade.state;

      const legacySnapshot =
        typeof (props && props.useInput) === 'function' ? props.useInput((s) => s) : void 0;

      const subscribe = useCallback(
        (onChange) => (store && typeof store.subscribe === 'function' ? store.subscribe(onChange) : noopSubscribe()),
        [store],
      );
      const getSnapshot = useCallback(
        () => (store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : void 0),
        [store],
      );
      const live = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
      const snapshot = live !== void 0 ? live : legacySnapshot;
      const draft = snapshot && typeof snapshot.draft === 'string' ? snapshot.draft : '';

      const [phase, setPhase] = useState('idle'); // idle | busy | error
      const [message, setMessage] = useState('');
      const [stack, setStackState] = useState([]); // [{ before, after }]，最多 8 层
      const [diffo, setDiff] = useState(null); // { before, after } | null：当前展示的差异
      const abortRef = useRef(null);
      const stackRef = useRef([]);
      const pendingRef = useRef(''); // 刚写进草稿的文本，用来区分「我写的」和「用户改的」
      const btnRef = useRef(null);
      const draftRef = useRef(draft);
      draftRef.current = draft;

      /** 同步更新撤销栈（ref 供事件处理器读，state 驱动重渲染）。 */
      const setStack = useCallback((next) => {
        stackRef.current = next;
        setStackState(next);
      }, []);

      /** 点击时重新读一次真实草稿，避免依赖订阅时序。 */
      const readDraft = useCallback(() => {
        try {
          if (store && typeof store.getSnapshot === 'function') {
            const now = store.getSnapshot();
            if (now && typeof now.draft === 'string') return now.draft;
          }
        } catch (_) {
          /* 读取失败时退回渲染期快照 */
        }
        return draftRef.current;
      }, [store]);

      useEffect(() => {
        ensureStyles();
      }, []);

      // 用户自己动了草稿：撤销栈与差异卡一起失效（绝不把旧文本盖回去）。
      useEffect(() => {
        if (stack.length === 0) return;
        if (pendingRef.current !== '' && draft === pendingRef.current) {
          pendingRef.current = '';
          return;
        }
        const top = stack[stack.length - 1];
        if (top === void 0 || draft !== top.after) {
          pendingRef.current = '';
          stackRef.current = [];
          setStackState([]);
          setDiff(null);
        }
      }, [draft, stack]);

      const write = useCallback(
        (text) => {
          if (typeof actions.setDraft === 'function') {
            actions.setDraft(text);
            return;
          }
          if (typeof actions.insertText === 'function' && typeof actions.captureInsertion === 'function') {
            actions.insertText(text, actions.captureInsertion());
          }
        },
        [actions],
      );

      /** 读界面上当前选中的模型（provider/model/推理档），拿不到就交给宿主默认值。 */
      const currentModel = useCallback(() => {
        try {
          if (typeof props.readModel === 'function') {
            const model = props.readModel();
            if (model && typeof model.provider === 'string' && typeof model.model === 'string') return model;
          }
        } catch (_) {
          /* 读取失败不影响增强，退回宿主默认模型 */
        }
        return void 0;
      }, [props.readModel]);

      const run = useCallback(async () => {
        const source = readDraft().trim();
        if (source === '') return;
        const controller = new AbortController();
        abortRef.current = controller;
        setMessage('');
        setDiff(null);
        setPhase('busy');
        try {
          const payload = { text: source };
          // 跟随界面当前模型（WorkBuddy 行为）；宿主可以拒绝或忽略这些字段。
          const model = currentModel();
          if (model !== void 0) {
            payload.provider = model.provider;
            payload.model = model.model;
            if (typeof model.reasoningEffort === 'string' && model.reasoningEffort !== '') {
              payload.reasoningEffort = model.reasoningEffort;
            }
          }
          const response = await fetch(`${API}/enhance`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const error = new Error(data.message || data.error || `HTTP ${response.status}`);
            error.code = data.error;
            throw error;
          }
          const enhanced = typeof data.text === 'string' ? data.text.trim() : '';
          if (enhanced === '') throw Object.assign(new Error('empty'), { code: 'EMPTY_ENHANCEMENT' });
          // 期间用户自己改了草稿：放弃结果，绝不覆盖用户输入。
          if (readDraft() !== source) {
            setMessage('草稿已修改，已放弃增强结果');
            setPhase('error');
            return;
          }
          pendingRef.current = enhanced;
          write(enhanced);
          setStack(stackRef.current.concat([{ before: source, after: enhanced }]).slice(-8));
          setDiff({ before: source, after: enhanced });
          setPhase('idle');
        } catch (error) {
          if (error && error.name === 'AbortError') {
            setPhase('idle');
            return;
          }
          setMessage(describeError(error && error.code, error && error.message));
          setPhase('error');
        } finally {
          abortRef.current = null;
        }
      }, [readDraft, write, currentModel, setStack]);

      /** 撤销一层；栈空则什么都不做。 */
      const undo = useCallback(() => {
        const entries = stackRef.current;
        const top = entries[entries.length - 1];
        if (top === void 0) return;
        if (readDraft() === top.after) {
          pendingRef.current = top.before;
          write(top.before);
        }
        const rest = entries.slice(0, -1);
        setStack(rest);
        setDiff(null);
        setMessage('');
        setPhase('idle');
      }, [readDraft, write, setStack]);

      const onClick = useCallback(() => {
        if (phase === 'busy') {
          if (abortRef.current) abortRef.current.abort();
          return;
        }
        if (phase === 'error') setMessage('');
        void run();
      }, [phase, run]);

      /** 差异卡开关（只在有增强结果时可开）。 */
      const toggleDiff = useCallback(() => {
        if (diffo !== null) {
          setDiff(null);
          return;
        }
        const entries = stackRef.current;
        const top = entries[entries.length - 1];
        if (top !== void 0) setDiff({ before: top.before, after: top.after });
      }, [diffo]);

      const closeDiff = useCallback(() => setDiff(null), []);

      const depth = stack.length;
      const disabled = phase !== 'busy' && draft.trim() === '';
      const label =
        phase === 'busy' ? '正在增强（点击取消）'
        : phase === 'error' ? `增强失败：${message}（点击重试）`
        : depth > 0 ? `再增强一次（还有 ${depth} 层可撤销）`
        : '增强提示词';

      const mainButton = h(
        'button',
        {
          ref: btnRef,
          type: 'button',
          className: 'dsh-prompt-enhance__btn',
          title: label,
          'aria-label': label,
          'data-tone': phase === 'busy' ? 'busy' : phase === 'error' ? 'error' : 'idle',
          'data-phase': phase,
          'data-depth': depth,
          'data-dsh-prompt-enhance': 'sparkle',
          disabled,
          onClick,
        },
        phase === 'busy' ? h(SpinnerIcon) : h(SparklesIcon),
      );

      if (depth === 0 && diffo === null) return mainButton;

      const controls = [];
      if (depth > 0) {
        controls.push(
          h(
            'button',
            {
              key: 'undo',
              type: 'button',
              className: 'dsh-prompt-enhance__btn',
              'data-role': 'undo',
              title: depth > 1 ? `撤销最近一层（还有 ${depth - 1} 层）` : '恢复原文',
              'aria-label': depth > 1 ? `撤销最近一层（还有 ${depth - 1} 层）` : '恢复原文',
              'data-dsh-prompt-enhance': 'undo',
              onClick: undo,
            },
            h(UndoIcon),
          ),
        );
        controls.push(
          h(
            'button',
            {
              key: 'diff',
              type: 'button',
              className: 'dsh-prompt-enhance__btn',
              'data-role': 'diff',
              title: diffo === null ? '查看增强前后差异' : '收起差异',
              'aria-label': diffo === null ? '查看增强前后差异' : '收起差异',
              'data-dsh-prompt-enhance': 'diff',
              onClick: toggleDiff,
            },
            '⇄',
          ),
        );
      }

      return h(
        'span',
        { className: 'dsh-prompt-enhance__group' },
        mainButton,
        controls,
        diffo === null
          ? null
          : h(DiffCard, {
              before: diffo.before,
              after: diffo.after,
              anchor: btnRef,
              onUndo: undo,
              onClose: closeDiff,
            }),
      );
    }

/**
     * 读界面当前选中的模型（provider / model / reasoningEffort）。
     * 走 `modelDirectories.directoryFor(sessionId).store.current`；服务缺失或会话异常一律返回 undefined，
     * 由宿主半的默认模型兜底——增强能力绝不因为读不到模型而失效。
     * @param scope - 注入后的客户端作用域。
     * @param sessionId - 当前会话 id。
     * @returns 读取函数，或 undefined。
     */
    function makeModelReader(scope, sessionId) {
      let models;
      try {
        models = typeof scope.get === 'function' ? scope.get('modelDirectories') : scope.modelDirectories;
      } catch (_) {
        return void 0;
      }
      if (models === void 0 || models === null || typeof models.directoryFor !== 'function') return void 0;
      return () => {
        try {
          const directory = models.directoryFor(sessionId);
          const store = directory && directory.store;
          const snapshot = store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : void 0;
          const current = snapshot && snapshot.current;
          return current !== null && typeof current === 'object' ? current : void 0;
        } catch (_) {
          return void 0;
        }
      };
    }

    /**
     * 在 session 作用域里取「会话输入 facade」：state（草稿快照）+ actions（写回）。
     * 任何一步失败都返回 undefined，由组件退回 keyboard 兜底，绝不让插槽渲染崩掉。
     * @param scope - 注入后的客户端作用域。
     * @param sessionId - 当前会话 id。
     * @returns props 片段。
     */
    function resolveInputProps(scope, sessionId) {
      const readModel = makeModelReader(scope, sessionId);
      const withModel = (extra) => (readModel === void 0 ? extra : Object.assign({ readModel }, extra));
      try {
        const sessions = scope.sessions ?? (typeof scope.get === 'function' ? scope.get('sessions') : void 0);
        if (sessions === void 0 || typeof sessions.scope !== 'function') return withModel({});
        const actx = sessions.scope(sessionId);
        if (actx === void 0) return withModel({});
        const conversation =
          typeof actx.get === 'function' ? actx.get('conversation') : actx.conversation;
        if (conversation === void 0 || conversation.input === void 0) return withModel({});
        const input = conversation.input.for(actx);
        return input === void 0 ? withModel({}) : withModel({ input });
      } catch (_) {
        return withModel({});
      }
    }

    /**
     * 注册到输入框右侧区域：位置在模型选择器左边，与 WorkBuddy 一致。
     * slots.inject 保证槽位服务就绪后才注册，避免启动顺序问题。
     */
    function apply(ctx) {
      ctx.inject(['slots', 'sessions'], (scope) => {
        scope.slots.inject('conversation.input.right', () =>
          scope.slots.register(
            {
              name: 'conversation.input.right',
              id: 'prompt-enhance',
              // order 50：排在 dsh-vision-router 的「识图」（40）之后，
              // 紧贴模型选择器左侧——与 WorkBuddy 的 ✨ 位置一致。
              order: 50,
              inject: (sessionId) => resolveInputProps(scope, sessionId),
            },
            EnhanceButton,
          ),
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['slots', 'sessions'];
    exports.css = CSS;
    exports.EnhanceButton = EnhanceButton;
    exports.DiffCard = DiffCard;
    exports.diffSegments = diffSegments;
    exports.diffStats = diffStats;
    exports.segmentsToLines = segmentsToLines;
    exports.tokenize = tokenize;
    exports.makeModelReader = makeModelReader;
    exports.describeError = describeError;
    exports.resolveInputProps = resolveInputProps;
    return module.exports;
  },
});
