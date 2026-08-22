/**
 * dsh-awake —— 浏览器半入口（window.__ModuleLoader__ bundle）。
 *
 * 注册设置页「防休眠」（settings.section，DESIGN.md 4.1）+ 后台浏览器 Wake Lock
 * 驱动（2.3，跟随会话列表 running 汇总；开关走 localStorage）。
 *
 * 数据面走 ctx.connection.rpc（通道 /dsh-awake，见 src/types.ts 的线格式）：
 *   - awake.status / awake.refresh / awake.select / awake.version /
 *     awake.update / awake.restart
 *
 * 本文件由 tsdown 打包为 ModuleLoader 工厂形态（banner/intro/footer 由
 * tsdown.client.config.ts 拼装），源码里可以正常使用 import/JSX。
 */
import { makeRpc } from './api.js'
import { AwakeSection } from './components/AwakeSection.js'
import { en, zh } from './locales.js'
import { PLUGIN_ID, SECTION_ORDER, SETTINGS_LOCALE_NS, SETTINGS_SLOT_ID } from '../shared/constants.js'
import type { ClientContext } from './types.js'
import { isWebWakeLockEnabled, WakeLockManager } from './wake-lock.js'

/** 插件包名（= ModuleLoader 条目 id）。 */
export const name = PLUGIN_ID

/** 依赖的客户端服务（slots / connection / sessions / locale 均为 DSH 平台模块）。 */
export const inject = ['slots', 'connection', 'sessions', 'locale']

/** 装配入口：注册设置页 + 后台 Wake Lock 驱动。 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(SETTINGS_LOCALE_NS)
  // 注意：ctx.effect 的 callback 会立即执行，其返回值才是卸载时的清理函数——
  // 绝不能在这里直接调用 disposeLocale()（会立刻注销字典，t 随即失效）。
  const disposeLocale = ctx.locale.register(SETTINGS_LOCALE_NS, { zh, en })

  // 样式标签以 data-plugin 标记（loader 卸载时会清理插件拥有的标签）；这里再
  // 兜底一个 effect：卸载时移除本插件名下的所有 <style>。
  const removeOwnedStyles = (): void => {
    for (const tag of document.querySelectorAll(`style[data-plugin="${PLUGIN_ID}"]`)) {
      tag.remove()
    }
  }
  ctx.effect(
    () => () => {
      disposeLocale()
      removeOwnedStyles()
    },
    `${PLUGIN_ID}: locale + style cleanup`,
  )

  // —— 后台浏览器 Wake Lock 驱动（2.3，无 UI）——
  const manager = new WakeLockManager()
  manager.setEnabled(isWebWakeLockEnabled())

  // ctx.sessions：跟随「是否有任务在运行」的 running 汇总申请/释放 Wake Lock。
  const syncRunning = (): void => {
    const list = ctx.sessions.list.getSnapshot()
    const anyRunning = Object.values(list.byId).some((summary) => summary.running)
    manager.setTaskActive(anyRunning)
  }
  const unsubscribeSessions = ctx.sessions.list.subscribe(syncRunning)
  syncRunning()

  ctx.effect(
    () => () => {
      unsubscribeSessions()
      manager.dispose()
    },
    `${PLUGIN_ID}: wake lock driver`,
  )

  // —— 设置页「防休眠」（settings.section）——
  const api = makeRpc(ctx.connection)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: SETTINGS_SLOT_ID,
        order: SECTION_ORDER,
        label: () => t('sectionLabel'),
        inject: () => ({ api, manager, t }),
      },
      AwakeSection,
    ),
  )
}
