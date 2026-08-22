/**
 * RPC 通道单测：端点路由 / 错误形状（rpcErrorSchema）/ cancelled / desktop 停用。
 */
import { describe, expect, it } from 'vitest'
import { installAwakeRpc, type RpcService } from '../src/host/rpc.js'
import { RPC_CHANNEL } from '../src/shared/constants.js'
import type { AwakeStatus, RpcResult } from '../src/types.js'
import type { HostContext } from '../src/host/context.js'
import { silentLogger } from './coordinator.spec.js'

interface CapturedHandler {
  channel: string
  handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult<unknown>>
  options: { authority: string }
}

function makeStatus(overrides: Partial<AwakeStatus> = {}): AwakeStatus {
  return {
    platform: 'linux',
    selected: 'systemd',
    effective: null,
    active: false,
    openTurns: 0,
    stale: false,
    configured: { platform: 'linux', mode: 'systemd' },
    attempts: [],
    modes: [],
    config: {},
    version: { current: '0.2.0', loaded: '0.2.0' },
    desktop: false,
    ...overrides,
  }
}

function fakeCtx(): { ctx: HostContext; handlers: CapturedHandler[] } {
  const handlers: CapturedHandler[] = []
  const connection = {
    rpc: {
      handle: (channel: string, handler: CapturedHandler['handler'], options: { authority: string }) => {
        handlers.push({ channel, handler, options })
        return () => {}
      },
    },
  }
  const ctx: HostContext = {
    baseUrl: '/tmp/fake-profile',
    logger: silentLogger,
    effect: () => {},
    on: () => {},
    get: (service: string) => (service === 'connection' ? connection : undefined),
    inject: () => {},
  }
  return { ctx, handlers }
}

function fakeService(overrides: Partial<RpcService> = {}): RpcService {
  return {
    status: () => makeStatus(),
    refresh: () => makeStatus({ attempts: [{ id: 'systemd', ok: true }] }),
    select: async (mode, config) => makeStatus({ selected: mode, config }),
    ...overrides,
  }
}

describe('installAwakeRpc', () => {
  it('注册 /dsh-awake 通道（authority loopback）', () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    expect(handlers).toHaveLength(1)
    expect(handlers[0]?.channel).toBe(RPC_CHANNEL)
    expect(handlers[0]?.options.authority).toBe('loopback')
  })

  it('Connection RPC 缺席 → 警告并返回空 disposer，不注册', () => {
    const ctx: HostContext = { logger: silentLogger, effect: () => {}, on: () => {}, get: () => undefined, inject: () => {} }
    const dispose = installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    expect(typeof dispose).toBe('function')
  })

  it('awake.status / awake.refresh 返回 ok(状态)', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const h = handlers[0]!.handler
    const status = (await h('awake.status', {}, undefined)) as { ok: true; value: AwakeStatus }
    expect(status.ok).toBe(true)
    expect(status.value.platform).toBe('linux')
    const refresh = (await h('awake.refresh', {}, undefined)) as { ok: true; value: AwakeStatus }
    expect(refresh.value.attempts).toHaveLength(1)
  })

  it('awake.select 校验 mode 字段：缺失 → bad-request', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const res = (await handlers[0]!.handler('awake.select', {}, undefined)) as { ok: false; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('bad-request')
  })

  it('awake.select 转发 mode+config，返回最新状态', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const res = (await handlers[0]!.handler('awake.select', { mode: 'gnome-gsettings', config: { why: 'x' } }, undefined)) as {
      ok: true
      value: AwakeStatus
    }
    expect(res.ok).toBe(true)
    expect(res.value.selected).toBe('gnome-gsettings')
    expect(res.value.config).toEqual({ why: 'x' })
  })

  it('service 抛错 → bad-request + 错误消息', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, {
      service: fakeService({ select: async () => { throw new Error('方式 x 不可用') } }),
      desktop: false,
      runUpdate: null,
      restart: null,
    })
    const res = (await handlers[0]!.handler('awake.select', { mode: 'x' }, undefined)) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('方式 x 不可用')
  })

  it('未知端点 → bad-request', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const res = (await handlers[0]!.handler('awake.nope', {}, undefined)) as { ok: false }
    expect(res.ok).toBe(false)
  })

  it('signal.aborted → cancelled', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const controller = new AbortController()
    controller.abort()
    const res = (await handlers[0]!.handler('awake.status', {}, controller.signal)) as { ok: false; error: { code: string } }
    expect(res.ok).toBe(false)
    expect(res.error.code).toBe('cancelled')
  })

  it('awake.version → { current, loaded }', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const res = (await handlers[0]!.handler('awake.version', {}, undefined)) as { ok: true; value: { current: string; loaded: string } }
    expect(res.ok).toBe(true)
    expect(typeof res.value.current).toBe('string')
    expect(typeof res.value.loaded).toBe('string')
  })

  it('awake.update：desktop 环境 → bad-request（更新由桌面版管理）', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: true, runUpdate: null, restart: null })
    const res = (await handlers[0]!.handler('awake.update', {}, undefined)) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('桌面版')
  })

  it('awake.update：成功 → ok({ok, output}) + 自动重启标记', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, {
      service: fakeService(),
      desktop: false,
      runUpdate: { currentVersion: () => '0.2.0', loadedVersion: () => '0.2.0', perform: async () => ({ ok: true, output: 'done' }) },
      restart: () => ({ helperPid: 123 }),
    })
    const res = (await handlers[0]!.handler('awake.update', {}, undefined)) as { ok: true; value: { ok: boolean; output: string; autoRestart: boolean } }
    expect(res.ok).toBe(true)
    expect(res.value.ok).toBe(true)
    expect(res.value.output).toBe('done')
    expect(res.value.autoRestart).toBe(true)
  })

  it('awake.update：runUpdate 缺席 → bad-request', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, { service: fakeService(), desktop: false, runUpdate: null, restart: null })
    const res = (await handlers[0]!.handler('awake.update', {}, undefined)) as { ok: false }
    expect(res.ok).toBe(false)
  })

  it('awake.restart：helper 拉起失败 → bad-request（不误报成功）', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, {
      service: fakeService(),
      desktop: false,
      runUpdate: null,
      restart: () => ({ helperPid: null, error: 'spawn failed' }),
    })
    const res = (await handlers[0]!.handler('awake.restart', {}, undefined)) as { ok: false; error: { message: string } }
    expect(res.ok).toBe(false)
    expect(res.error.message).toContain('spawn failed')
  })

  it('awake.restart：成功 → ok({ok, helperPid, hint})', async () => {
    const { ctx, handlers } = fakeCtx()
    installAwakeRpc(ctx, {
      service: fakeService(),
      desktop: false,
      runUpdate: null,
      restart: () => ({ helperPid: 456 }),
    })
    const res = (await handlers[0]!.handler('awake.restart', {}, undefined)) as { ok: true; value: { ok: boolean; helperPid: number; hint: string } }
    expect(res.ok).toBe(true)
    expect(res.value.ok).toBe(true)
    expect(res.value.helperPid).toBe(456)
    expect(res.value.hint).toContain('lsof')
  })
})
