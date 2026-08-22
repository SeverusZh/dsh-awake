/**
 * dsh-awake —— macOS 方式：pmset（电源类，回退用）。
 *
 * 临时修改系统电源设置 `pmset -a sleep 0`（从不睡眠），任务结束按各电源
 * 来源（AC/Battery/UPS）恢复原值。
 */

import type { WakeMode } from '../index.js'
import { commandAvailable, errorMessage, runCommand } from '../shared/tools.js'

/** 各电源来源的 pmset 标志。 */
const SOURCE_FLAGS = { ac: '-c', battery: '-b', ups: '-u' } as const

export const pmset: WakeMode = {
  id: 'pmset',
  name: 'pmset',
  description: '临时修改系统电源设置（从不睡眠），任务结束恢复原值；macOS 自带命令。',
  default: false,
  fields: [],
  isAvailable() {
    if (!commandAvailable('pmset', ['-g'])) {
      return { ok: false, reason: '未找到 pmset' }
    }
    return { ok: true }
  },
  async start() {
    // 读取每个电源来源（AC/Battery/UPS）的 sleep 原值（分钟）。
    const { stdout } = runCommand('pmset', ['-g', 'custom'])
    const sources: Array<{ kind: keyof typeof SOURCE_FLAGS; minutes: number }> = []
    const section = /^(AC Power|Battery Power|UPS Power):\s*$/gm
    const sleepLine = /^sleep\s+(\d+)/m
    let match: RegExpExecArray | null
    while ((match = section.exec(stdout)) !== null) {
      const kind = match[1] === 'AC Power' ? 'ac' : match[1] === 'Battery Power' ? 'battery' : 'ups'
      const sectionStart = section.lastIndex
      const next = section.exec(stdout)
      const sectionEnd = next !== null ? next.index : stdout.length
      section.lastIndex = sectionStart
      const body = stdout.slice(sectionStart, sectionEnd)
      const sleep = body.match(sleepLine)
      if (sleep !== null) sources.push({ kind, minutes: Number.parseInt(sleep[1] ?? '0', 10) })
    }
    if (sources.length === 0) {
      throw new Error('无法从 pmset -g custom 解析出任何 sleep 设置')
    }

    // 修改：所有电源来源从不睡眠。
    runCommand('pmset', ['-a', 'sleep', '0'])

    let restored = false
    return {
      description: `darwin · pmset -a sleep 0（原值 ${sources.map((s) => `${s.kind}=${s.minutes}`).join(', ')}）`,
      isActive: () => !restored,
      async stop() {
        if (restored) return
        restored = true
        for (const source of sources) {
          try {
            runCommand('pmset', [SOURCE_FLAGS[source.kind], 'sleep', String(source.minutes)])
          } catch (error) {
            // best-effort：单个来源恢复失败不中断其余来源。
            console.warn(`[dsh-awake] pmset 恢复 ${source.kind} 失败：${errorMessage(error)}`)
          }
        }
      },
    }
  },
}
