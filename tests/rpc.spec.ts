/**
 * 数据面单测：精确路由注册 / 端点分发 / 错误形状（rpcErrorSchema）/ cancelled /
 * desktop 停用 / 请求体校验。
 */
import { describe, expect, it } from 'vitest'
import { installAwakeRpc, type RpcDeps, type RpcService } from '../src/host/rpc.js'
import { RPC_ROUTE_PATH } from '../src/shared/constants.js'
import type { AwakeStatus, RpcResult } from '../src/types.js'
import type { ConnectionFetchRoute, ConnectionService } from '../src/host/context.js'
import { silentLogger } from './coordinator.spec.js'

/** 假 connection：捕获 fetch 路由注册（DSH 官方插件同款扩展点）。 */
function fakeConnection(): { connection: ConnectionService; captured: ConnectionFetchRoute[] } {
  const captured: ConnectionFetchRoute[] = []
  const connection: ConnectionService = {
    fetch: {
      register: (route) => {
        captured.push(route)
        return () => {}
      },
    },
  }
  return { connection, captured }
}

function makeStatus(overrides: Partial<AwakeStatus> = {}): AwakeStatus {
  return {
    platform: 'linux',
    selected: 'systemd',
    effective: null,
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
    ...overrides,
  }
}

/** 按线格式发一条请求：POST { method, payload } → 解出 RpcResult。 */
async function callEndpoint(
  captured: ConnectionFetchRoute[],
  method: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<RpcResult<unknown>> {
  const route = captured[0]!
  const request = new Request(`http://127.0.0.1:3080${RPC_ROUTE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, payload }),
    ...(signal === undefined ? {} : { signal }),
  })
  const response = await route.fetch(request)
  return (await response.json()) as RpcResult<unknown>
}

function fakeService(overrides: Partial<RpcService> = {}): RpcService {
  return {
    status: () => makeStatus(),
    refresh: () => makeStatus({ attempts: [{ id: 'systemd', ok: true }] }),
    select: async (mode, config) => ({ status: makeStatus({ selected: mode, config }), test: null }),
    setAlwaysOn: async (enabled) => makeStatus({ alwaysOn: enabled }),
    ...overrides,
  }
}

/** 默认依赖（服务面 + 平台能力），按用例覆盖。 */
function deps(overrides: Partial<RpcDeps> = {}): RpcDeps {
  return {
    service: fakeService(),
    desktop: false,
    runUpdate: null,
    restart: null,
    logger: silentLogger,
    ...overrides,
  }
}

describe('installAwakeRpc', () => {
  it('注册 /api/dsh-awake 精确 POST 路由', () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    expect(captured).toHaveLength(1)
    expect(captured[0]?.path).toBe(RPC_ROUTE_PATH)
    expect(captured[0]?.methods).toEqual(['POST'])
    expect(captured[0]?.requestBody).toBe('buffered')
    expect(typeof captured[0]?.fetch).toBe('function')
  })

  it('Request 非 JSON / 缺 method → 400 + bad-request', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const route = captured[0]!
    const notJson = await route.fetch(
      new Request(`http://127.0.0.1:3080${RPC_ROUTE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    )
    expect(notJson.status).toBe(400)
    const noMethod = await route.fetch(
      new Request(`http://127.0.0.1:3080${RPC_ROUTE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"payload":{}}',
      }),
    )
    expect(noMethod.status).toBe(400)
    const body = (await noMethod.json()) as { ok: false; error: { message: string } }
    expect(body.error.message).toContain('method')
  })

  it('awake.status / awake.refresh 返回 ok(状态)', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const status = (await callEndpoint(captured, 'awake.status', {})) as { ok: true; value: AwakeStatus }
    expect(status.ok).toBe(true)
    expect(status.value.platform).toBe('linux')
    const refresh = (await callEndpoint(captured, 'awake.refresh', {})) as { ok: true; value: AwakeStatus }
    expect(refresh.value.attempts).toHaveLength(1)
  })

  it('awake.select 校验 mode 字段：缺失 → bad-request', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const res = (await callEndpoint(captured, 'awake.select', {})) as { ok: false; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('bad-request')
  })

  it('awake.select 转发 mode+config，返回 { status, test }', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const res = (await callEndpoint(captured, 'awake.select', { mode: 'gnome-gsettings', config: { why: 'x' } })) as {
      ok: true
      value: { status: AwakeStatus; test: null }
    }
    expect(res.ok).toBe(true)
    expect(res.value.status.selected).toBe('gnome-gsettings')
    expect(res.value.status.config).toEqual({ why: 'x' })
    expect(res.value.test).toBeNull()
  })

  it('awake.alwaysOn：转发 enabled，返回最新状态', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const res = (await callEndpoint(captured, 'awake.alwaysOn', { enabled: true })) as {
      ok: true
      value: AwakeStatus
    }
    expect(res.ok).toBe(true)
    expect(res.value.alwaysOn).toBe(true)
  })

  it('awake.alwaysOn：enabled 缺失/非布尔 → bad-request', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const missing = (await callEndpoint(captured, 'awake.alwaysOn', {})) as { ok: false }
    expect(missing.ok).toBe(false)
    const notBool = (await callEndpoint(captured, 'awake.alwaysOn', { enabled: 'yes' })) as { ok: false }
    expect(notBool.ok).toBe(false)
  })

  it('awake.alwaysOn：service 拒绝（off 模式）→ bad-request + 消息', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(
      connection,
      deps({
        service: fakeService({
          setAlwaysOn: async () => {
            throw new Error('当前插件运行模式为「关闭（off）」')
          },
        }),
      }),
    )
    const res = (await callEndpoint(captured, 'awake.alwaysOn', { enabled: true })) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('关闭（off）')
  })

  it('service 抛错 → bad-request + 错误消息', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(
      connection,
      deps({ service: fakeService({ select: async () => { throw new Error('方式 x 不可用') } }) }),
    )
    const res = (await callEndpoint(captured, 'awake.select', { mode: 'x' })) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('方式 x 不可用')
  })

  it('未知端点 → bad-request', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const res = (await callEndpoint(captured, 'awake.nope', {})) as { ok: false }
    expect(res.ok).toBe(false)
  })

  it('signal.aborted → cancelled', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const controller = new AbortController()
    controller.abort()
    const res = (await callEndpoint(captured, 'awake.status', {}, controller.signal)) as { ok: false; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('cancelled')
  })

  it('awake.version → { current, loaded }', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const res = (await callEndpoint(captured, 'awake.version', {})) as { ok: true; value: { current: string; loaded: string } }
    expect(res.ok).toBe(true)
    expect(typeof res.value.current).toBe('string')
    expect(typeof res.value.loaded).toBe('string')
  })

  it('awake.update：desktop 环境 → bad-request（更新由桌面版管理）', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps({ desktop: true }))
    const res = (await callEndpoint(captured, 'awake.update', {})) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('桌面版')
  })

  it('awake.update：成功 → ok({ok, output}) + 自动重启标记', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(
      connection,
      deps({
        runUpdate: { currentVersion: () => '0.2.0', loadedVersion: () => '0.2.0', perform: async () => ({ ok: true, output: 'done' }) },
        restart: () => ({ helperPid: 123 }),
      }),
    )
    const res = (await callEndpoint(captured, 'awake.update', {})) as { ok: true; value: { ok: boolean; output: string; autoRestart: boolean } }
    expect(res.ok).toBe(true)
    expect(res.value.ok).toBe(true)
    expect(res.value.output).toBe('done')
    expect(res.value.autoRestart).toBe(true)
  })

  it('awake.update：runUpdate 缺席 → bad-request', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps())
    const res = (await callEndpoint(captured, 'awake.update', {})) as { ok: false }
    expect(res.ok).toBe(false)
  })

  it('awake.restart：helper 拉起失败 → bad-request（不误报成功）', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps({ restart: () => ({ helperPid: null, error: 'spawn failed' }) }))
    const res = (await callEndpoint(captured, 'awake.restart', {})) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('spawn failed')
  })

  it('awake.restart：成功 → ok({ok, helperPid, hint})', async () => {
    const { connection, captured } = fakeConnection()
    installAwakeRpc(connection, deps({ restart: () => ({ helperPid: 456 }) }))
    const res = (await callEndpoint(captured, 'awake.restart', {})) as { ok: true; value: { ok: boolean; helperPid: number; hint: string } }
    expect(res.ok).toBe(true)
    expect(res.value.ok).toBe(true)
    expect(res.value.helperPid).toBe(456)
    expect(res.value.hint).toContain('lsof')
  })
})
