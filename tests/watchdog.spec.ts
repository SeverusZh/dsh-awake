/**
 * 看门狗脚本行为测试（Linux）：验证 `node -e WATCHDOG_SCRIPT payload` 在
 * stdin EOF / SIGTERM 时能终止子进程（原 tests/watchdog.mjs 移植到 vitest）。
 * 非 Linux 平台跳过（依赖 pgrep 与 sleep 进程）。
 */
import { execSync, spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { WATCHDOG_SCRIPT } from '../src/modes/shared/tools.js'

const isLinux = process.platform === 'linux'
const runOnLinux = isLinux ? describe : describe.skip

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function pgrep(needle: string): number[] {
  try {
    const out = execSync(`pgrep -x ${needle}`, { encoding: 'utf8' }).trim()
    return out.length > 0 ? out.split('\n').map(Number) : []
  } catch {
    return []
  }
}

runOnLinux('看门狗脚本（Linux）', () => {
  it('场景1：stdin EOF（模拟 dsh 崩溃）→ 子进程被终止', async () => {
    const baseline = pgrep('sleep')
    const watchdog = spawn(process.execPath, ['-e', WATCHDOG_SCRIPT, JSON.stringify(['sleep', '300'])], {
      stdio: ['pipe', 'ignore', 'inherit'],
    })
    await sleep(800)
    const after = pgrep('sleep')
    expect(after.length).toBe(baseline.length + 1)
    // 关闭写端 → EOF
    watchdog.stdin?.end()
    await sleep(1000)
    expect(watchdog.exitCode !== null || watchdog.signalCode !== null).toBe(true)
    const remaining = pgrep('sleep')
    expect(remaining.length).toBe(baseline.length)
  }, 20000)

  it('场景2：SIGTERM（模拟 dsh 正常释放）→ 子进程被终止', async () => {
    const baseline = pgrep('sleep')
    const watchdog = spawn(process.execPath, ['-e', WATCHDOG_SCRIPT, JSON.stringify(['sleep', '300'])], {
      stdio: ['pipe', 'ignore', 'inherit'],
    })
    await sleep(800)
    watchdog.kill('SIGTERM')
    await sleep(1000)
    expect(watchdog.exitCode !== null || watchdog.signalCode !== null).toBe(true)
    const remaining = pgrep('sleep')
    expect(remaining.length).toBe(baseline.length)
  }, 20000)

  it('场景3：argv 语义与 spawnWatchdog 的读取位置一致（argv[1]）', () => {
    const stdout = execSync(`${process.execPath} -e 'console.log(process.argv.join("|"))' hello world`, {
      encoding: 'utf8',
    })
    expect(stdout.trim().split('|')).toHaveLength(3)
    expect(stdout).toContain('hello')
  })
})
