/**
 * client api 封装单测：POST 线格式（{ method, payload }）+ 信封解包（ok → value；
 * !ok / 传输失败 → throw）。
 */
import { describe, expect, it } from 'vitest'
import { makeRpc, type FetchLike } from '../src/client/api.js'
import { RPC_ROUTE_PATH } from '../src/shared/constants.js'
import type { AwakeStatus, RpcResult } from '../src/types.js'

interface Call {
  url: string
  init: RequestInit
}

/** 假 fetch：按顺序回放 RpcResult，记录每次请求。 */
function fakeFetch(results: RpcResult<unknown>[]): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  let index = 0
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const body = results[Math.min(index++, results.length - 1)]!
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { fetchImpl, calls }
}

const status: AwakeStatus = {
  platform: 'linux',
  selected: 'systemd',
  effective: 'systemd',
  active: false,
  openTurns: 0,
  stale: false,
  alwaysOn: false,
  configured: { platform: 'linux', mode: 'systemd' },
  attempts: [],
  modes: [],
  config: {},
  version: { current: '0.2.0', loaded: '0.2.0' },
  desktop: false,
}

/** 取出请求体里的 { method, payload }。 */
const envelopeOf = (call: Call): { method: string; payload: unknown } =>
  JSON.parse(String(call.init.body)) as { method: string; payload: unknown }

describe('makeRpc', () => {
  it('ok 信封 → 解包返回 value；POST /api/dsh-awake', async () => {
    const { fetchImpl, calls } = fakeFetch([{ ok: true, value: status }])
    const api = makeRpc(fetchImpl)
    const data = await api.status()
    expect(data.platform).toBe('linux')
    expect(calls[0]?.url).toBe(RPC_ROUTE_PATH)
    expect(calls[0]?.init.method).toBe('POST')
    expect(envelopeOf(calls[0]!)).toEqual({ method: 'awake.status', payload: {} })
  })

  it('!ok 信封 → throw（消息来自 error.message）', async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, error: { code: 'bad-request', message: '方式 x 不可用', details: {} } }])
    const api = makeRpc(fetchImpl)
    await expect(api.select({ mode: 'x' })).rejects.toThrow('方式 x 不可用')
  })

  it('传输层 !response.ok → throw（含 HTTP 状态）', async () => {
    const fetchImpl: FetchLike = async () => new Response('unauthorized', { status: 401 })
    const api = makeRpc(fetchImpl)
    await expect(api.status()).rejects.toThrow('HTTP 401')
  })

  it('端点映射正确', async () => {
    const okValue = { ok: true, value: status }
    const { fetchImpl, calls } = fakeFetch([okValue, okValue, okValue, okValue, okValue, okValue, okValue])
    const api = makeRpc(fetchImpl)
    await api.status()
    await api.refresh()
    await api.select({ mode: 'off' })
    await api.setAlwaysOn(true)
    await api.version()
    await api.update()
    await api.restart()
    expect(calls.map((c) => envelopeOf(c).method)).toEqual([
      'awake.status',
      'awake.refresh',
      'awake.select',
      'awake.alwaysOn',
      'awake.version',
      'awake.update',
      'awake.restart',
    ])
    expect(envelopeOf(calls[2]!).payload).toEqual({ mode: 'off' })
    expect(envelopeOf(calls[3]!).payload).toEqual({ enabled: true })
  })

  it('cancelled 信封同样抛错', async () => {
    const { fetchImpl } = fakeFetch([{ ok: false, error: { code: 'cancelled', message: 'cancelled', details: {} } }])
    const api = makeRpc(fetchImpl)
    await expect(api.status()).rejects.toThrow('cancelled')
  })
})
