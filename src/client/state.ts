/** 设置页共享的组件状态类型（判别联合，见官方 PluginManagerTab 的 LoadState 惯例）。 */
import type { AwakeStatus } from '../types.js'

/** 设置页数据加载状态。 */
export type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: AwakeStatus }
