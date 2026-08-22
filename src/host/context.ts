/**
 * Host 侧最小上下文类型（cordis Context 的结构子集）。
 *
 * 刻意不依赖 @deepseek-ai/cordis 的类型：运行时由 Cordis 注入真实 ctx，
 * 这里只声明本插件用到的面（on / effect / inject / get / connection / logger），
 * 避免为本包引入 peer 依赖链。
 */
import type { RpcResult } from '../types.js'

/** logger 服务的结构子集（cordis LoggerService：可调用 + 直接方法）。 */
export interface LoggerLike {
  (name?: string): LoggerLike
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** schemastery 的结构子集（仅本插件用到的构造器与链式描述）。 */
export interface SchemasteryNode {
  description(text: string): SchemasteryNode
  required(value?: boolean): SchemasteryNode
}

export interface SchemasteryNamespace {
  object(fields: Record<string, SchemasteryNode>): SchemasteryNode
  string(): SchemasteryNode
  number(): SchemasteryNode
  any<T = unknown>(): SchemasteryNode
}

/** settings 服务的结构子集（dsh-settings）。 */
export interface SettingsService {
  register(namespace: string, schema: unknown, options: { base: unknown }): unknown
  update(namespace: string, patch: Record<string, unknown>): Promise<unknown>
  replace(namespace: string, section: Record<string, unknown>): Promise<unknown>
  get(namespace: string): unknown
  /** 描述每个已注册命名空间（含原始 user 层，迁移检测用）。 */
  describe(): Array<{ ns: string; user?: unknown }>
}

/** ctx.inject(['settings'], ...) 回调里的子上下文。 */
export interface SettingsContext {
  readonly settings: SettingsService
  readonly on: HostContext['on']
}

/** connection.rpc 的结构子集（dsh-client-connection host 半）。 */
export interface ConnectionRpc {
  handle(
    channel: string,
    handler: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult<unknown>> | RpcResult<unknown>,
    options: { authority: 'loopback' | 'trusted-host' },
  ): () => Promise<void> | void
}

export interface ConnectionService {
  readonly rpc: ConnectionRpc
}

/** Host 侧 cordis 上下文。 */
export interface HostContext {
  /** profile 上下文解析器锚点（createRequire 用；缺失 = 无法解析 schemastery）。 */
  readonly baseUrl?: string
  readonly logger: LoggerLike
  /** 注册一次性副作用；callback 立即执行，其返回值才是卸载时的清理函数。 */
  effect(dispose: () => void, label?: string): unknown
  /** 订阅事件。 */
  on(event: string, listener: (...args: unknown[]) => void): unknown
  /** 读取可选服务（如 connection）；不存在返回 undefined。 */
  get<T = unknown>(service: string): T | undefined
  /** 注入可选服务（如 settings），回调收到带该服务的子上下文。 */
  inject(services: readonly string[], callback: (sctx: SettingsContext) => void): unknown
  /** Connection RPC（可选服务；缺席时设置页数据面停用）。 */
  readonly connection?: ConnectionService
}
