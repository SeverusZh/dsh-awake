/**
 * client 半 slot 注册单测：配置面板注册进「插件列表 → 插件详情」
 * （plugins.bundle.config，以 npm 包名为 key）；settings.section 已退役。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apply, inject } from '../src/client/index.js'
import { PLUGIN_ID, SETTINGS_LOCALE_NS } from '../src/shared/constants.js'
import type { ClientContext, PluginBundleConfigOptions } from '../src/client/types.js'

interface Registration {
  readonly options: PluginBundleConfigOptions
  readonly component: unknown
}

interface FakeCtx {
  readonly ctx: ClientContext
  readonly injectedKeys: string[]
  readonly registrations: Registration[]
  readonly localeRegistrations: Array<{ ns: string; dicts: Record<string, Record<string, string>> }>
}

/** 记录 register/inject 调用的最小 ctx（结构对齐 ClientContext）。 */
function fakeCtx(): FakeCtx {
  const injectedKeys: string[] = []
  const registrations: Registration[] = []
  const localeRegistrations: Array<{ ns: string; dicts: Record<string, Record<string, string>> }> = []
  const slots = {
    inject(slot: string, contribution: () => unknown): unknown {
      injectedKeys.push(slot)
      return contribution()
    },
    register(options: PluginBundleConfigOptions, component: unknown): unknown {
      registrations.push({ options, component })
      return () => {}
    },
  }
  const locale = {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void {
      localeRegistrations.push({ ns, dicts })
      return () => {}
    },
    bind: (_ns: string) => (key: string) => key,
  }
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: {} }),
      subscribe: () => () => {},
    },
  }
  const ctx: ClientContext = {
    slots,
    locale,
    sessions,
    effect: (dispose: () => void) => {
      void dispose()
      return undefined
    },
  }
  return { ctx, injectedKeys, registrations, localeRegistrations }
}

describe('client slot 注册（plugins.bundle.config）', () => {
  it('export inject 仍为 slots/sessions/locale', () => {
    expect(inject).toEqual(['slots', 'sessions', 'locale'])
  })

  it('注册进 plugins.bundle.config（key = 包名），不再注册 settings.section', () => {
    const { ctx, injectedKeys, registrations } = fakeCtx()
    apply(ctx)

    expect(injectedKeys).toEqual(['plugins.bundle.config'])
    expect(injectedKeys).not.toContain('settings.section')

    expect(registrations).toHaveLength(1)
    const reg = registrations[0]!
    expect(reg.options.name).toBe('plugins.bundle.config')
    expect(reg.options.key).toBe(PLUGIN_ID)
    expect(reg.options.key).toBe('dsh-awake')
    expect(reg.options.locale).toBe(SETTINGS_LOCALE_NS)
    expect(typeof reg.options.inject).toBe('function')
    // 组件 = AwakeSection（函数组件）。
    expect(typeof reg.component).toBe('function')
  })

  it('注入面提供 { api, manager, t }（组件 props = 宿主 { view } + 本注入面）', () => {
    const { ctx, registrations } = fakeCtx()
    apply(ctx)

    const face = registrations[0]!.options.inject()
    expect(typeof (face.api as { status?: unknown }).status).toBe('function')
    expect(typeof (face.api as { select?: unknown }).select).toBe('function')
    expect(face.manager).toBeTruthy()
    expect(typeof face.t).toBe('function')
  })

  it('locale 注册到 settings.awake 命名空间（sectionLabel 已退役）', () => {
    const { ctx, localeRegistrations } = fakeCtx()
    apply(ctx)

    expect(localeRegistrations).toHaveLength(1)
    expect(localeRegistrations[0]!.ns).toBe(SETTINGS_LOCALE_NS)
    expect(localeRegistrations[0]!.dicts.zh).toBeTruthy()
    expect(localeRegistrations[0]!.dicts.en).toBeTruthy()
    expect(localeRegistrations[0]!.dicts.zh).not.toHaveProperty('sectionLabel')
  })
})
