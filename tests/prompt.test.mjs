import assert from 'node:assert/strict';
import test from 'node:test';
import { SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, buildUserPrompt, cleanEnhancedText } from '../lib/prompt.mjs';

test('系统提示词保留 WorkBuddy 的语言一致性硬约束与示例', () => {
  assert.match(SYSTEM_PROMPT, /Language matching is the highest priority/);
  assert.match(SYSTEM_PROMPT, /Do not mix languages unless the user's input itself mixes languages/);
  assert.match(SYSTEM_PROMPT, /A website for my dog/);
  assert.match(SYSTEM_PROMPT, /genie router/);
  assert.match(SYSTEM_PROMPT, /maximum length should be around 800 characters/);
});

test('用户提示词模板含 BAD/GOOD 对照与语言规则', () => {
  assert.match(USER_PROMPT_TEMPLATE, /\{\{input\}\}/);
  assert.match(USER_PROMPT_TEMPLATE, /BAD OUTPUT EXAMPLE/);
  assert.match(USER_PROMPT_TEMPLATE, /GOOD OUTPUT EXAMPLE/);
  assert.match(USER_PROMPT_TEMPLATE, /never include language analysis or language labels in the output/);
});

test('buildUserPrompt 只替换占位符且不被 $ 序列干扰', () => {
  const input = '价格是 $& 和 $1，别被替换掉';
  const built = buildUserPrompt(input);
  assert.ok(built.includes(input));
  assert.ok(!built.includes('{{input}}'));
  assert.equal(built.split(input).length, 2);
});

test('cleanEnhancedText 剥围栏/前缀/包裹引号，正文不动', () => {
  assert.equal(cleanEnhancedText('  请解释这段代码  '), '请解释这段代码');
  assert.equal(cleanEnhancedText('```text\n请解释这段代码\n```'), '请解释这段代码');
  assert.equal(cleanEnhancedText('Enhanced prompt:\n请解释这段代码'), '请解释这段代码');
  assert.equal(cleanEnhancedText('“请解释这段代码”'), '请解释这段代码');
  // 正文里成对出现的引号必须保留，不能被当成包裹引号剥掉。
  assert.equal(cleanEnhancedText('请解释 "foo" 的含义'), '请解释 "foo" 的含义');
  assert.equal(cleanEnhancedText(''), '');
  assert.equal(cleanEnhancedText(null), '');
});

test('cleanEnhancedText 不剥嵌套引号（剥了会吃掉正文的引号）', () => {
  // 外层引号包着内含引号的正文：原样保留。
  assert.equal(cleanEnhancedText('"He said "hi" to me"'), '"He said "hi" to me"');
  assert.equal(cleanEnhancedText('“他说“你好”然后走了”'), '“他说“你好”然后走了”');
  // 正文只有一个撇号（英文所有格）也不再剥，避免把内容切掉一半。
  assert.equal(cleanEnhancedText('"the dog\'s ball"'), '"the dog\'s ball"');
  // 半开半闭的残片不算一对。
  assert.equal(cleanEnhancedText('“请解释这段代码\''), '“请解释这段代码\'');
  // 正常成对仍然照剥。
  assert.equal(cleanEnhancedText('"请解释这段代码"'), '请解释这段代码');
  assert.equal(cleanEnhancedText('‘请解释这段代码’'), '请解释这段代码');
});
