/**
 * 迁移逻辑测试：0.1.x 旧配置（enabled/shellWakeLock/powerCfgWakeLock/webWakeLock/why）
 * → 新格式（version/platform/mode/config）自动转换，写回一次且不循环。
 */
import { describe, expect, it } from 'vitest'
import { CONFIG_VERSION } from '../src/shared/constants.js'
import { AwakeSettings, isLegacyShape } from '../src/host/settings.js'
import type { HostContext, LoggerLike, SettingsService } from '../src/host/context.js'

const silentLogger: LoggerLike = { info: () => {}, warn: () => {}, error: () => {} }

/** fake settings 服务：内存 user 层 + settings/updated 事件派发。 */
interface Harness {
  readonly replaceCalls: Array<Record<string, unknown>>
  readonly user: Record<string, unknown> | undefined
  /** 触发 settings/updated（模拟 update/replace 提交后的官方事件）。 */
  fireUpdated(ns: string): void
}

function makeHarness(initialUser: Record<string, unknown> | undefined): Harness {
  let user = initialUser
  const replaceCalls: Array<Record<string, unknown>> = []
  let updatedListener: ((ns: unknown) => void) | null = null

  const service: SettingsService = {
    register: () => {},
    update: async (ns, patch) => {
      user = { ...(user ?? {}), ...patch }
      updatedListener?.(ns)
    },
    replace: async (ns, section) => {
      replaceCalls.push(section)
      user = { ...section }
      updatedListener?.(ns)
    },
    get: () => user,
    describe: () => [{ ns: 'dsh-awake', user }],
  }

  const ctx: HostContext = {
    // 指向项目根：createRequire 能从本项目 node_modules 解析 schemastery（与真实
    // profile 运行时 baseUrl 指向 profile 根的行为一致）。
    baseUrl: import.meta.dirname + '/../x.js',
    logger: silentLogger,
    effect: () => {},
    on: () => {},
    get: () => undefined,
    inject: (services, callback) => {
      if (services.includes('settings')) {
        callback({
          settings: service,
          on: (event, listener) => {
            if (event === 'settings/updated') updatedListener = listener as (ns: unknown) => void
            return () => {}
          },
        })
      }
    },
  }

  const settings = new AwakeSettings(
    ctx,
    { version: CONFIG_VERSION, platform: 'linux', mode: 'systemd', config: {} },
    async () => {},
    silentLogger,
  )
  settings.attach()

  return {
    replaceCalls,
    get user() {
      return user
    },
    fireUpdated: (ns) => updatedListener?.(ns),
  }
}

describe('0.1.x → 0.2.0 迁移', () => {
  it('默认旧配置 → mode 平台默认 + config.why', async () => {
    const h = makeHarness({ enabled: true, shellWakeLock: true, powerCfgWakeLock: false, webWakeLock: true, why: '我的原因' })
    // attach 内 apply 是异步的；跑一轮微任务等它落定。
    await new Promise((r) => setTimeout(r, 0))
    expect(h.replaceCalls).toHaveLength(1)
    const section = h.replaceCalls[0]!
    expect(section.version).toBe(CONFIG_VERSION)
    expect(section.platform).toBe('linux')
    expect(section.mode).toBe('systemd') // 平台默认
    expect(section.config).toEqual({ why: '我的原因' })
    expect(h.user).toEqual(section)
  })

  it('只开 powerCfg → 该平台电源类实现（linux → gnome-gsettings）', async () => {
    const h = makeHarness({ enabled: true, shellWakeLock: false, powerCfgWakeLock: true, webWakeLock: true, why: '' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.replaceCalls[0]?.mode).toBe('gnome-gsettings')
    expect(h.replaceCalls[0]?.config).toEqual({}) // why 为空 → 不写
  })

  it('enabled=false → mode off', async () => {
    const h = makeHarness({ enabled: false, shellWakeLock: true, powerCfgWakeLock: false, webWakeLock: true, why: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.replaceCalls[0]?.mode).toBe('off')
  })

  it('无旧配置（空 user 层 / 新形状）→ 不迁移', async () => {
    const h1 = makeHarness({})
    await new Promise((r) => setTimeout(r, 0))
    expect(h1.replaceCalls).toHaveLength(0)

    const h2 = makeHarness({ version: 2, platform: 'linux', mode: 'systemd', config: { why: 'x' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(h2.replaceCalls).toHaveLength(0)
  })

  it('迁移只发生一次（replace → 事件 → 新格式 → 无循环）', async () => {
    const h = makeHarness({ enabled: true, shellWakeLock: true, powerCfgWakeLock: false, webWakeLock: true, why: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(h.replaceCalls).toHaveLength(1)
  })

  it('迁移后 snapshot 按新格式解析（modeId 生效）', async () => {
    const h = makeHarness({ enabled: true, shellWakeLock: false, powerCfgWakeLock: true, webWakeLock: true, why: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    expect(h.replaceCalls).toHaveLength(1)
    h.fireUpdated('dsh-awake')
    await new Promise((r) => setTimeout(r, 0))
    expect(h.replaceCalls).toHaveLength(1) // 事件后仍是新格式，不再迁移
  })
})

describe('isLegacyShape 边界', () => {
  it('空对象 / 新形状 / 非对象都不是旧配置', () => {
    expect(isLegacyShape({})).toBe(false)
    expect(isLegacyShape({ version: 2 })).toBe(false)
    expect(isLegacyShape(null)).toBe(false)
    expect(isLegacyShape('x')).toBe(false)
    expect(isLegacyShape(undefined)).toBe(false)
  })
})
