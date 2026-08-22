/**
 * client api 封装单测：RPC 信封解包（ok → value；!ok → throw）。
 */
import { describe, expect, it, vi } from 'vitest'
import { makeRpc } from '../src/client/api.js'
import { RPC_CHANNEL } from '../src/shared/constants.js'
import type { AwakeStatus, RpcResult } from '../src/types.js'
import type { ConnectionService } from '../src/client/types.js'

function fakeConnection(results: RpcResult<unknown>[]): { connection: ConnectionService; calls: Array<{ channel: string; endpoint: string; payload: unknown }> } {
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
  let index = 0
  const connection: ConnectionService = {
    rpc: {
      call: async (channel, endpoint, payload) => {
        calls.push({ channel, endpoint, payload })
        return results[Math.min(index++, results.length - 1)]!
      },
    },
  }
  return { connection, calls }
}

const status: AwakeStatus = {
  platform: 'linux',
  selected: 'systemd',
  effective: 'systemd',
  active: false,
  openTurns: 0,
  stale: false,
  configured: { platform: 'linux', mode: 'systemd' },
  attempts: [],
  modes: [],
  config: {},
  version: { current: '0.2.0', loaded: '0.2.0' },
  desktop: false,
}

describe('makeRpc', () => {
  it('ok 信封 → 解包返回 value；走 /dsh-awake 通道', async () => {
    const { connection, calls } = fakeConnection([{ ok: true, value: status }])
    const api = makeRpc(connection)
    const data = await api.status()
    expect(data.platform).toBe('linux')
    expect(calls[0]?.channel).toBe(RPC_CHANNEL)
    expect(calls[0]?.endpoint).toBe('awake.status')
    expect(calls[0]?.payload).toEqual({})
  })

  it('!ok 信封 → throw（消息来自 error.message）', async () => {
    const { connection } = fakeConnection([{ ok: false, error: { code: 'bad-request', message: '方式 x 不可用', details: {} } }])
    const api = makeRpc(connection)
    await expect(api.select({ mode: 'x' })).rejects.toThrow('方式 x 不可用')
  })

  it('端点映射正确', async () => {
    const okValue = { ok: true, value: status }
    const { connection, calls } = fakeConnection([okValue, okValue, okValue, okValue, okValue, okValue])
    const api = makeRpc(connection)
    await api.status()
    await api.refresh()
    await api.select({ mode: 'off' })
    await api.version()
    await api.update()
    await api.restart()
    expect(calls.map((c) => c.endpoint)).toEqual([
      'awake.status',
      'awake.refresh',
      'awake.select',
      'awake.version',
      'awake.update',
      'awake.restart',
    ])
    expect(calls[2]?.payload).toEqual({ mode: 'off' })
  })

  it('cancelled 信封同样抛错', async () => {
    const { connection } = fakeConnection([{ ok: false, error: { code: 'cancelled', message: 'cancelled', details: {} } }])
    const api = makeRpc(connection)
    await expect(api.status()).rejects.toThrow('cancelled')
  })
})
