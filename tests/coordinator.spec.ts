/**
 * AwakeCoordinator 单测：引用计数 + 回退链（注入 fake 的 isAvailable/start/stop）。
 */
import { describe, expect, it } from 'vitest'
import { AwakeCoordinator } from '../src/host/coordinator.js'
import type { PlatformRegistry, WakeMode } from '../src/modes/index.js'
import type { LoggerLike } from '../src/host/context.js'

/** 无操作 logger。 */
export const silentLogger: LoggerLike = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

/** 可控 fake 方式：记录 start/stop 次数与当前活动会话。 */
function fakeMode(id: string, opts: { available?: boolean; startError?: Error } = {}): WakeMode & { started: number; stopped: number; active: boolean } {
  let started = 0
  let stopped = 0
  let active = false
  return {
    id,
    name: id,
    description: id,
    default: false,
    fields: [],
    get started() {
      return started
    },
    get stopped() {
      return stopped
    },
    get active() {
      return active
    },
    isAvailable: () => (opts.available === false ? { ok: false, reason: `${id} 不可用` } : { ok: true }),
    start: async () => {
      started += 1
      if (opts.startError !== undefined) throw opts.startError
      active = true
      return {
        description: `${id} session`,
        isActive: () => active,
        stop: async () => {
          stopped += 1
          active = false
        },
      }
    },
  }
}

function makeRegistry(modes: WakeMode[]): PlatformRegistry {
  const order = modes.map((m) => m.id)
  const record: Record<string, WakeMode> = {}
  for (const m of modes) record[m.id] = m
  return { platform: 'linux', order, defaultMode: order[0] ?? '', modes: record }
}

/** 构造一个可注入配置的测试环境。 */
function setup(modes: WakeMode[]) {
  const registry = makeRegistry(modes)
  let configured = { modeId: registry.defaultMode, config: {} as Record<string, unknown>, alwaysOn: false }
  const coordinator = new AwakeCoordinator({
    registry,
    resolve: () => configured,
    logger: silentLogger,
  })
  return {
    coordinator,
    registry,
    setMode: (modeId: string | null, config: Record<string, unknown> = {}) => {
      configured = { ...configured, modeId, config }
    },
    setAlwaysOn: (alwaysOn: boolean) => {
      configured = { ...configured, alwaysOn }
    },
  }
}

describe('引用计数', () => {
  it('turn/start 0→1 拿锁，turn/end 1→0 放锁', async () => {
    const a = fakeMode('a')
    const { coordinator } = setup([a])
    expect(coordinator.effectiveMode).toBeNull()

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.isActive).toBe(true)
    expect(coordinator.effectiveMode).toBe('a')
    expect(a.active).toBe(true)

    coordinator.onSessionEvent({ type: 'turn/end' })
    await coordinator.drain()
    expect(coordinator.isActive).toBe(false)
    expect(coordinator.effectiveMode).toBeNull()
    expect(a.active).toBe(false)
    expect(a.stopped).toBe(1)
  })

  it('跨会话引用计数：两个 turn 同时打开只启动一个会话，全部结束后才放锁', async () => {
    const a = fakeMode('a')
    const { coordinator } = setup([a])

    coordinator.onSessionEvent({ type: 'turn/start' }) // 会话1
    await coordinator.drain()
    coordinator.onSessionEvent({ type: 'turn/start' }) // 会话2
    await coordinator.drain()
    expect(coordinator.openTurnCount).toBe(2)
    expect(a.started).toBe(1)
    expect(a.active).toBe(true)

    coordinator.onSessionEvent({ type: 'turn/end' }) // 会话1 结束
    await coordinator.drain()
    expect(a.active).toBe(true) // 会话2 还在

    coordinator.onSessionEvent({ type: 'turn/end' }) // 会话2 结束
    await coordinator.drain()
    expect(a.active).toBe(false)
    expect(a.stopped).toBe(1)
  })
})

describe('回退链', () => {
  it('首选失败 → 按 order 回退到下一个；attempts 记录每个原因', async () => {
    const a = fakeMode('a', { available: false })
    const b = fakeMode('b')
    const { coordinator, setMode } = setup([a, b])
    setMode('a')

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBe('b')
    expect(coordinator.isActive).toBe(true)
    expect(coordinator.attemptLog).toEqual([
      { id: 'a', ok: false, reason: 'a 不可用' },
      { id: 'b', ok: true },
    ])
  })

  it('首选 start() 抛错 → 回退；全部失败 → effective null + attempts 全失败', async () => {
    const a = fakeMode('a', { startError: new Error('启动爆炸') })
    const b = fakeMode('b', { available: false })
    const { coordinator } = setup([a, b])

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBeNull()
    expect(coordinator.isActive).toBe(false)
    expect(coordinator.attemptLog).toEqual([
      { id: 'a', ok: false, reason: '启动爆炸' },
      { id: 'b', ok: false, reason: 'b 不可用' },
    ])
  })

  it('配置的 mode 不在注册表（stale）→ 首选平台默认方式', async () => {
    const a = fakeMode('a')
    const b = fakeMode('b')
    const { coordinator, setMode } = setup([a, b])
    setMode('ghost-mode') // 不在注册表

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBe('a') // defaultMode = order[0]
  })

  it('配置 off（null）→ 不值守，无 attempts', async () => {
    const a = fakeMode('a')
    const { coordinator, setMode } = setup([a])
    setMode(null)

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBeNull()
    expect(coordinator.isActive).toBe(false)
    expect(coordinator.attemptLog).toEqual([])
    expect(a.started).toBe(0)
  })

  it('平台不受支持（registry undefined）→ 永不值守', async () => {
    const coordinator = new AwakeCoordinator({
      registry: undefined,
      resolve: () => ({ modeId: 'systemd', config: {}, alwaysOn: false }),
      logger: silentLogger,
    })
    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBeNull()
    expect(coordinator.isActive).toBe(false)
  })
})

describe('常开防休眠（alwaysOn）', () => {
  it('开启常开 → 无任务（openTurns = 0）时 reconcile 也拿锁', async () => {
    const a = fakeMode('a')
    const { coordinator, setAlwaysOn } = setup([a])
    setAlwaysOn(true)
    await coordinator.reconcile()
    await coordinator.drain()
    expect(coordinator.isActive).toBe(true)
    expect(coordinator.effectiveMode).toBe('a')
    expect(a.active).toBe(true)
    expect(coordinator.openTurnCount).toBe(0)
  })

  it('开启常开 → turn/end 1→0 后仍保持值守', async () => {
    const a = fakeMode('a')
    const { coordinator, setAlwaysOn } = setup([a])
    setAlwaysOn(true)
    await coordinator.reconcile()
    await coordinator.drain()

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(a.started).toBe(1) // 常开已持锁，turn/start 不重复启动

    coordinator.onSessionEvent({ type: 'turn/end' })
    await coordinator.drain()
    expect(coordinator.openTurnCount).toBe(0)
    expect(coordinator.isActive).toBe(true) // 常开：不因任务结束而放锁
    expect(a.active).toBe(true)
    expect(a.stopped).toBe(0)
  })

  it('关闭常开（任务已全部结束）→ 放锁', async () => {
    const a = fakeMode('a')
    const { coordinator, setAlwaysOn } = setup([a])
    setAlwaysOn(true)
    await coordinator.reconcile()
    await coordinator.drain()
    expect(a.active).toBe(true)

    setAlwaysOn(false)
    await coordinator.reconcile()
    await coordinator.drain()
    expect(coordinator.isActive).toBe(false)
    expect(a.active).toBe(false)
    expect(a.stopped).toBe(1)
  })

  it('常开 + 模式 off → 不值守（modeId null 优先）', async () => {
    const a = fakeMode('a')
    const { coordinator, setMode, setAlwaysOn } = setup([a])
    setMode(null)
    setAlwaysOn(true)
    await coordinator.reconcile()
    await coordinator.drain()
    expect(coordinator.isActive).toBe(false)
    expect(a.started).toBe(0)
  })

  it('常开 + 全部方式失败 → 不值守，attempts 记录原因', async () => {
    const a = fakeMode('a', { available: false })
    const { coordinator, setAlwaysOn } = setup([a])
    setAlwaysOn(true)
    await coordinator.reconcile()
    await coordinator.drain()
    expect(coordinator.isActive).toBe(false)
    expect(coordinator.attemptLog).toEqual([{ id: 'a', ok: false, reason: 'a 不可用' }])
  })
})

describe('设置变更对账', () => {
  it('openTurns > 0 时先放锁再按新配置拿锁（去重：同一轮事件只跑一次）', async () => {
    const a = fakeMode('a')
    const b = fakeMode('b')
    const { coordinator, setMode } = setup([a, b])

    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBe('a')

    setMode('b')
    await Promise.all([coordinator.reconcile(), coordinator.reconcile()]) // 同一轮两次调用
    await coordinator.drain()
    expect(coordinator.effectiveMode).toBe('b')
    expect(a.active).toBe(false) // 旧会话已停
    expect(a.stopped).toBe(1)
    expect(b.active).toBe(true)
    expect(b.started).toBe(1) // 去重后只启动一次
  })

  it('openTurns = 0 时 reconcile 是 no-op（不启动会话）', async () => {
    const a = fakeMode('a')
    const { coordinator } = setup([a])
    await coordinator.reconcile()
    await coordinator.drain()
    expect(a.started).toBe(0)
    expect(coordinator.isActive).toBe(false)
  })
})

describe('卸载放锁', () => {
  it('dispose 无条件放锁（幂等）', async () => {
    const a = fakeMode('a')
    const { coordinator } = setup([a])
    coordinator.onSessionEvent({ type: 'turn/start' })
    await coordinator.drain()
    expect(a.active).toBe(true)

    await coordinator.dispose()
    expect(a.active).toBe(false)
    await coordinator.dispose() // 幂等
    expect(a.stopped).toBe(1)
  })
})
