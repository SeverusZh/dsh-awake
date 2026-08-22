/**
 * dsh-awake —— DeepSeek Harness 防休眠插件（守夜人）v0.2.0。
 *
 * host（node）半入口：监听 agent 会话生命周期（`session/event` 的
 * `turn/start` / `turn/end`），在「有任务正在执行」期间持有防休眠锁，
 * 任务结束后释放。方式子系统（src/modes）按平台聚合实现，拿锁时按
 * 配置 + 回退链逐个尝试（见 DESIGN.md 3.1）。
 *
 * 本文件为骨架占位：完整装配见 host/service.ts（Step 3 填充）。
 */
import { PLUGIN_ID } from './shared/constants.js'

export type {
  AwakeStatus, AwakeVersion, AttemptLog, ConfigField, ModeInfo,
  RpcError, RpcResult, SelectRequest, UpdateResult,
} from './types.js'

/** 插件包名（= Cordis 条目名）。 */
export const name = PLUGIN_ID

/** 依赖的宿主服务（settings 为可选结构，见 host/settings.ts 的降级路径）。 */
export const inject: string[] = []

/** 装配入口：构造 AwakeService 即完成协调器 + settings + RPC 装配。 */
export function apply(): void {
  // 骨架阶段：待 host/service.ts 装配。
}
