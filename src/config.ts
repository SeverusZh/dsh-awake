/**
 * dsh-awake —— node 半与 web 半共享的配置类型与常量。
 */

/** 插件在用户设置（settings 文档）中的命名空间，也作为补丁条目 id 使用。 */
export const WAKE_SETTINGS_NAMESPACE = 'dsh-awake'

/** 插件配置（也是 settings 命名空间的 schema 形状）。 */
export interface WakeConfig {
  /** 总开关：false 时所有方案（含 web 端）都不生效。 */
  enabled: boolean
  /** 方案B：系统 shell 命令（默认开）。 */
  shellWakeLock: boolean
  /** 方案C：电源设置兜底（默认关，需自行开启；结束时会恢复原值）。 */
  powerCfgWakeLock: boolean
  /** 方案A：web 端浏览器 Wake Lock（默认开）。 */
  webWakeLock: boolean
  /** systemd-inhibit 的 --why 参数。 */
  why: string
}
