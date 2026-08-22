/**
 * dsh-awake —— Windows 方式：powercfg（电源类，回退用）。
 *
 * 临时修改电源方案 standby-timeout（从不睡眠），任务结束恢复原值
 * （原值单位秒 → powercfg /change 以分钟计）。
 */

import type { WakeMode } from '../index.js'
import { commandAvailable, errorMessage, runCommand } from '../shared/tools.js'

/** 十六进制数值（powercfg 输出中的 0x…）。 */
const HEX_VALUE = /0x[0-9a-fA-F]+/g

/** STANDBYIDLE GUID。 */
const STANDBYIDLE_GUID = '29f6c1db-86da-48c5-9fdb-f2b67b1f44da'

export const powercfg: WakeMode = {
  id: 'powercfg',
  name: 'powercfg',
  description: '临时修改电源方案 standby-timeout（从不睡眠），任务结束恢复原值；Windows 自带命令。',
  default: false,
  fields: [
    {
      type: 'text',
      content: '临时修改当前电源方案的睡眠超时为「从不睡眠」，任务结束恢复原值；Windows 自带命令。',
    },
  ],
  isAvailable() {
    if (!commandAvailable('powercfg', ['/?'])) {
      return { ok: false, reason: '未找到 powercfg' }
    }
    return { ok: true }
  },
  async start() {
    // 读取当前生效方案的「睡眠超时」AC/DC 原始值（单位：秒）。
    // 输出为本地化文本，但 GUID 与 0x 索引不受语言影响；
    // 该设置小节里最后的两个 0x 值即 Current AC / Current DC。
    const { stdout } = runCommand('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', STANDBYIDLE_GUID])
    const matches = stdout.match(HEX_VALUE)
    if (matches === null || matches.length < 2) {
      throw new Error('无法解析 powercfg 输出中的睡眠超时值')
    }
    const acSeconds = Number.parseInt(matches[matches.length - 2] ?? '0', 16)
    const dcSeconds = Number.parseInt(matches[matches.length - 1] ?? '0', 16)

    // 修改：从不睡眠（0 = 从不）。powercfg /change 以分钟为单位。
    runCommand('powercfg', ['/change', 'standby-timeout-ac', '0'])
    runCommand('powercfg', ['/change', 'standby-timeout-dc', '0'])

    let restored = false
    return {
      description: `win32 · powercfg standby-timeout ac=${acSeconds}s dc=${dcSeconds}s -> 0`,
      isActive: () => !restored,
      async stop() {
        if (restored) return
        restored = true
        try {
          // 原值秒数换算回分钟（Windows 设置界面本身以分钟粒度保存，误差可忽略）。
          runCommand('powercfg', ['/change', 'standby-timeout-ac', String(Math.round(acSeconds / 60))])
          runCommand('powercfg', ['/change', 'standby-timeout-dc', String(Math.round(dcSeconds / 60))])
        } catch (error) {
          // best-effort：恢复失败不抛出（避免放锁流程中断），仅记录。
          console.warn(`[dsh-awake] powercfg 恢复失败：${errorMessage(error)}`)
        }
      },
    }
  },
}
