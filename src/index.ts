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
 * 配置通过用户设置（settings）暴露：注册 `dsh-awake` 命名空间，用户可在
 * web 的「插件」设置页里修改（`$DSH_HOME/settings.yaml` 持久化、热生效），
 * 未挂载 settings 服务时回退到补丁条目里的入口配置。
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { WAKE_SETTINGS_NAMESPACE, type WakeConfig } from './config.ts'
import { acquireShellInhibit } from './plans/shell.ts'
import { acquirePowerInhibit } from './plans/power.ts'

export const name = 'dsh-awake'

export type { WakeConfig } from './config.ts'

export const Config: Schema<WakeConfig> = Schema.object({
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
    private readonly getConfig: () => WakeConfig,
    private readonly logger: Logger,
  ) {}

  async acquire(): Promise<void> {
    const cfg = this.getConfig()
    if (!cfg.enabled || !cfg.shellWakeLock || this.child !== null) return
    try {
      this.child = await acquireShellInhibit(cfg.why)
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
    private readonly getConfig: () => WakeConfig,
    private readonly logger: Logger,
  ) {}

  async acquire(): Promise<void> {
    const cfg = this.getConfig()
    if (!cfg.enabled || !cfg.powerCfgWakeLock || this.snapshot !== null) return
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

export function apply(ctx: Context, config: WakeConfig) {
  const logger = ctx.logger('dsh-awake')

  // 当前权威配置：settings 挂载后指向设置值，否则指向入口配置。
  let source: () => WakeConfig = () => config

  const plans: WakePlan[] = [
    new ShellPlan(() => source(), logger),
    new PowerPlan(() => source(), logger),
  ]

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
    if (event.type === 'turn/start') {
      openTurns += 1
      if (openTurns === 1) acquire()
    } else if (event.type === 'turn/end') {
      if (openTurns > 0) openTurns -= 1
      if (openTurns === 0) release()
    }
  })

  // 设置变更（用户在「插件」设置页改配置）：若正在值守则按新配置重新对账。
  const reconcile = () => {
    if (openTurns <= 0) return
    release()
    acquire()
  }

  // 用户设置命名空间：挂载 settings 服务时注册并接管配置来源；变更热生效。
  installSettingsSection(ctx, settingsNamespace(WAKE_SETTINGS_NAMESPACE), Config, config, {
    setSource: (current) => {
      source = current
    },
    onChange: reconcile,
  })

  // 插件卸载（热重载 / 退出）时无条件放锁：effect 的 disposer 在 fiber 卸载时运行。
  ctx.effect(
    () => () => {
      release()
    },
    'dsh-awake: 卸载放锁',
  )

  logger.info(
    `dsh-awake 已启动：方案B=${config.shellWakeLock ? '开' : '关'}，方案C=${config.powerCfgWakeLock ? '开' : '关'}，webWakeLock=${config.webWakeLock ? '开' : '关'}`,
  )
}
