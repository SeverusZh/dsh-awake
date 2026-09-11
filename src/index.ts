/**
 * dsh-awake —— DeepSeek Harness 防休眠插件（守夜人）v0.2.1。
 *
 * host（node）半入口：监听 agent 会话生命周期（`session/event` 的
 * `turn/start` / `turn/end`），在「有任务正在执行」期间持有防休眠锁，
 * 任务结束后释放。方式子系统（src/modes）按平台聚合实现，拿锁时按
 * 配置 + 回退链逐个尝试（见 DESIGN.md 3.1）。
 *
 * Cordis 插件契约：具名导出 { name, inject, apply }。
 */
import { AwakeService } from './host/service.js'
import { PLUGIN_ID } from './shared/constants.js'

export type {
  AwakeSettingsShape, AwakeStatus, AwakeVersion, AttemptLog, ConfigField, ModeInfo,
  RestartResult, RpcError, RpcResult, SelectRequest, UpdateResult,
} from './types.js'

/** 插件包名（= Cordis 条目名）。 */
export const name = PLUGIN_ID

/**
 * 依赖的宿主服务：**无必需项**。
 *
 * 防休眠本身只靠 session 事件 + 平台命令，任何档位（web / tui / headless）都能跑；
 * 设置页数据面依赖 web 专属的 connection 服务，由 host/service.ts 用
 * ctx.inject(['connection'], …) 等它出现再注册（写入 export inject 会让条目在
 * 没有该服务的档位一直 pending，整棵树加载失败）。
 */
export const inject: readonly string[] = []

/** 装配入口：构造 AwakeService 即完成协调器 + settings + RPC 装配。 */
export function apply(ctx: import('./host/context.js').HostContext, config: Record<string, unknown> = {}): void {
  void new AwakeService(ctx, config)
}
