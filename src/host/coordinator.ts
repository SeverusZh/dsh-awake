/**
 * AwakeCoordinator：生命周期引用计数 + 回退链（拿锁/放锁）+ 常开防休眠。
 *
 * - `session/event` 的 turn/start 0→1 拿锁、turn/end 1→0 放锁（跨会话引用计数；
 *   开启常开防休眠后，任务全部结束也保持值守）；
 * - 拿锁按「首选 + 平台 order 回退链」逐个尝试：新鲜 isAvailable() 预检 →
 *   start()；全部失败 → effective = null（关闭），attempts 记录每个失败原因；
 * - 所有拿/放锁动作走一条串行 promise 链，绝不交错；
 * - 设置变更（settings/updated）→ 先放锁再按新配置拿锁（对账，同一轮事件去重；
 *   常开防休眠开启时 openTurns = 0 也对账）；
 * - 插件卸载 → 无条件放锁。
 */
import type { AttemptLog } from '../types.js'
import type { ModeSession, PlatformRegistry } from '../modes/index.js'
import { errorMessage } from '../modes/shared/tools.js'
import type { LoggerLike } from './context.js'

export interface CoordinatorDeps {
  /** 当前平台注册表；undefined = 平台不受支持（永不值守）。 */
  readonly registry: PlatformRegistry | undefined
  /** 解析当前配置：modeId null = 关闭（off）；config 是该方式的配置；alwaysOn = 常开防休眠。 */
  resolve(): { readonly modeId: string | null; readonly config: Record<string, unknown>; readonly alwaysOn: boolean }
  readonly logger: LoggerLike
}

export class AwakeCoordinator {
  private openTurns = 0
  private state: 'idle' | 'acquiring' | 'active' = 'idle'
  private session: ModeSession | null = null
  private effective: string | null = null
  private attempts: AttemptLog[] = []
  private chain: Promise<void> = Promise.resolve()
  private reconcilePromise: Promise<void> | null = null

  constructor(private readonly deps: CoordinatorDeps) {}

  /** 打开中的 turn 总数。 */
  get openTurnCount(): number {
    return this.openTurns
  }

  /** 实际生效的方式（回退后）；null = 服务端未值守。 */
  get effectiveMode(): string | null {
    return this.effective
  }

  /** 是否值守中（openTurns > 0 且会话已启动）。 */
  get isActive(): boolean {
    return this.state === 'active'
  }

  /** 最近一次拿锁的尝试记录。 */
  get attemptLog(): readonly AttemptLog[] {
    return this.attempts
  }

  /** session/event 处理：turn/start 0→1 拿锁，turn/end 1→0 放锁（常开时保持）。 */
  onSessionEvent(event: { readonly type: string }): void {
    if (event.type === 'turn/start') {
      this.openTurns += 1
      if (this.openTurns === 1) void this.acquire()
    } else if (event.type === 'turn/end') {
      if (this.openTurns > 0) this.openTurns -= 1
      // 常开防休眠：任务全部结束后仍保持值守；否则 1→0 放锁。
      if (this.openTurns === 0 && !this.deps.resolve().alwaysOn) void this.release()
    }
  }

  /**
   * 设置变更对账：若在值守则先放锁再按新配置拿锁。
   * 同一轮 settings 事件可能触发多次调用，去重为一次（复用同一 promise）。
   * 常开防休眠开启后，即使 openTurns = 0 也需要对账（拿锁/换锁）。
   */
  reconcile(): Promise<void> {
    if (this.state === 'idle' && !this.shouldHold()) return Promise.resolve()
    if (this.reconcilePromise !== null) return this.reconcilePromise
    this.reconcilePromise = this.enqueue(async () => {
      this.reconcilePromise = null
      await this.doRelease()
      await this.doAcquire()
    })
    return this.reconcilePromise
  }

  /** 插件卸载：无条件放锁（幂等）。 */
  dispose(): Promise<void> {
    return this.enqueue(async () => {
      await this.doRelease()
    })
  }

  /** 等待当前串行链排空（RPC select 后拿最新状态用）。 */
  drain(): Promise<void> {
    return this.chain.then(() => {})
  }

  /** 串行链：所有拿/放锁动作排队执行，互不交错；链永不 reject。 */
  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.chain.then(task, task)
    this.chain = run.then(
      () => {},
      () => {},
    )
    return run
  }

  /** 是否应持有锁：有任务运行，或开启了常开防休眠。 */
  private shouldHold(): boolean {
    return this.openTurns > 0 || this.deps.resolve().alwaysOn
  }

  private acquire(): Promise<void> {
    if (!this.shouldHold() || this.state !== 'idle') return Promise.resolve()
    return this.enqueue(async () => {
      if (!this.shouldHold() || this.state !== 'idle') return
      this.state = 'acquiring'
      await this.doAcquire()
    })
  }

  private release(): Promise<void> {
    if (this.state === 'idle') return Promise.resolve()
    return this.enqueue(async () => {
      await this.doRelease()
    })
  }

  /**
   * 拿锁（回退语义）：
   *   首选 = 配置的 mode（若与当前平台匹配且在注册表中）；
   *   尝试序列 = [首选, ...platform.order 去掉首选]；
   *   每个方式：新鲜 isAvailable() 失败 → 记原因，下一个；start() 失败 → 记原因，下一个；
   *   成功 → effective = 该方式；全部失败 → effective = null（关闭）。
   */
  private async doAcquire(): Promise<void> {
    const { registry } = this.deps
    this.session = null
    this.effective = null
    if (registry === undefined || !this.shouldHold()) {
      this.attempts = []
      this.state = 'idle'
      return
    }
    const resolved = this.deps.resolve()
    if (resolved.modeId === null) {
      // 用户选 off：不值守，无提示。
      this.attempts = []
      this.state = 'idle'
      return
    }
    const order = registry.order
    const preferred = order.includes(resolved.modeId) ? resolved.modeId : registry.defaultMode
    const chainModes = [preferred, ...order.filter((id) => id !== preferred)]
    const attempts: AttemptLog[] = []
    for (const id of chainModes) {
      const mode = registry.modes[id]
      if (mode === undefined) continue
      // 1. 新鲜 isAvailable() 预检（省得真启动；运行时变化由 start 失败兜底）。
      const probe = mode.isAvailable()
      if (!probe.ok) {
        attempts.push({ id, ok: false, reason: probe.reason })
        continue
      }
      // 2. start()。
      try {
        const session = await mode.start(resolved.config)
        this.session = session
        this.effective = id
        this.state = 'active'
        this.attempts = [...attempts, { id, ok: true }]
        this.deps.logger.info(`[dsh-awake] 值守中：${session.description}`)
        return
      } catch (error) {
        attempts.push({ id, ok: false, reason: errorMessage(error) })
        this.deps.logger.warn(`[dsh-awake] 方式 ${id} 启动失败：${errorMessage(error)}`)
      }
    }
    this.effective = null
    this.state = 'idle'
    this.attempts = attempts
    this.deps.logger.warn(
      `[dsh-awake] 全部方式失败，服务端未值守（${attempts.map((a) => `${a.id}${a.reason === undefined ? '' : `: ${a.reason}`}`).join('；')}）`,
    )
  }

  /** 放锁：stop 所有已启动的 session（幂等）。 */
  private async doRelease(): Promise<void> {
    this.state = 'idle'
    this.effective = null
    const session = this.session
    this.session = null
    if (session !== null) {
      try {
        await session.stop()
        this.deps.logger.info('[dsh-awake] 防休眠已释放')
      } catch (error) {
        this.deps.logger.warn(`[dsh-awake] 释放失败：${errorMessage(error)}`)
      }
    }
  }
}
