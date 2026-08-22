/**
 * 跨半共享的线格式（wire types）：host 半与 client 半对数据面的共同形状。
 * 纯类型，无运行时代码身份——client bundle 会把它内联进去。
 */

/** 支持的操作系统平台（与 node process.platform 对齐）。 */
export type PlatformId = 'linux' | 'darwin' | 'win32'

/** 配置字段描述符（动态 schema）：方式自己声明字段，加类型 = client 加渲染分支 + 这里加一行。 */
export type ConfigField =
  /** 纯说明文字，无 key，不产生配置值。 */
  | { readonly type: 'text'; readonly content: string }
  | { readonly type: 'input'; readonly key: string; readonly title: string; readonly hint?: string; readonly placeholder?: string; readonly default?: string }
  | { readonly type: 'textarea'; readonly key: string; readonly title: string; readonly hint?: string; readonly default?: string; readonly rows?: number }
  | { readonly type: 'boolean'; readonly key: string; readonly title: string; readonly hint?: string; readonly default?: boolean }
  | { readonly type: 'select'; readonly key: string; readonly title: string; readonly hint?: string; readonly default?: string; readonly options: readonly { readonly label: string; readonly value: string }[] }
  | { readonly type: 'number'; readonly key: string; readonly title: string; readonly hint?: string; readonly default?: number; readonly min?: number; readonly max?: number }

/** 一个方式的字段描述符里带 key 的可配置字段（text 无 key）。 */
export type ConfigFieldWithKey = Exclude<ConfigField, { readonly type: 'text' }>

/** 设置页下拉里的一个方式条目。 */
export interface ModeInfo {
  /** 方式 id（= 实现文件名，如 'systemd'）。 */
  readonly id: string
  /** 下拉项短名（如 'systemd-inhibit'）。 */
  readonly name: string
  /** 一段介绍：原理、适用条件、注意事项（UI 说明区）。 */
  readonly description: string
  /** 是否平台默认方式。 */
  readonly default: boolean
  /** 探测结果（缓存）；false 时下拉项 disabled 并显示 reason。 */
  readonly available: boolean
  /** 不可用原因（available 为 false 时展示）。 */
  readonly reason: string | null
  /** 配置字段描述符（动态表单）。 */
  readonly fields: readonly ConfigField[]
}

/** 最近一次拿锁的尝试记录（回退链里每个方式的探测/启动结果）。 */
export interface AttemptLog {
  /** 方式 id。 */
  readonly id: string
  /** 该方式是否成功。 */
  readonly ok: boolean
  /** 失败原因（ok 为 false 时给出）。 */
  readonly reason?: string
}

/** 版本信息：current = 磁盘包版本 / loaded = 运行中版本。 */
export interface AwakeVersion {
  readonly current: string
  readonly loaded: string
}

/** awake.status / awake.refresh / awake.select 的响应体。 */
export interface AwakeStatus {
  /** 当前平台；不支持时 'unsupported'。 */
  readonly platform: PlatformId | 'unsupported'
  /** 配置里选中的方式；null = 关闭（off）。 */
  readonly selected: string | null
  /** 实际生效的方式（回退后）；null = 服务端未值守。 */
  readonly effective: string | null
  /** 是否值守中（openTurns > 0 且会话已启动）。 */
  readonly active: boolean
  /** 打开中的 turn 总数（跨会话引用计数）。 */
  readonly openTurns: number
  /** 配置来自其他平台 / 方式失效（解析兜底，不覆盖文件）。 */
  readonly stale: boolean
  /** stale 时的配置原文（提示文案用）。 */
  readonly configured: { readonly platform: string | null; readonly mode: string | null }
  /** 最近一次拿锁的尝试记录。 */
  readonly attempts: readonly AttemptLog[]
  /** 当前平台全部方式（下拉渲染）。 */
  readonly modes: readonly ModeInfo[]
  /** 选中方式的配置（动态表单初值；键由方式声明，宽松对象）。 */
  readonly config: Record<string, unknown>
  readonly version: AwakeVersion
  /** DSH Desktop 环境（更新/重启由桌面版管理）。 */
  readonly desktop: boolean
}

/** settings 命名空间的持久化形状（宽松 schema：config 任意对象，键由方式声明）。 */
export interface AwakeSettingsShape {
  /** 配置文件版本（当前 2；老配置自动转换）。 */
  readonly version?: number
  /** 锚点：上次写入配置的平台（复制 .dsh 到其他系统时识别）。 */
  readonly platform?: string
  /** 当前平台选中的方式（= 实现文件名）；'off' = 关闭服务端。 */
  readonly mode?: string
  /** 该方式的配置；多数方式为空 {}。 */
  readonly config?: Record<string, unknown>
}

/** RPC 错误码（对齐 dsh-host-apiproxy rpcErrorSchema）。 */
export type RpcErrorCode = 'cancelled' | 'bad-request'

/** RPC 错误形状（与 dsh-pocket rpcErrorSchema 一致）。 */
export interface RpcError {
  readonly code: RpcErrorCode
  readonly message: string
  readonly details: unknown
}

/** RPC 信封：成功 / 失败判别联合。 */
export type RpcResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RpcError }

/** awake.update 的结果（外层 RPC 信封 ok 为传输成功，这里的 ok 为更新本身）。 */
export interface UpdateResult {
  readonly ok: boolean
  output?: string
  error?: string
  /** 更新成功后是否已自动拉起重启。 */
  autoRestart?: boolean
}

/** awake.restart 的结果。 */
export interface RestartResult {
  readonly ok: boolean
  readonly helperPid?: number | null
  readonly hint?: string
  readonly error?: string
}

/** awake.select 的请求体。 */
export interface SelectRequest {
  /** 方式 id；'off' = 关闭服务端。 */
  readonly mode: string
  /** 该方式的配置（宽松对象，host 按字段描述符 normalize）。 */
  readonly config?: Record<string, unknown>
}

/** 应用设置后的试运行（start→stop 冒烟测试）结果。 */
export interface ModeTestResult {
  readonly ok: boolean
  /** 失败/不可用原因（ok 为 false 时给出）。 */
  readonly reason?: string
  /** 成功时的会话说明（如 'linux · systemd-inhibit sleep infinity'）。 */
  readonly description?: string
}

/** awake.select 的响应：状态 + 试运行结果（off / 有任务运行 / 平台不支持时为 null）。 */
export interface SelectResponse {
  readonly status: AwakeStatus
  readonly test: ModeTestResult | null
}
