/**
 * dsh-awake —— macOS 方式：caffeinate（默认）。
 *
 * 通过 `caffeinate -dimsu` 阻止系统休眠（含显示器/磁盘/空闲休眠）。
 * 以看门狗中间进程运行，任务结束 kill；dsh 崩溃时管道 EOF 自动终止。
 */

import type { WakeMode } from '../index.js'
import { commandAvailable, spawnWatchdog, terminate } from '../shared/tools.js'

export const caffeinate: WakeMode = {
  id: 'caffeinate',
  name: 'caffeinate',
  description: '通过 caffeinate -dimsu 阻止系统休眠（含显示器/磁盘），macOS 自带命令。任务结束自动终止。',
  default: true,
  fields: [],
  isAvailable() {
    if (!commandAvailable('caffeinate', ['-h'])) {
      return { ok: false, reason: '未找到 caffeinate' }
    }
    return { ok: true }
  },
  async start() {
    const child = spawnWatchdog('caffeinate', ['-dimsu'])
    return {
      description: 'darwin · caffeinate -dimsu',
      isActive: () => child.exitCode === null && child.signalCode === null,
      stop: () => terminate(child),
    }
  },
}
