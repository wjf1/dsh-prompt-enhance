/**
 * undo-stack 行为钉子（镜像仓零测试门禁的恢复，覆盖最高风险的纯函数路径）。
 * 宿主无关：createUndoStack 是纯工厂，测试自持实例。
 */
import { describe, expect, it } from 'vitest'

import { createUndoStack } from '../src/client/undo-stack'

const entry = (applied: string) => ({ original: `draft-for-${applied}`, applied })

describe('undo-stack 深度限制', () => {
  it('超出 maxDepth 时最旧条目被逐出', () => {
    const stack = createUndoStack(3)
    for (let i = 1; i <= 5; i++) stack.push('s1', entry(`v${i}`))
    expect(stack.depth('s1')).toBe(3)
    expect(stack.peek('s1')?.applied).toBe('v5')
    expect(stack.pop('s1')?.applied).toBe('v5')
    expect(stack.pop('s1')?.applied).toBe('v4')
    expect(stack.pop('s1')?.applied).toBe('v3')
    expect(stack.pop('s1')).toBeUndefined()
  })

  it('pop 后 peek 落到前一条；clear 清空整栈', () => {
    const stack = createUndoStack(3)
    stack.push('s1', entry('v1'))
    stack.push('s1', entry('v2'))
    stack.pop('s1')
    expect(stack.peek('s1')?.applied).toBe('v1')
    stack.clear('s1')
    expect(stack.depth('s1')).toBe(0)
    expect(stack.peek('s1')).toBeUndefined()
  })
})

describe('undo-stack 全局 LRU 驱逐', () => {
  it('全局超限时最久未写的会话整栈被逐出（恰达上限不逐出）', () => {
    const stack = createUndoStack(3, 60)
    // 20 会话 × 3 = 60 恰达上限不逐出；s21 首条 push 触发 61 > 60 → 逐出 s1 整栈
    for (let s = 1; s <= 20; s++) {
      for (let i = 1; i <= 3; i++) stack.push(`s${s}`, entry(`s${s}-v${i}`))
    }
    expect(stack.depth('s1')).toBe(3) // 恰达上限，尚未逐出
    stack.push('s21', entry('s21-v1'))
    expect(stack.depth('s1')).toBe(0) // 61 > 60：最久未写的 s1 整栈被逐
    expect(stack.depth('s2')).toBe(3) // 只逐出被挤爆的那一个栈
    stack.push('s21', entry('s21-v2'))
    stack.push('s21', entry('s21-v3'))
    expect(stack.depth('s21')).toBe(3) // 60 = 上限：不再逐出
  })

  it('会话被刷新后免于逐出：LRU 按最近写入排序', () => {
    const stack = createUndoStack(2, 3) // 小容量放大行为
    stack.push('a', entry('a1'))
    stack.push('a', entry('a2')) // a 栈满（深度 2）
    stack.push('b', entry('b1')) // total 3 = 上限
    stack.push('b', entry('b2')) // total 4 > 3 → 逐出最久未写的 a 整栈
    expect(stack.depth('a')).toBe(0)
    expect(stack.depth('b')).toBe(2)
    stack.push('a', entry('a1')) // total 3
    stack.push('a', entry('a2')) // a 刷新后 total 4 > 3 → 逐出 b（a 是最近写入）
    expect(stack.depth('a')).toBe(2)
    expect(stack.peek('a')?.applied).toBe('a2')
    expect(stack.depth('b')).toBe(0)
  })
})
