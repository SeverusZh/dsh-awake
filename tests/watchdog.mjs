/**
 * 看门狗脚本行为测试（Linux）：
 * 验证 `node -e WATCHDOG_SCRIPT payload` 在 stdin EOF / SIGTERM 时能终止子进程。
 */
import { spawn, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// 从编译产物里提取看门狗脚本与 argv 用法（避免与源码重复维护）。
const shellSrc = readFileSync(join(here, '../lib/types/plans/shell.js'), 'utf8')
const watchdogMatch = shellSrc.match(/const WATCHDOG_SCRIPT = `([\s\S]*?)`;/)
const payloadArgMatch = shellSrc.match(/process\.argv\[(\d)\]/)

if (watchdogMatch === null || payloadArgMatch === null) {
  console.error('无法从编译产物中提取看门狗脚本（先运行 pnpm build）')
  process.exit(1)
}
const WATCHDOG = watchdogMatch[1]
const ARGV_INDEX = Number(payloadArgMatch[1])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pgrep = (needle) => {
  try {
    // 用 -x 精确匹配进程名，避免 -f 匹配到 sh -c 包装进程自身
    const out = execSync(`pgrep -x ${needle}`, { encoding: 'utf8' }).trim()
    return out.length > 0 ? out.split('\n').map(Number) : []
  } catch {
    return []
  }
}

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`)
  if (!ok) failures += 1
}

// —— 场景1：stdin EOF（模拟 dsh 崩溃）→ 子进程被终止
{
  const baseline = pgrep('sleep')
  const watchdog = spawn(process.execPath, ['-e', WATCHDOG, JSON.stringify(['sleep', '300'])], {
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  await sleep(800)
  const after = pgrep('sleep')
  check('场景1 子进程已启动', after.length === baseline.length + 1, `new=${after.filter((x) => !baseline.includes(x))}`)
  // 关闭写端 → EOF
  watchdog.stdin.end()
  await sleep(1000)
  check(
    '场景1 stdin EOF 后看门狗退出',
    watchdog.exitCode !== null || watchdog.signalCode !== null,
    `exit=${watchdog.exitCode}`,
  )
  const remaining = pgrep('sleep')
  check('场景1 子进程已被终止', remaining.length === baseline.length, `extra=${remaining.filter((x) => !baseline.includes(x))}`)
}

// —— 场景2：SIGTERM（模拟 dsh 正常释放）→ 子进程被终止
{
  const baseline = pgrep('sleep')
  const watchdog = spawn(process.execPath, ['-e', WATCHDOG, JSON.stringify(['sleep', '300'])], {
    stdio: ['pipe', 'ignore', 'inherit'],
  })
  await sleep(800)
  watchdog.kill('SIGTERM')
  await sleep(1000)
  check(
    '场景2 SIGTERM 后看门狗退出',
    watchdog.exitCode !== null || watchdog.signalCode !== null,
    `exit=${watchdog.exitCode}`,
  )
  const remaining = pgrep('sleep')
  check('场景2 子进程已被终止', remaining.length === baseline.length, `extra=${remaining.filter((x) => !baseline.includes(x))}`)
}

// —— 场景3：argv 语义与 shell.ts 的读取位置一致（node -e script payload → argv[1]）
{
  const stdout = execSync(`${process.execPath} -e 'console.log(process.argv.join("|"))' hello world`, {
    encoding: 'utf8',
  })
  check('场景3 argv 语义', stdout.trim().split('|').length === 3 && stdout.includes('hello'), stdout.trim())
  check('场景3 shell.ts 使用 argv[1]', ARGV_INDEX === 1, `argv[${ARGV_INDEX}]`)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 个失败`)
process.exit(failures === 0 ? 0 : 1)
