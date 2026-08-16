/**
 * dsh-awake —— DeepSeek Harness 防休眠插件（守夜人）。
 *
 * 服务端半：监听 agent 会话的生命周期事件（`session/event` 的
 * `turn/start` / `turn/end`，含出错、中断、取消等全部结束原因），
 * 在「有任务正在执行」期间持有防休眠锁，任务结束后释放：
 *   - 方案B（shellWakeLock）：systemd-inhibit / caffeinate / PowerShell，
 *     后台子进程随任务结束被 kill（见 plans/shell.ts）；
 *   - 方案C（powerCfgWakeLock，默认关）：临时修改系统电源设置，
 *     结束时恢复原值（见 plans/power.ts）。
 *
 * 同时向 web 客户端暴露 `/dsh-awake/config` 端点，供方案A
 * （浏览器 Screen Wake Lock，见 src/web/）读取全局默认值。
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { acquireShellInhibit } from './plans/shell.ts'
import { acquirePowerInhibit } from './plans/power.ts'

export const name = 'dsh-awake'

export interface Config {
  /** 总开关：false 时所有方案（含 web 端默认）都不生效。 */
  enabled: boolean
  /** 方案B：系统 shell 命令（默认开）。 */
  shellWakeLock: boolean
  /** 方案C：电源设置兜底（默认关，需自行开启；结束时会恢复原值）。 */
  powerCfgWakeLock: boolean
  /** 方案A 全局默认值：浏览器端可单独覆盖（localStorage）。 */
  webWakeLock: boolean
  /** systemd-inhibit 的 --why 参数。 */
  why: string
}

export const Config: Schema<Config> = Schema.object({
  enabled: Schema.boolean().default(true),
  shellWakeLock: Schema.boolean().default(true),
  powerCfgWakeLock: Schema.boolean().default(false),
  webWakeLock: Schema.boolean().default(true),
  why: Schema.string().default('dsh 任务执行中'),
})

/** 一个可独立启停的防休眠方案。 */
interface WakePlan {
  /** 尽力获取锁；失败时自行记录日志，不抛出（允许其余方案继续）。 */
  acquire(): Promise<void>
  /** 释放锁；幂等，不抛出。 */
  release(): Promise<void>
}

class ShellPlan implements WakePlan {
  private child: { description: string; release(): Promise<void> } | null = null

  constructor(
    private readonly enabled: boolean,
    private readonly why: string,
    private readonly logger: Logger,
  ) {}

  async acquire(): Promise<void> {
    if (!this.enabled || this.child !== null) return
    try {
      this.child = await acquireShellInhibit(this.why)
      this.logger.info(`方案B（系统命令）已生效：${this.child.description}`)
    } catch (error) {
      this.logger.warn(`方案B（系统命令）不可用，已跳过：${String((error as Error).message)}`)
    }
  }

  async release(): Promise<void> {
    const child = this.child
    this.child = null
    if (child === null) return
    try {
      await child.release()
      this.logger.info('方案B（系统命令）已释放')
    } catch (error) {
      this.logger.warn(`方案B 释放失败：${String((error as Error).message)}`)
    }
  }
}

class PowerPlan implements WakePlan {
  private snapshot: { description: string; restore(): Promise<void> } | null = null

  constructor(
    private readonly enabled: boolean,
    private readonly logger: Logger,
  ) {}

  async acquire(): Promise<void> {
    if (!this.enabled || this.snapshot !== null) return
    try {
      this.snapshot = await acquirePowerInhibit()
      if (this.snapshot === null) {
        this.logger.info('方案C（电源设置）：当前平台不支持，已跳过')
        return
      }
      this.logger.info(`方案C（电源设置）已生效：${this.snapshot.description}`)
    } catch (error) {
      this.snapshot = null
      this.logger.warn(`方案C（电源设置）不可用，已跳过：${String((error as Error).message)}`)
    }
  }

  async release(): Promise<void> {
    const snapshot = this.snapshot
    this.snapshot = null
    if (snapshot === null) return
    try {
      await snapshot.restore()
      this.logger.info('方案C（电源设置）已恢复原值')
    } catch (error) {
      this.logger.warn(`方案C 恢复失败：${String((error as Error).message)}`)
    }
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('dsh-awake')

  const plans: WakePlan[] = []
  if (config.enabled) {
    plans.push(new ShellPlan(config.shellWakeLock, config.why, logger))
    plans.push(new PowerPlan(config.powerCfgWakeLock, logger))
  }

  // —— 生命周期协调：按「打开中的 turn 总数」做引用计数，跨会话（含子代理）
  //    统一累计；0 -> 1 拿锁，1 -> 0 放锁。事件为同步派发，拿/放锁走一条
  //    串行 promise 链，避免 acquire/release 交错竞态。
  let openTurns = 0
  let state: 'idle' | 'acquiring' | 'active' = 'idle'
  let chain: Promise<void> = Promise.resolve()

  const acquire = () => {
    chain = chain.then(async () => {
      if (state !== 'idle') return
      state = 'acquiring'
      await Promise.all(plans.map((plan) => plan.acquire()))
      state = 'active'
    })
    chain = chain.catch((error) => {
      state = 'idle'
      logger.warn('拿锁流程异常：' + String((error as Error)?.message ?? error))
    })
  }

  const release = () => {
    chain = chain.then(async () => {
      if (state === 'idle') return
      state = 'idle'
      await Promise.all(plans.map((plan) => plan.release()))
    })
    chain = chain.catch((error) => {
      logger.warn('放锁流程异常：' + String((error as Error)?.message ?? error))
    })
  }

  ctx.on('session/event', (session, event: SessionEvent) => {
    if (!config.enabled) return
    if (event.type === 'turn/start') {
      openTurns += 1
      if (openTurns === 1) acquire()
    } else if (event.type === 'turn/end') {
      if (openTurns > 0) openTurns -= 1
      if (openTurns === 0) release()
    }
  })

  // 插件卸载（热重载 / 退出）时无条件放锁：effect 的 disposer 在 fiber 卸载时运行。
  ctx.effect(
    () => () => {
      release()
    },
    'dsh-awake: 卸载放锁',
  )

  // —— 可选配置端点：给 web 客户端提供方案A 的全局默认值。
  //    用 ctx.get 探测而非 inject：headless 等无 webServer 的 profile 也能
  //    正常使用方案B/C，只是没有该端点。
  let routeRegistered = false
  const registerConfigRoute = () => {
    if (routeRegistered) return
    const webServer = ctx.get('webServer')
    if (!webServer) return
    routeRegistered = true
    ctx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-awake/config',
          handler: (_req: unknown, res: { writeHead(code: number, headers: Record<string, string>): void; end(body: string): void }) => {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ enabled: config.enabled, webWakeLock: config.webWakeLock }))
          },
        }),
      'dsh-awake: 配置端点',
    )
  }
  registerConfigRoute()
  ctx.on('internal/service', (serviceName: string) => {
    if (serviceName === 'webServer') registerConfigRoute()
  })

  logger.info(`dsh-awake 已启动：方案B=${config.shellWakeLock ? '开' : '关'}，方案C=${config.powerCfgWakeLock ? '开' : '关'}，webWakeLock=${config.webWakeLock ? '开' : '关'}`)
}
