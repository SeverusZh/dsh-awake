/**
 * dsh-awake —— 方式子系统的共享工具（跨实现复用）。
 *
 * 看门狗 / terminate / runCommand / 命令探测，全部平移自 0.1.1 的
 * plans/shell.ts 与 plans/power.ts（抽公共部分）。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'

/**
 * 看门狗脚本（以 `node -e` 运行）。它把真实命令作为自己的子进程启动，然后：
 *   - stdin EOF（dsh 崩溃导致管道断裂，或 dsh 主动关闭）→ SIGTERM 子进程；
 *   - 收到 SIGTERM/SIGINT/SIGHUP（dsh 正常释放）→ SIGTERM 子进程；
 *   - 3 秒后子进程仍未退出 → SIGKILL 兜底；
 *   - 子进程退出后自身以相同退出码退出。
 */
export const WATCHDOG_SCRIPT = `
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
export const WINDOWS_POWERSHELL_SCRIPT = `
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

/** 统一的错误消息提取。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 运行一个命令并返回 stdout（失败抛错）。 */
export function runCommand(command: string, args: readonly string[]): { stdout: string; stderr: string } {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new Error(`执行 ${command} 失败：${String(result.error.message ?? result.error)}`)
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().slice(0, 200)
    throw new Error(`执行 ${command} ${args.join(' ')} 失败（退出码 ${result.status}）${detail === '' ? '' : `：${detail}`}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * 检查一个系统命令是否存在（Windows 的 powershell.exe 恒在）。
 * 同步探测（spawnSync，5s 超时兜底）；结果由调用方缓存。
 */
export function commandAvailable(command: string, probeArgs: readonly string[]): boolean {
  if (process.platform === 'win32' && command === 'powershell.exe') return true
  try {
    const result = spawnSync(command, [...probeArgs], { stdio: 'ignore', timeout: 5000, windowsHide: true })
    return result.error === undefined
  } catch {
    return false
  }
}

/**
 * 启动一个看门狗中间进程运行真实命令。返回看门狗子进程句柄；
 * 启动即失败（node 本身异常）立刻抛错，不留孤儿。
 */
export function spawnWatchdog(command: string, args: readonly string[]): ChildProcess {
  const watchdog = spawn(process.execPath, ['-e', WATCHDOG_SCRIPT, JSON.stringify([command, ...args])], {
    stdio: ['pipe', 'ignore', 'inherit'],
    windowsHide: true,
  })
  if (watchdog.exitCode !== null && watchdog.exitCode !== 0) {
    throw new Error('防休眠看门狗进程启动失败')
  }
  return watchdog
}

/** 终止一个子进程：SIGTERM -> 3 秒后 SIGKILL；等待退出。幂等。 */
export async function terminate(child: ChildProcess): Promise<void> {
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
