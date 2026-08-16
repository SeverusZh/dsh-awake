/**
 * dsh-awake —— web 客户端插件（方案A：浏览器 Screen Wake Lock）。
 *
 * 注册一个挂在 `shell.overlay` 列表槽上的守夜人状态浮标：
 * 有会话正在运行（running）时申请 Wake Lock，结束即释放；
 * 页面从后台切回时自动重取；每个浏览器/页面可用浮标单独开关。
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// 仅引入类型：声明 shell.overlay 槽位（由 ui-layout 提供）。
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WakeLockPill } from './WakeLockPill.tsx'

/** 需要的服务：槽注册表。 */
export const inject = ['slots']

/**
 * 客户端插件主体：把守夜人浮标注册进 frame 覆盖层。
 * 覆盖层席位仅在 ui-layout 的 frame 条目存活期间存在，因此注册走
 * `slots.inject` —— 等待声明、声明重载后重跑、随本插件 fiber 卸载。
 * @param ctx - 客户端根上下文。
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({ name: 'shell.overlay', id: 'dsh-awake' }, WakeLockPill),
  )
}
