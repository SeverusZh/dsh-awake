/**
 * dsh-awake —— 方案 A 浏览器半的核心逻辑：Screen Wake Lock 管理器。
 *
 * 规则：
 *   - 开关来自服务端设置（web 的「插件」设置页里改的 webWakeLock / enabled），
 *     通过 settings 命名空间实时同步，不再有每浏览器 localStorage 覆盖；
 *   - 有任务在运行且页面可见时持有 `navigator.wakeLock.request('screen')`；
 *   - 页面切到后台时浏览器会自动释放锁，`visibilitychange` 回到前台后自动重取；
 *   - 所有状态变化都会通知订阅者。
 *
 * 本管理器不渲染任何 UI：由客户端插件在后台驱动（见 index.ts）。
 */

export type WakeLockState =
  | 'unsupported' // 浏览器不支持 Screen Wake Lock API
  | 'disabled' // 设置里关闭了方案A
  | 'idle' // 已启用，但当前没有任务在运行
  | 'holding' // 已启用、有任务运行、锁已持有
  | 'hidden' // 已启用、有任务运行，但页面在后台（锁被浏览器自动释放）
  | 'request-error' // 已启用、有任务运行，但申请锁失败

export interface WakeLockManagerOptions {
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
  private enabled = true
  private taskActive = false
  private sentinel: WakeLockSentinel | null = null
  private requestFailed = false
  private readonly listeners = new Set<() => void>()

  private readonly supported: boolean
  private readonly request: () => Promise<WakeLockSentinel | null>
  private readonly subscribeVisibility: (listener: () => void) => () => void
  private visible: boolean
  private unsubscribeVisibility: (() => void) | null = null

  constructor(options: WakeLockManagerOptions = {}) {
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
      if (typeof document === 'undefined') return () => {}
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

  /** 当前 UI 状态。 */
  get state(): WakeLockState {
    if (!this.supported) return 'unsupported'
    if (!this.enabled) return 'disabled'
    if (!this.taskActive) return 'idle'
    if (!this.visible) return 'hidden'
    if (this.sentinel !== null) return 'holding'
    return this.requestFailed ? 'request-error' : 'idle'
  }

  /** 设置方案A开关（来自服务端设置）。 */
  setEnabled(value: boolean): void {
    this.enabled = value
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

  /** 订阅状态变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 释放所有资源（插件卸载时调用）。 */
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
