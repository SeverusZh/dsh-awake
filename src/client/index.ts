/**
 * dsh-awake —— 浏览器半入口（window.__ModuleLoader__ bundle）。
 *
 * 注册设置页「防休眠」（settings.section）+ 后台浏览器 Wake Lock 驱动。
 * 数据面走 ctx.connection.rpc（通道 /dsh-awake，见 src/types.ts 的线格式）。
 *
 * 本文件为骨架占位：完整装配见 client/index.ts（Step 4 填充）。
 */
import { PLUGIN_ID } from '../shared/constants.js'

/** 插件包名（= ModuleLoader 条目 id）。 */
export const name = PLUGIN_ID

/** 依赖的客户端服务（slots / connection / sessions / locale 均为 DSH 平台模块）。 */
export const inject = ['slots', 'connection', 'sessions', 'locale']

/** 装配入口：注册设置页 + 后台 Wake Lock 驱动（骨架阶段无操作）。 */
export function apply(): void {
  // 骨架阶段：待 client 半装配。
}
