/**
 * settings 命名空间（可选服务：缺席时退回入口配置，只读）。
 *
 * - 宽松 schema：`{ version, platform, mode, config: 任意对象 }`——绝不在 schema
 *   里枚举 config 键（键由方式声明，校验在 host 侧 normalizeConfig）；
 * - stale 检测（跨平台复制 / 插件升级实现被删，统一一条逻辑，见 parseSettings）；
 * - 老版（0.1.x）配置自动迁移（enabled/shellWakeLock/powerCfgWakeLock/webWakeLock/why
 *   → version/platform/mode/config），迁移读原始 user 层，一次写回新格式；
 * - 每次 settings/updated 触发重新解析 + 协调器对账（openTurns > 0 时先放锁再拿锁）。
 *
 * schemastery 通过 profile 上下文动态解析（createRequire），不依赖本包自身的
 * 依赖安装状态（pnpm 对 link: 本地包不重新解析依赖，见 dsh-win-mgr AGENTS.md 4.4）。
 */
import { createRequire } from 'node:module'
import { CONFIG_VERSION, PLUGIN_ID, SETTINGS_NS } from '../shared/constants.js'
import type { AwakeSettingsShape } from '../types.js'
import { detectPlatform, powerModes, registryFor, type PlatformId } from '../modes/index.js'
import { errorMessage } from '../modes/shared/tools.js'
import type { HostContext, LoggerLike, SchemasteryNamespace, SettingsService } from './context.js'

/** 解析后的配置快照（stale 兜底已应用）。 */
export interface ParsedAwakeSettings {
  /** 运行时采用的方式；null = 关闭（off）/ 平台不支持。 */
  readonly modeId: string | null
  /** 配置来自其他平台 / 方式失效（解析兜底，不覆盖文件）。 */
  readonly stale: boolean
  /** 配置的平台锚点原文。 */
  readonly configuredPlatform: string | null
  /** 配置的方式原文。 */
  readonly configuredMode: string | null
  /** 该方式的配置（宽松对象，键由方式声明）。 */
  readonly config: Record<string, unknown>
}

/** 0.1.x 旧配置形状判定（顶层键存在即视为旧配置）。 */
export function isLegacyShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return 'enabled' in v || 'shellWakeLock' in v || 'powerCfgWakeLock' in v || 'webWakeLock' in v || 'why' in v
}

/**
 * 解析规则（统一一条逻辑）：
 *   1. platform === 当前平台 && mode 在注册表 → 正常；
 *   2. 否则 → 运行时用平台默认方式，stale = true，不覆盖文件；
 *   mode === 'off'（或未配置）→ 服务端不值守。
 */
export function parseSettings(value: unknown, platform: PlatformId | 'unsupported'): ParsedAwakeSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  const configuredPlatform = typeof raw.platform === 'string' ? raw.platform : null
  const configuredMode = typeof raw.mode === 'string' ? raw.mode : null
  const config =
    typeof raw.config === 'object' && raw.config !== null ? (raw.config as Record<string, unknown>) : {}
  const registry = registryFor(platform)
  if (registry === undefined) {
    return { modeId: null, stale: false, configuredPlatform, configuredMode, config }
  }
  if (configuredMode === null || configuredMode === 'off') {
    return { modeId: null, stale: false, configuredPlatform, configuredMode, config }
  }
  if (configuredPlatform === platform && registry.modes[configuredMode] !== undefined) {
    return { modeId: configuredMode, stale: false, configuredPlatform, configuredMode, config }
  }
  return { modeId: registry.defaultMode, stale: true, configuredPlatform, configuredMode, config }
}

/** 从入口配置构建 base（丢弃 0.1.x 旧键；平台/方式缺省取当前平台默认）。 */
export function buildBase(
  entry: Record<string, unknown> | undefined,
  platform: PlatformId | 'unsupported',
): AwakeSettingsShape {
  const registry = registryFor(platform)
  return {
    version: CONFIG_VERSION,
    platform: typeof entry?.platform === 'string' ? entry.platform : platform,
    mode: typeof entry?.mode === 'string' ? entry.mode : (registry?.defaultMode ?? 'off'),
    config: typeof entry?.config === 'object' && entry?.config !== null ? (entry.config as Record<string, unknown>) : {},
  }
}

export class AwakeSettings {
  private parsed: ParsedAwakeSettings
  private updater: ((patch: Record<string, unknown>) => Promise<unknown>) | null = null
  private replacerImpl: ((section: Record<string, unknown>) => Promise<unknown>) | null = null

  constructor(
    private readonly ctx: HostContext,
    private readonly base: AwakeSettingsShape,
    private readonly onReconcile: () => Promise<void>,
    private readonly logger: LoggerLike,
  ) {
    // 未挂载 settings 服务时退回入口配置（只读）。
    this.parsed = parseSettings(base, detectPlatform())
  }

  /** 当前解析结果（服务状态用）。 */
  get snapshot(): ParsedAwakeSettings {
    return this.parsed
  }

  /** settings 写入钩子：update（深合并，用于局部补丁）。服务缺席为 null = 只读。 */
  get writer(): ((patch: Record<string, unknown>) => Promise<unknown>) | null {
    return this.updater
  }

  /**
   * settings 写入钩子：replace（整段替换，config 换方式时清残留键的路径——
   * update 是深合并，`config: {}` 合并不掉旧键，select 必须走 replace）。
   * 服务缺席为 null = 只读。
   */
  get replacer(): ((section: Record<string, unknown>) => Promise<unknown>) | null {
    return this.replacerImpl
  }

  /** 注册 settings 命名空间（可选服务；callback 在服务可用时执行）。 */
  attach(): void {
    // schemastery 通过 profile 上下文动态解析（createRequire）；解析失败 = 跳过注册（只读）。
    let schema: SchemasteryNamespace | undefined
    if (this.ctx.baseUrl !== undefined) {
      try {
        const require = createRequire(this.ctx.baseUrl)
        schema = require('@deepseek-ai/schemastery') as SchemasteryNamespace
      } catch (error) {
        this.logger.warn(`[${PLUGIN_ID}] 无法解析 @deepseek-ai/schemastery（${errorMessage(error)}），设置页热配置不可用，仅使用入口配置`)
      }
    }
    if (schema === undefined) return

    this.ctx.inject(['settings'], (sctx) => {
      // 宽松 schema：config 用 any()（任意对象），绝不在 schema 里枚举 config 键。
      const valueSchema = schema!.object({
        version: schema!.number().required(false).description('配置文件版本（当前 2；老配置自动转换）'),
        platform: schema!.string().required(false).description('锚点：上次写入配置的平台（复制 .dsh 到其他系统时识别）'),
        mode: schema!.string().required(false).description('当前平台选中的方式（= 实现文件名）；off = 关闭服务端'),
        config: schema!.any().required(false).description('该方式的配置；字段由方式声明（宽松 schema）'),
      })
      sctx.settings.register(SETTINGS_NS, valueSchema, { base: this.base })
      this.updater = (patch) => sctx.settings.update(SETTINGS_NS, patch)
      this.replacerImpl = (section) => sctx.settings.replace(SETTINGS_NS, section)

      const apply = async (): Promise<void> => {
        const platform = detectPlatform()
        this.parsed = parseSettings(sctx.settings.get(SETTINGS_NS), platform)
        void this.onReconcile()
        await this.maybeMigrate(sctx, platform)
      }

      sctx.on('settings/updated', (ns: unknown) => {
        if (ns === SETTINGS_NS) void apply()
      })
      void apply()
      this.logger.info(`[${PLUGIN_ID}] settings 命名空间 ${SETTINGS_NS} 已注册（设置页可热改配置）`)
    })
  }

  /**
   * 0.1.x → 0.2.0 自动迁移（读原始 user 层，一次写回新格式；写回后 settings/updated
   * 再次触发 apply，届时已是新格式，不再迁移——无循环）。
   */
  private async maybeMigrate(sctx: { readonly settings: SettingsService }, platform: PlatformId | 'unsupported'): Promise<void> {
    const descriptor = sctx.settings.describe().find((d) => d.ns === SETTINGS_NS)
    const user = descriptor?.user
    if (!isLegacyShape(user)) return

    const v = user as Record<string, unknown>
    const registry = registryFor(platform)
    let mode: string
    if (v.enabled === false) {
      mode = 'off'
    } else if (v.powerCfgWakeLock === true && v.shellWakeLock !== true && platform !== 'unsupported') {
      // 只开 powerCfg → 该平台电源类实现。
      mode = powerModes[platform]
    } else {
      mode = registry?.defaultMode ?? 'off'
    }
    const config: Record<string, unknown> = {}
    if (typeof v.why === 'string' && v.why.length > 0) config.why = v.why

    try {
      await sctx.settings.replace(SETTINGS_NS, { version: CONFIG_VERSION, platform, mode, config })
      this.logger.info(`[${PLUGIN_ID}] 检测到 0.1.x 旧配置，已自动迁移为 v${CONFIG_VERSION} 格式并保存到配置文件`)
    } catch (error) {
      // 迁移失败不阻塞：内存中已按新格式生效，下次设置页写入会落盘新格式。
      this.logger.warn(`[${PLUGIN_ID}] 0.1.x 旧配置自动迁移失败（${errorMessage(error)}），内存中已按新格式生效`)
    }
    // 迁移后按新值重新解析（replace 的 settings/updated 还会再跑一次 apply，这里兜底）。
    this.parsed = parseSettings(sctx.settings.get(SETTINGS_NS), detectPlatform())
  }
}
