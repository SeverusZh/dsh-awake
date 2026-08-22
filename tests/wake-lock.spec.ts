/**
 * WakeLockManager 单测（注入 fake isSupported/request/isVisible/subscribeVisibility）。
 */
import { describe, expect, it, vi } from 'vitest'
import { isWebWakeLockEnabled, setWebWakeLockEnabled, WakeLockManager, type WakeLockState } from '../src/client/wake-lock.js'

/** localStorage stub（node 环境无 localStorage）。 */
function stubStorage(initial: Record<string, string> = {}): { get: (k: string) => string | null; set: (k: string, v: string) => void } {
  let data = { ...initial }
  return {
    get: (k) => (k in data ? data[k] ?? null : null),
    set: (k, v) => {
      data[k] = v
    },
  }
}

/** 可控 fake 管理器环境。 */
function makeManager(opts: { supported?: boolean; requestResult?: 'sentinel' | 'null' | 'error' } = {}) {
  const visibility = { visible: true }
  const listeners = new Set<() => void>()
  const sentinel: WakeLockSentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true
    }),
    addEventListener: (type, listener) => {
      if (type === 'release') releaseListeners.add(listener)
    },
    removeEventListener: () => {},
    type: 'screen',
  }
  const releaseListeners = new Set<EventListenerOrEventListenerObject>()
  const request = vi.fn(async () => {
    if (opts.requestResult === 'null') return null
    if (opts.requestResult === 'error') throw new Error('request failed')
    return sentinel
  })
  const manager = new WakeLockManager({
    isSupported: () => opts.supported !== false,
    request,
    isVisible: () => visibility.visible,
    subscribeVisibility: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  })
  const fireVisibility = (next: boolean): void => {
    visibility.visible = next
    for (const l of listeners) l()
  }
  return { manager, sentinel, request, fireVisibility, releaseListeners }
}

describe('WakeLockManager', () => {
  it('关闭（setEnabled(false)）→ 即使有任务也不申请锁', async () => {
    const { manager, request } = makeManager()
    manager.setEnabled(false)
    manager.setTaskActive(true)
    await flush()
    expect(request).not.toHaveBeenCalled()
    expect(manager.state).toBe('disabled')
  })

  it('开启 + 有任务 + 可见 → 持锁', async () => {
    const { manager, request } = makeManager()
    manager.setEnabled(true)
    manager.setTaskActive(true)
    await flush()
    expect(request).toHaveBeenCalledTimes(1)
    expect(manager.state).toBe('holding')
  })

  it('任务结束 → 放锁（idle）', async () => {
    const { manager, sentinel } = makeManager()
    manager.setEnabled(true)
    manager.setTaskActive(true)
    await flush()
    expect(manager.state).toBe('holding')
    manager.setTaskActive(false)
    await flush()
    expect(manager.state).toBe('idle')
    expect(sentinel.release).toHaveBeenCalled()
  })

  it('无任务 → 不申请锁', async () => {
    const { manager, request } = makeManager()
    manager.setEnabled(true)
    expect(manager.state).toBe('idle')
    await flush()
    expect(request).not.toHaveBeenCalled()
  })

  it('页面隐藏 → hidden；回前台自动重取', async () => {
    const { manager, request, fireVisibility } = makeManager()
    manager.setEnabled(true)
    manager.setTaskActive(true)
    await flush()
    expect(manager.state).toBe('holding')

    fireVisibility(false)
    expect(manager.state).toBe('hidden')

    fireVisibility(true)
    await flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(manager.state).toBe('holding')
  })

  it('申请失败 → request-error', async () => {
    const { manager } = makeManager({ requestResult: 'error' })
    manager.setEnabled(true)
    manager.setTaskActive(true)
    await flush()
    expect(manager.state).toBe('request-error')
  })

  it('申请返回 null → request-error', async () => {
    const { manager } = makeManager({ requestResult: 'null' })
    manager.setEnabled(true)
    manager.setTaskActive(true)
    await flush()
    expect(manager.state).toBe('request-error')
  })

  it('浏览器不支持 → unsupported', () => {
    const { manager } = makeManager({ supported: false })
    expect(manager.state).toBe('unsupported')
  })

  it('dispose 释放锁并清订阅', async () => {
    const { manager, sentinel } = makeManager()
    manager.setEnabled(true)
    manager.setTaskActive(true)
    await flush()
    manager.dispose()
    expect(sentinel.release).toHaveBeenCalled()
  })
})

/** 排空 promise 链的微任务（request → then → catch 需要多个 tick）。 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('localStorage 开关', () => {
  it('默认开；写入 false 后为关', () => {
    const storage = stubStorage()
    const get = vi.fn((k: string) => storage.get(k))
    const set = vi.fn((k: string, v: string) => storage.set(k, v))
    // @ts-expect-error 测试注入 localStorage stub
    vi.stubGlobal('localStorage', { getItem: get, setItem: set })

    expect(isWebWakeLockEnabled()).toBe(true)
    setWebWakeLockEnabled(false)
    expect(isWebWakeLockEnabled()).toBe(false)
    expect(set).toHaveBeenCalledWith('dsh-awake.webWakeLock', 'false')

    vi.unstubAllGlobals()
  })

  it('localStorage 不可用（隐私模式）→ 默认开、写入静默', () => {
    // @ts-expect-error 无 localStorage
    vi.stubGlobal('localStorage', undefined)
    expect(isWebWakeLockEnabled()).toBe(true)
    setWebWakeLockEnabled(false) // 不抛
    vi.unstubAllGlobals()
  })
})
