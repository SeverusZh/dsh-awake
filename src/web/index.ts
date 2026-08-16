/**
 * dsh-awake —— web 客户端插件（方案A：浏览器 Screen Wake Lock）。
 *
 * 两部分，均不向页面注入任何可见元素：
 *  1. 后台防休眠驱动：跟随会话列表的 running 汇总申请/释放 Wake Lock，
 *     开关实时来自服务端设置（「插件」设置页里的 webWakeLock / enabled）；
 *  2. 「插件」设置页卡片：把 dsh-awake 的配置项（A/B/C 开关 + why）注册进
 *     settings.plugin.item 列表槽，让用户能在设置页里开关。
 */

import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
// 仅引入类型：声明 ctx.settingsScope 服务与 settings.plugin.item 槽位。
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { WakeLockManager } from './wake-lock.ts'
import { AwakeCard, type AwakeCardInjected } from './AwakeCard.tsx'
import { WAKE_SETTINGS_NAMESPACE, type WakeConfig } from '../config.ts'

/** 需要的服务：槽注册表、设置 scope 绑定、会话列表。 */
export const inject = ['slots', 'settingsScope', 'sessions']

/**
 * 客户端插件主体。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<WakeConfig>({ namespace: WAKE_SETTINGS_NAMESPACE })

  // —— 1. 后台防休眠驱动（无 UI）——
  const manager = new WakeLockManager()

  const syncEnabled = () => {
    const snap = scope.getSnapshot()
    const cfg = snap.value
    const enabled = cfg === undefined ? true : cfg.enabled !== false && cfg.webWakeLock !== false
    manager.setEnabled(enabled)
  }
  scope.subscribe(syncEnabled)
  syncEnabled()

  // ctx.sessions 在 node 半与 web 半的类型声明不同，这里显式按 web 半取值。
  const sessions = ctx.get('sessions') as unknown as ISessions
  const syncRunning = () => {
    const list = sessions.list.getSnapshot()
    const anyRunning = Object.values(list.byId).some((summary) => summary.running)
    manager.setTaskActive(anyRunning)
  }
  sessions.list.subscribe(syncRunning)
  syncRunning()

  ctx.effect(
    () => () => {
      manager.dispose()
    },
    'dsh-awake: 防休眠驱动',
  )

  // —— 2. 「插件」设置页卡片 ——
  const cardInject: AwakeCardInjected = { scope }
  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      {
        name: 'settings.plugin.item',
        id: 'dsh-awake',
        order: 30,
        inject: () => cardInject,
      },
      AwakeCard,
    ),
  )
}
