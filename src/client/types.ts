/**
 * Client 侧最小上下文类型（DSH client runtime 的结构子集）。
 * 刻意不依赖 @deepseek-ai/* 的类型：运行时由 client runner 注入真实 ctx，
 * 这里只声明本插件用到的面（slots / connection / sessions / locale / effect）。
 */
import type { RpcResult } from '../types.js'

/** settings.section 注册选项（对齐官方 ui-settings 的 SlotMap 契约）。 */
export interface SettingsSectionOptions {
  readonly name: 'settings.section'
  /** 左栏导航键（section key）。 */
  readonly id: string
  /** 导航位置（越大越靠后）。 */
  readonly order: number
  /** 导航文案（thunk；locale 变化时由注册方重新注册）。 */
  readonly label: () => string
  /** 注入给组件的字段（组件 props = { close, ...注入字段 }）。 */
  readonly inject: () => Record<string, unknown>
}

/** slots 服务（dsh-client-ui-slots 的结构子集）。 */
export interface SlotsService {
  inject(slot: string, contribution: () => unknown): unknown
  register(options: SettingsSectionOptions, component: unknown): unknown
}

/** locale 服务（dsh-client-locale 的结构子集）。 */
export interface LocaleService {
  register(namespace: string, dicts: Record<string, Record<string, string>>): () => void
  bind(namespace: string): (key: string) => string
}

/** connection.rpc 的结构子集（dsh-client-connection 的 client 半）。 */
export interface ConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>
}

export interface ConnectionService {
  readonly rpc: ConnectionRpc
}

/** 会话列表行（结构子集：wake lock 只看 running）。 */
export interface SessionSummary {
  readonly running: boolean
}

/** sessions.list 快照（结构子集）。 */
export interface SessionListSnapshot {
  readonly byId: Record<string, SessionSummary>
}

/** sessions.list 可观察对象（结构子集）。 */
export interface SessionListObservable {
  getSnapshot(): SessionListSnapshot
  subscribe(listener: () => void): () => void
}

/** sessions 服务（dsh-client-runtime 的结构子集）。 */
export interface SessionsService {
  readonly list: SessionListObservable
}

/** Client 侧 cordis 上下文。 */
export interface ClientContext {
  readonly slots: SlotsService
  readonly connection: ConnectionService
  readonly sessions: SessionsService
  readonly locale: LocaleService
  /** 注册一次性副作用；callback 立即执行，其返回值才是卸载时的清理函数。 */
  effect(dispose: () => void, label?: string): unknown
}
