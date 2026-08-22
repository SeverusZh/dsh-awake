/**
 * dsh-awake —— Linux 方式：systemd-inhibit（默认）。
 *
 * 通过 systemd-inhibit 阻止系统休眠，需要 systemd 环境（无桌面亦可用）。
 * 以看门狗中间进程运行 `systemd-inhibit --what=sleep:idle --who=dsh-awake
 * --why=<why> sleep infinity`，任务结束 kill 看门狗；dsh 崩溃时管道 EOF
 * 自动终止（见 modes/shared/tools.ts）。
 */

import type { WakeMode } from '../index.js'
import { commandAvailable, spawnWatchdog, terminate } from '../shared/tools.js'

/** systemd-inhibit 的 --why 默认值。 */
const DEFAULT_WHY = 'dsh 任务执行中'

export const systemd: WakeMode = {
  id: 'systemd',
  name: 'systemd-inhibit',
  description: '通过 systemd-inhibit 阻止系统休眠，需要 systemd 环境（无桌面亦可用）。任务结束自动终止。',
  default: true,
  fields: [
    {
      type: 'input',
      key: 'why',
      title: '阻止原因',
      hint: '显示在 systemd-inhibit --list 中',
      default: DEFAULT_WHY,
    },
  ],
  isAvailable() {
    if (!commandAvailable('systemd-inhibit', ['--help'])) {
      return { ok: false, reason: '未找到 systemd-inhibit（非 systemd 系统？）' }
    }
    return { ok: true }
  },
  async start(config) {
    const why = typeof config.why === 'string' && config.why.length > 0 ? config.why : DEFAULT_WHY
    const child = spawnWatchdog('systemd-inhibit', [
      '--what=sleep:idle',
      '--who=dsh-awake',
      `--why=${why}`,
      'sleep',
      'infinity',
    ])
    return {
      description: `linux · systemd-inhibit sleep infinity（why=${why}）`,
      isActive: () => child.exitCode === null && child.signalCode === null,
      stop: () => terminate(child),
    }
  },
}
