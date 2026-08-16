/**
 * node 半集成测试（Linux）：
 * 用真实 cordis Context 挂载插件，模拟 session/event 的 turn/start / turn/end，
 * 验证 systemd-inhibit --list 在任务期间出现 dsh-awake 记录、结束后消失。
 */
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

const { Context } = require('@deepseek-ai/cordis')
const plugin = require(join(here, '../lib/index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`)
  if (!ok) failures += 1
}

const inhibitList = () => {
  try {
    return execSync('systemd-inhibit --list', { encoding: 'utf8' })
  } catch {
    return ''
  }
}
// 用测试专属的 why 字符串自标识，避免与运行中 GUI 持有的 dsh-awake 记录混淆
const TEST_WHY = 'dsh-awake-e2e'
const hasAwake = (text) => text.includes(TEST_WHY)

const ctx = new Context()
const session = {} // 监听器不使用 session 内容

const config = {
  enabled: true,
  shellWakeLock: true,
  powerCfgWakeLock: false,
  webWakeLock: true,
  why: TEST_WHY,
}

const fiber = await ctx.plugin(plugin, config)
await sleep(300)

// 初始：无任务 → 不应有 inhibit 记录
check('初始无任务时无 inhibit', !hasAwake(inhibitList()))

// 任务开始
ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 1 } })
await sleep(1200)
const during = inhibitList()
check('任务期间 systemd-inhibit 出现 dsh-awake', hasAwake(during))
console.log('  --- inhibit 输出片段 ---')
console.log(during.split('\n').filter((l) => l.includes(TEST_WHY)).join('\n') || during.slice(0, 400))
console.log('  -----------------------')

// 子代理同时运行（嵌套计数不应提前放锁）
ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 2 } })
await sleep(600)
check('嵌套任务期间仍持有 inhibit', hasAwake(inhibitList()))

// 子代理结束
ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
await sleep(600)
check('子代理结束后仍持有 inhibit', hasAwake(inhibitList()))

// 主任务结束
ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await sleep(1200)
const after = inhibitList()
check('任务结束后 inhibit 消失', !hasAwake(after))

// 出错 / 中断也应释放
ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 3 } })
await sleep(800)
check('错误场景任务期间持有 inhibit', hasAwake(inhibitList()))
ctx.emit('session/event', session, { type: 'turn/end', data: { turn: 3, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } })
await sleep(1000)
check('出错结束后 inhibit 消失', !hasAwake(inhibitList()))

// 插件卸载 → 无条件放锁
ctx.emit('session/event', session, { type: 'turn/start', data: { turn: 4 } })
await sleep(800)
check('卸载前持有 inhibit', hasAwake(inhibitList()))
await fiber.dispose()
await sleep(800)
check('插件卸载后 inhibit 消失', !hasAwake(inhibitList()))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 个失败`)
process.exit(failures === 0 ? 0 : 1)
