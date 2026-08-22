/**
 * modes 子系统单测：注册表聚合 / normalizeConfig / powerModes / 真实探测。
 */
import { describe, expect, it } from 'vitest'
import { detectPlatform, normalizeConfig, powerModes, registries, registryFor } from '../src/modes/index.js'
import type { ConfigField } from '../src/types.js'

describe('detectPlatform / registryFor', () => {
  it('当前进程平台在支持集合内（或 unsupported）', () => {
    const platform = detectPlatform()
    expect(['linux', 'darwin', 'win32', 'unsupported']).toContain(platform)
    if (platform === 'unsupported') {
      expect(registryFor(platform)).toBeUndefined()
    } else {
      expect(registryFor(platform)).toBeDefined()
    }
  })
})

describe('registries 聚合', () => {
  it('三平台齐全，order/defaultMode/modes 一致', () => {
    expect(Object.keys(registries)).toEqual(['linux', 'darwin', 'win32'])
    for (const [platform, registry] of Object.entries(registries)) {
      expect(registry.platform).toBe(platform)
      // order = 下拉顺序 = 回退顺序；defaultMode 必须在 order 里且是 modes 的键
      expect(registry.order.length).toBeGreaterThan(0)
      expect(registry.order).toContain(registry.defaultMode)
      for (const id of registry.order) {
        const mode = registry.modes[id]
        expect(mode).toBeDefined()
        expect(mode.id).toBe(id)
        expect(mode.default).toBe(id === registry.defaultMode)
      }
      // modes 里没有 order 之外的键
      expect(Object.keys(registry.modes).sort()).toEqual([...registry.order].sort())
    }
  })

  it('linux 平台默认 systemd，win32 默认 powershell，darwin 默认 caffeinate', () => {
    expect(registries.linux.defaultMode).toBe('systemd')
    expect(registries.win32.defaultMode).toBe('powershell')
    expect(registries.darwin.defaultMode).toBe('caffeinate')
  })
})

describe('powerModes（旧配置迁移目标）', () => {
  it('电源类方式映射正确且在注册表内', () => {
    expect(powerModes.linux).toBe('gnome-gsettings')
    expect(powerModes.darwin).toBe('pmset')
    expect(powerModes.win32).toBe('powercfg')
    expect(registries.linux.modes[powerModes.linux]).toBeDefined()
    expect(registries.darwin.modes[powerModes.darwin]).toBeDefined()
    expect(registries.win32.modes[powerModes.win32]).toBeDefined()
  })
})

describe('normalizeConfig（动态 schema 校验在 host 侧）', () => {
  const fields: readonly ConfigField[] = [
    { type: 'text', content: '说明文字（无 key，不产生配置值）' },
    { type: 'input', key: 'why', title: '阻止原因', default: 'dsh 任务执行中' },
    { type: 'boolean', key: 'fast', title: '快速', default: true },
    { type: 'number', key: 'timeout', title: '超时', default: 30, min: 1, max: 120 },
    { type: 'select', key: 'level', title: '级别', default: 'a', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
  ]

  it('无配置时全部用 default', () => {
    expect(normalizeConfig(fields, undefined)).toEqual({ why: 'dsh 任务执行中', fast: true, timeout: 30, level: 'a' })
  })

  it('保留提供值，丢弃未知键，text 字段不产生值', () => {
    expect(normalizeConfig(fields, { why: '我的原因', unknown: 'x' })).toEqual({
      why: '我的原因',
      fast: true,
      timeout: 30,
      level: 'a',
    })
  })

  it('空字符串视为未提供 → 用 default', () => {
    expect(normalizeConfig(fields, { why: '', timeout: 0 })).toEqual({
      why: 'dsh 任务执行中',
      fast: true,
      timeout: 0, // 0 是合法值（number 默认 30 只在缺失时生效）
      level: 'a',
    })
  })

  it('fields 为空时输出空对象', () => {
    expect(normalizeConfig([], { why: 'x' })).toEqual({})
  })
})

describe('真实探测（当前平台）', () => {
  const platform = detectPlatform()

  it('平台默认方式的 isAvailable 返回合法形状', () => {
    if (platform === 'unsupported') return
    const registry = registries[platform]
    for (const id of registry.order) {
      const result = registry.modes[id].isAvailable()
      if (result.ok) {
        expect(result.ok).toBe(true)
      } else {
        expect(typeof result.reason).toBe('string')
      }
    }
  })

  it('本机（linux）systemd 方式应可用', () => {
    if (platform !== 'linux') return
    expect(registries.linux.modes.systemd.isAvailable().ok).toBe(true)
  })
})
