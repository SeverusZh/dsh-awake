/**
 * dsh-awake —— DeepSeek Harness 防休眠插件（守夜人）v0.2.0。
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
 * 依赖的宿主服务：connection / webServer 与 dsh-pocket 一致（RPC 通道的数据面）；
 * settings 走 ctx.inject 回调（可选）。两个服务在 web base 中恒在；缺席时
 * installAwakeRpc 内的 getOptionalService 兜底降级（服务端照常值守）。
 */
export const inject = ['connection', 'webServer']

/** 装配入口：构造 AwakeService 即完成协调器 + settings + RPC 装配。 */
export function apply(ctx: import('./host/context.js').HostContext, config: Record<string, unknown> = {}): void {
  void new AwakeService(ctx, config)
}
