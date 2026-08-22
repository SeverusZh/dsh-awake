/**
 * dsh-awake —— 方式子系统（host 半核心业务）。
 *
 * 平台优先、实现级粒度：方式 = 具体实现文件（systemd.ts、gnome-gsettings.ts…），
 * 平台目录聚合。加实现 = 加一个文件 + 注册一行；加平台 = 加一个目录。
 * 见 DESIGN.md 2.x。
 */
import type { ConfigField } from '../types.js'
import { linuxRegistry } from './linux/index.js'
import { darwinRegistry } from './darwin/index.js'
import { win32Registry } from './win32/index.js'

export type { ConfigField } from '../types.js'

export type PlatformId = 'linux' | 'darwin' | 'win32'

/** 一个已获取的防休眠会话；stop() 幂等，可安全重复调用。 */
export interface ModeSession {
  /** 人类可读的说明（日志/状态用），如 'linux · systemd-inhibit sleep infinity'。 */
  readonly description: string
  /** 运行状态（进程活着 / 设置已改）。 */
  isActive(): boolean
  /** 终止进程 / 恢复设置；幂等。 */
  stop(): Promise<void>
}

/** 探测结果（同步；耗时由调用方缓存）。 */
export type ProbeResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/** 单个方式实现（= 一个实现文件）。 */
export interface WakeMode {
  /** 方式 id（= 文件名，如 'systemd'）。 */
  readonly id: string
  /** 下拉项短名（如 'systemd-inhibit'）。 */
  readonly name: string
  /** 一段介绍：原理、适用条件、注意事项（UI 说明区）。 */
  readonly description: string
  /** 是否平台默认。 */
  readonly default: boolean
  /** 配置字段描述符（可为空数组 / 纯 text 说明）。 */
  readonly fields: readonly ConfigField[]
  /** 探测（可缓存；调用方在 refresh 时失效）。 */
  isAvailable(): ProbeResult
  /** 启动（拿锁）。config 是该方式的配置（键由 fields 声明）。 */
  start(config: Record<string, unknown>): Promise<ModeSession>
}

/** 平台注册表：方式 id 列表 = 下拉顺序 = 回退顺序。 */
export interface PlatformRegistry {
  readonly platform: PlatformId
  readonly order: readonly string[]
  readonly defaultMode: string
  readonly modes: Record<string, WakeMode>
}

/** 当前进程平台；不支持时返回 'unsupported'。 */
export function detectPlatform(): PlatformId | 'unsupported' {
  switch (process.platform) {
    case 'linux':
      return 'linux'
    case 'darwin':
      return 'darwin'
    case 'win32':
      return 'win32'
    default:
      return 'unsupported'
  }
}

/** 各平台的「电源类」方式（旧配置 powerCfgWakeLock 的迁移目标，见 host/settings.ts）。 */
export const powerModes: Record<PlatformId, string> = {
  linux: 'gnome-gsettings',
  darwin: 'pmset',
  win32: 'powercfg',
}

/** 静态 import 三平台注册表聚合。 */
export const registries: Record<PlatformId, PlatformRegistry> = {
  linux: linuxRegistry,
  darwin: darwinRegistry,
  win32: win32Registry,
}

/** 按平台取注册表；平台不支持时 undefined。 */
export function registryFor(platform: PlatformId | 'unsupported'): PlatformRegistry | undefined {
  return platform === 'unsupported' ? undefined : registries[platform]
}

/** 带 key 的配置字段（text 无 key）。 */
export function configFieldsWithKey(fields: readonly ConfigField[]): Array<Extract<ConfigField, { readonly key: string }>> {
  return fields.filter((field): field is Extract<ConfigField, { readonly key: string }> => 'key' in field)
}

/**
 * 按字段描述符归一化配置：保留声明过的键（缺失填 default），丢弃未知键。
 * 校验在 host 侧（持久化 schema 宽松），加实现不动 schema。
 */
export function normalizeConfig(fields: readonly ConfigField[], raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of configFieldsWithKey(fields)) {
    const value = raw?.[field.key]
    if (value !== undefined && value !== null && value !== '') {
      out[field.key] = value
    } else if ('default' in field && field.default !== undefined) {
      out[field.key] = field.default
    }
  }
  return out
}
