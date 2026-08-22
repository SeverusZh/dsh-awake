/**
 * dsh-awake —— Windows 方式：PowerShell（默认）。
 *
 * 常驻 PowerShell 进程循环调用 kernel32.SetThreadExecutionState
 * （ES_CONTINUOUS | ES_SYSTEM_REQUIRED）阻止系统休眠。
 * 以看门狗中间进程运行，任务结束 kill；dsh 崩溃时管道 EOF 自动终止。
 */

import type { WakeMode } from '../index.js'
import { spawnWatchdog, terminate, WINDOWS_POWERSHELL_SCRIPT } from '../shared/tools.js'

export const powershell: WakeMode = {
  id: 'powershell',
  name: 'PowerShell',
  description: '常驻 PowerShell 调用 SetThreadExecutionState 阻止系统休眠；Windows 自带，无需额外安装。任务结束自动终止。',
  default: true,
  fields: [],
  isAvailable() {
    // powershell.exe 在 Windows 恒在。
    return { ok: true }
  },
  async start() {
    const child = spawnWatchdog('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      WINDOWS_POWERSHELL_SCRIPT,
    ])
    return {
      description: 'win32 · powershell SetThreadExecutionState(ES_SYSTEM_REQUIRED)',
      isActive: () => child.exitCode === null && child.signalCode === null,
      stop: () => terminate(child),
    }
  },
}
