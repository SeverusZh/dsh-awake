/**
 * dsh-awake —— 方案 B：系统 shell 命令防休眠。
 *
 * 平台判断后启动一个后台子进程并持有它：
 *   - Linux    systemd-inhibit --what=sleep:idle --who=dsh-awake --why=<why> sleep infinity
 *   - macOS    caffeinate -dimsu
 *   - Windows  PowerShell 常驻进程，循环调用
 *              kernel32.SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
 *
 * 所有平台都通过同一个「看门狗」中间进程运行真实命令：看门狗的标准输入是一根
 * 来自 dsh 进程的管道。任务结束时 dsh 主动杀掉看门狗（并关闭管道）；若 dsh
 * 进程意外崩溃，管道断裂产生 EOF，看门狗会自动终止其子进程并退出，避免系统
 * 被一个孤儿进程永久禁止休眠。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

export type Platform = 'linux' | 'darwin' | 'win32'

/** 当前进程平台；不支持时返回 'unsupported'。 */
export function detectPlatform(): Platform | 'unsupported' {
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

/**
 * 看门狗脚本（以 `node -e` 运行）。它把真实命令作为自己的子进程启动，然后：
 *   - stdin EOF（dsh 崩溃导致管道断裂，或 dsh 主动关闭）→ SIGTERM 子进程；
 *   - 收到 SIGTERM/SIGINT/SIGHUP（dsh 正常释放）→ SIGTERM 子进程；
 *   - 3 秒后子进程仍未退出 → SIGKILL 兜底；
 *   - 子进程退出后自身以相同退出码退出。
 */
const WATCHDOG_SCRIPT = `
const { spawn } = require('node:child_process')
const [cmd, ...args] = JSON.parse(process.argv[1])
const child = spawn(cmd, args, { stdio: 'ignore' })
let done = false
const stop = (signal) => {
  if (done) return
  done = true
  try { child.kill(signal) } catch {}
  setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, 3000).unref()
}
process.stdin.resume()
process.stdin.on('end', () => stop('SIGTERM'))
process.stdin.on('error', () => stop('SIGTERM'))
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => stop(sig))
child.on('error', () => stop('SIGTERM'))
child.on('exit', (code, signal) => { process.exit(code ?? (signal ? 1 : 0)) })
`

/** Windows 常驻脚本：持续声明系统必需运行（ES_CONTINUOUS | ES_SYSTEM_REQUIRED = 0x80000001）。 */
const WINDOWS_POWERSHELL_SCRIPT = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public class DshAwake {
  [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
'@
$flags = 0x80000001  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
[void][DshAwake]::SetThreadExecutionState($flags)
while ($true) {
  Start-Sleep -Seconds 15
  [void][DshAwake]::SetThreadExecutionState($flags)
}
`.trim()

/** 一个已获取的防休眠子进程句柄；release() 幂等，可安全重复调用。 */
export interface ShellInhibit {
  /** 人类可读的说明（用于日志）。 */
  readonly description: string
  /** 终止子进程并等待其退出；幂等。 */
  release(): Promise<void>
}

/** 检查一个系统命令是否存在（Windows 的 powershell.exe 恒在）。 */
function commandAvailable(command: string, probeArgs: string[]): boolean {
  if (process.platform === 'win32') return true
  try {
    const result = spawnSync(command, probeArgs, { stdio: 'ignore', timeout: 5000 })
    return result.error === undefined
  } catch {
    return false
  }
}

/** 终止一个子进程：SIGTERM -> 3 秒后 SIGKILL；等待退出。 */
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  try {
    child.stdin?.end()
  } catch {
    // 管道已关闭，忽略
  }
  try {
    child.kill('SIGTERM')
  } catch {
    // 进程已退出，忽略
  }
  const escalated = new Promise<void>((resolve) => {
    setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 已退出
      }
      resolve()
    }, 3000).unref()
  })
  await Promise.race([exited, escalated])
}

/**
 * 启动平台对应的防休眠子进程。
 * @param why - systemd-inhibit 的 --why 参数（仅 Linux 使用）。
 * @throws 平台不支持或所需命令缺失时抛出带说明的 Error（由调用方降级处理）。
 */
export async function acquireShellInhibit(why: string): Promise<ShellInhibit> {
  const platform = detectPlatform()
  let command: string
  let args: string[]

  if (platform === 'linux') {
    if (!commandAvailable('systemd-inhibit', ['--help'])) {
      throw new Error('未找到 systemd-inhibit（非 systemd 系统？），方案B不可用')
    }
    command = 'systemd-inhibit'
    args = ['--what=sleep:idle', '--who=dsh-awake', `--why=${why}`, 'sleep', 'infinity']
  } else if (platform === 'darwin') {
    if (!commandAvailable('caffeinate', ['-h'])) {
      throw new Error('未找到 caffeinate，方案B不可用')
    }
    command = 'caffeinate'
    args = ['-dimsu']
  } else if (platform === 'win32') {
    command = 'powershell.exe'
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_POWERSHELL_SCRIPT]
  } else {
    throw new Error(`平台 ${process.platform} 不受支持（方案B不可用）`)
  }

  const watchdog = spawn(process.execPath, ['-e', WATCHDOG_SCRIPT, JSON.stringify([command, ...args])], {
    stdio: ['pipe', 'ignore', 'inherit'],
    windowsHide: true,
  })

  // 启动即失败（node 本身异常）——立刻报错，不留孤儿。
  if (watchdog.exitCode !== null && watchdog.exitCode !== 0) {
    throw new Error('防休眠看门狗进程启动失败')
  }

  return {
    description: `${platform} · ${command} ${args.join(' ')}`.slice(0, 160),
    release: () => terminate(watchdog),
  }
}
