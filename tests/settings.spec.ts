/**
 * settings 解析单测：stale 检测（平台锚点 + 方式缺失双保险）/ off / 迁移形状判定。
 */
import { describe, expect, it } from 'vitest'
import { buildBase, isLegacyShape, parseSettings } from '../src/host/settings.js'

describe('parseSettings（统一一条解析逻辑）', () => {
  it('platform 匹配 && mode 在注册表 → 正常，不 stale', () => {
    const parsed = parseSettings({ platform: 'linux', mode: 'systemd', config: { why: 'x' } }, 'linux')
    expect(parsed.modeId).toBe('systemd')
    expect(parsed.stale).toBe(false)
    expect(parsed.config).toEqual({ why: 'x' })
    expect(parsed.configuredPlatform).toBe('linux')
  })

  it('配置来自其他平台 → stale，运行时用平台默认方式，不覆盖文件', () => {
    const parsed = parseSettings({ platform: 'win32', mode: 'powershell' }, 'linux')
    expect(parsed.stale).toBe(true)
    expect(parsed.modeId).toBe('systemd') // linux 默认
    expect(parsed.configuredPlatform).toBe('win32')
    expect(parsed.configuredMode).toBe('powershell')
  })

  it('平台匹配但 mode 不在注册表（实现被删）→ stale，用默认方式', () => {
    const parsed = parseSettings({ platform: 'linux', mode: 'ghost-mode' }, 'linux')
    expect(parsed.stale).toBe(true)
    expect(parsed.modeId).toBe('systemd')
  })

  it("mode === 'off' → 服务端不值守，不 stale", () => {
    const parsed = parseSettings({ platform: 'linux', mode: 'off' }, 'linux')
    expect(parsed.modeId).toBeNull()
    expect(parsed.stale).toBe(false)
  })

  it('未配置（无 user 层）→ modeId null，不 stale', () => {
    expect(parseSettings(undefined, 'linux').modeId).toBeNull()
    expect(parseSettings({}, 'linux').modeId).toBeNull()
    expect(parseSettings({}, 'linux').stale).toBe(false)
  })

  it('config 非对象 → 空对象', () => {
    expect(parseSettings({ platform: 'linux', mode: 'systemd', config: 'oops' }, 'linux').config).toEqual({})
  })

  it('平台不受支持 → modeId null（永不值守）', () => {
    const parsed = parseSettings({ platform: 'linux', mode: 'systemd' }, 'unsupported')
    expect(parsed.modeId).toBeNull()
    expect(parsed.stale).toBe(false)
  })

  it('win32 默认方式为 powershell', () => {
    const parsed = parseSettings({ platform: 'linux', mode: 'systemd' }, 'win32')
    expect(parsed.stale).toBe(true)
    expect(parsed.modeId).toBe('powershell')
  })
})

describe('isLegacyShape（0.1.x 旧配置判定）', () => {
  it('旧键命中', () => {
    expect(isLegacyShape({ enabled: true })).toBe(true)
    expect(isLegacyShape({ shellWakeLock: true, why: 'x' })).toBe(true)
    expect(isLegacyShape({ powerCfgWakeLock: false })).toBe(true)
    expect(isLegacyShape({ webWakeLock: true })).toBe(true)
    expect(isLegacyShape({ why: 'x' })).toBe(true)
  })

  it('新形状/空对象/非对象不命中', () => {
    expect(isLegacyShape({ version: 2, platform: 'linux', mode: 'systemd', config: { why: 'x' } })).toBe(false)
    expect(isLegacyShape({})).toBe(false)
    expect(isLegacyShape(undefined)).toBe(false)
    expect(isLegacyShape('enabled')).toBe(false)
  })
})

describe('buildBase（入口配置 → base）', () => {
  it('新形状原样保留', () => {
    const base = buildBase({ version: 2, platform: 'linux', mode: 'systemd', config: { why: 'x' } }, 'linux')
    expect(base).toEqual({ version: 2, platform: 'linux', mode: 'systemd', config: { why: 'x' } })
  })

  it('0.1.x 旧键丢弃，平台/方式缺省取当前平台默认', () => {
    const base = buildBase({ enabled: true, shellWakeLock: true, why: 'x' }, 'linux')
    expect(base).toEqual({ version: 2, platform: 'linux', mode: 'systemd', config: {} })
  })

  it('空入口 → 当前平台默认', () => {
    expect(buildBase(undefined, 'darwin').mode).toBe('caffeinate')
    expect(buildBase(undefined, 'win32').mode).toBe('powershell')
  })

  it('平台不受支持 → mode off', () => {
    expect(buildBase(undefined, 'unsupported').mode).toBe('off')
  })
})
