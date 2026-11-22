/**
 * writeJson 响应边界防护的行为钉子：前置拒绝分支都在 try 块之外，
 * 客户端提前断开时 writeHead/end 抛出的 ERR_STREAM_WRITE_AFTER_END
 * 必须被就地吞掉（否则成 unhandledRejection 把宿主进程带崩）。
 */
import { describe, expect, it, vi } from 'vitest'

import { writeJson } from '../src/http'

type FakeRes = {
  writableEnded: boolean
  destroyed: boolean
  writeHead: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
}

const fakeRes = (over: Partial<FakeRes> = {}): FakeRes => ({
  writableEnded: false,
  destroyed: false,
  writeHead: vi.fn(),
  end: vi.fn(),
  ...over,
})

describe('writeJson', () => {
  it('正常路径：写头 + 单次 end，动态响应头 no-store', () => {
    const res = fakeRes()
    writeJson(res as never, 403, { ok: false })
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.objectContaining({ 'cache-control': 'no-store' }))
    expect(res.end).toHaveBeenCalledTimes(1)
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ ok: false }))
  })

  it('已终止的响应直接跳过（幂等，不再写）', () => {
    const res = fakeRes({ writableEnded: true })
    writeJson(res as never, 200, { ok: true })
    expect(res.writeHead).not.toHaveBeenCalled()
    expect(res.end).not.toHaveBeenCalled()
  })

  it('writeHead 抛错（客户端提前断开）被吞掉，不外抛', () => {
    const res = fakeRes()
    res.writeHead.mockImplementation(() => {
      throw Object.assign(new Error('write after end'), { code: 'ERR_STREAM_WRITE_AFTER_END' })
    })
    expect(() => writeJson(res as never, 200, { ok: true })).not.toThrow()
  })
})
