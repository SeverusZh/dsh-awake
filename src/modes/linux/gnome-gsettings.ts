/**
 * dsh-awake —— Linux 方式：GNOME gsettings（电源类，回退用）。
 *
 * 临时修改 GNOME 电源设置 sleep-inactive-ac-type -> 'nothing'（从不睡眠），
 * 任务结束恢复原值。仅 GNOME 桌面（gsettings）可用。
 */

import type { WakeMode } from '../index.js'
import { commandAvailable, errorMessage, runCommand } from '../shared/tools.js'

/** GNOME 电源设置的 gsettings key。 */
const GNOME_SCHEMA = 'org.gnome.settings-daemon.plugins.power'
const GNOME_KEY = 'sleep-inactive-ac-type'

export const gnomeGsettings: WakeMode = {
  id: 'gnome-gsettings',
  name: 'GNOME gsettings',
  description: '临时修改 GNOME 电源设置（从不睡眠），任务结束恢复原值；仅 GNOME 桌面可用。',
  default: false,
  fields: [],
  isAvailable() {
    if (!commandAvailable('gsettings', ['--version'])) {
      return { ok: false, reason: '未找到 gsettings（仅支持 GNOME 桌面）' }
    }
    // 二进制存在不代表可用：非 GNOME 桌面（如 KDE）可能没有该 schema。
    // 真实读一次 key（快，~10ms），失败即判定不可用。
    try {
      runCommand('gsettings', ['get', GNOME_SCHEMA, GNOME_KEY])
      return { ok: true }
    } catch {
      return { ok: false, reason: 'GNOME 电源 schema 不可用（当前桌面可能非 GNOME）' }
    }
  },
  async start() {
    // gsettings get 输出自带单引号（GVariant 文本），原样保存并在恢复时原样回写。
    let original: string
    try {
      original = runCommand('gsettings', ['get', GNOME_SCHEMA, GNOME_KEY]).stdout.trim()
    } catch (error) {
      throw new Error(`gsettings 不可用（仅支持 GNOME 桌面）：${errorMessage(error)}`)
    }

    runCommand('gsettings', ['set', GNOME_SCHEMA, GNOME_KEY, "'nothing'"])

    let restored = false
    return {
      description: `linux · gnome-gsettings ${GNOME_KEY}=${original} -> 'nothing'`,
      isActive: () => !restored,
      async stop() {
        if (restored) return
        restored = true
        runCommand('gsettings', ['set', GNOME_SCHEMA, GNOME_KEY, original])
      },
    }
  },
}
