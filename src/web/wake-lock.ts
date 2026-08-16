/**
 * dsh-awake —— 方案 A 浏览器半的核心逻辑：Screen Wake Lock 管理器。
 *
 * 规则：
 *   - 全局默认值来自服务端配置（`/dsh-awake/config` 端点）；
 *   - 每个浏览器/页面实例可用 localStorage 单独覆盖（key: dsh-awake:webWakeLock）；
 *   - 有任务在运行且页面可见时持有 `navigator.wakeLock.request('screen')`；
 *   - 页面切到后台时浏览器会自动释放锁，`visibilitychange` 回到前台后自动重取；
 *   - 所有状态变化都会通知订阅者（供 React 组件刷新 UI）。
 */

/** 本地存储键：方案A 的每浏览器独立开关（'true' / 'false' / 缺省=跟随全局）。 */
export const WEB_WAKE_LOCK_STORAGE_KEY = 'dsh-awake:webWakeLock'

export type WakeLockState =
  | 'unsupported' // 浏览器不支持 Screen Wake Lock API
  | 'disabled' // 被全局配置或本浏览器开关关闭
  | 'idle' // 已启用，但当前没有任务在运行
  | 'holding' // 已启用、有任务运行、锁已持有
  | 'hidden' // 已启用、有任务运行，但页面在后台（锁被浏览器自动释放）
  | 'request-error' // 已启用、有任务运行，但申请锁失败

export interface WakeLockManagerOptions {
  /** 读取全局默认值的来源（localStorage）。 */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  /** 是否支持获取锁的探测函数（测试可注入）。 */
  isSupported?: () => boolean
  /** 获取锁的工厂函数（测试可注入）。 */
  request?: () => Promise<WakeLockSentinel | null>
  /** 当前页面是否可见（测试可注入）。 */
  isVisible?: () => boolean
  /** 订阅 visibilitychange（测试可注入）。 */
  subscribeVisibility?: (listener: () => void) => () => void
}

export class WakeLockManager {
  private defaultEnabled = true
  private override: boolean | null = null
  private taskActive = false
  private sentinel: WakeLockSentinel | null = null
  private requestFailed = false
  private readonly listeners = new Set<() => void>()

  private readonly supported: boolean
  private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  private readonly request: () => Promise<WakeLockSentinel | null>
  private readonly subscribeVisibility: (listener: () => void) => () => void
  private visible: boolean
  private unsubscribeVisibility: (() => void) | null = null

  constructor(options: WakeLockManagerOptions = {}) {
    this.storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : emptyStorage)
    this.supported = options.isSupported
      ? options.isSupported()
      : typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock !== undefined
    this.request =
      options.request ??
      (async () => {
        const sentinel = await navigator.wakeLock.request('screen')
        return sentinel
      })
    this.subscribeVisibility = options.subscribeVisibility ?? ((listener) => {
      document.addEventListener('visibilitychange', listener)
      return () => document.removeEventListener('visibilitychange', listener)
    })
    this.visible = options.isVisible
      ? options.isVisible()
      : typeof document === 'undefined' || document.visibilityState === 'visible'
    this.unsubscribeVisibility = this.subscribeVisibility(() => {
      this.visible =
        options.isVisible !== undefined
          ? options.isVisible()
          : document.visibilityState === 'visible'
      if (this.visible) {
        this.refresh()
      } else {
        // 页面隐藏时浏览器会自动释放锁；这里只清空本地引用并通知 UI。
        this.sentinel = null
        this.emit()
      }
    })
  }

  /** 生效中的方案A开关（本浏览器覆盖 ?? 全局默认）。 */
  get enabled(): boolean {
    return this.override ?? this.defaultEnabled
  }

  /** 当前 UI 状态。 */
  get state(): WakeLockState {
    if (!this.supported) return 'unsupported'
    if (!this.enabled) return 'disabled'
    if (!this.taskActive) return 'idle'
    if (!this.visible) return 'hidden'
    if (this.sentinel !== null) return 'holding'
    return this.requestFailed ? 'request-error' : 'idle'
  }

  /** 设置服务端全局默认值（方案A 默认开关）。 */
  setDefaultEnabled(value: boolean): void {
    this.defaultEnabled = value
    this.refresh()
  }

  /** 设置本浏览器覆盖值；null 表示清除覆盖、跟随全局。 */
  setOverride(value: boolean | null): void {
    this.override = value
    if (value === null) {
      try {
        this.storage.removeItem(WEB_WAKE_LOCK_STORAGE_KEY)
      } catch {
        // 隐私模式等场景忽略
      }
    } else {
      try {
        this.storage.setItem(WEB_WAKE_LOCK_STORAGE_KEY, String(value))
      } catch {
        // 同上
      }
    }
    this.refresh()
  }

  /** 任务运行状态变化（来自会话列表的 running 汇总）。 */
  setTaskActive(active: boolean): void {
    this.taskActive = active
    if (!active) {
      this.releaseLock()
    } else {
      this.refresh()
    }
  }

  /** 反转为本浏览器开关并返回新值。 */
  toggle(): boolean {
    const next = !this.enabled
    this.setOverride(next)
    return next
  }

  /** 订阅状态变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 释放所有资源（组件卸载时调用）。 */
  dispose(): void {
    this.unsubscribeVisibility?.()
    this.unsubscribeVisibility = null
    this.releaseLock()
    this.listeners.clear()
  }

  /** 按当前条件重新对账锁状态。 */
  private refresh(): void {
    if (!this.supported || !this.enabled || !this.taskActive || !this.visible) {
      this.releaseLock()
      return
    }
    if (this.sentinel !== null) return
    this.requestFailed = false
    void this.request()
      .then((sentinel) => {
        if (sentinel === null) {
          this.requestFailed = true
          this.emit()
          return
        }
        this.sentinel = sentinel
        sentinel.addEventListener('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null
          this.emit()
        })
        this.emit()
      })
      .catch(() => {
        this.requestFailed = true
        this.emit()
      })
  }

  private async releaseLock(): Promise<void> {
    const sentinel = this.sentinel
    this.sentinel = null
    if (sentinel !== null) {
      try {
        await sentinel.release()
      } catch {
        // 浏览器已释放则忽略
      }
    }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        // 订阅者异常不影响管理器
      }
    }
  }
}

/** localStorage 不可用时的兜底（无持久化能力）。 */
const emptyStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
