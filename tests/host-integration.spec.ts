/**
 * host 集成测试（Linux）：真实 cordis Context 挂载插件，模拟 session/event 的
 * turn/start / turn/end，验证 systemd-inhibit --list 在任务期间出现测试记录、
 * 结束后消失；嵌套 turn 引用计数；插件卸载无条件放锁。
 * 非 Linux 或非 systemd 环境跳过。
 */
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../src/index.js'
import { RPC_ROUTE_PATH } from '../src/shared/constants.js'
import type { ConnectionFetchRoute } from '../src/host/context.js'

const TEST_WHY = 'dsh-awake-vitest-e2e'

function hasSystemdInhibit(): boolean {
  try {
    execSync('systemd-inhibit --help', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const isLinux = process.platform === 'linux'
const usable = isLinux && hasSystemdInhibit()
const runOnUsable = usable ? describe : describe.skip

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const inhibitList = (): string => {
  try {
    return execSync('systemd-inhibit --list', { encoding: 'utf8' })
  } catch {
    return ''
  }
}

runOnUsable('host 半集成（真实 cordis Context + systemd-inhibit）', () => {
  /**
   * 插件不再声明必需服务（web 专属的 connection 走 ctx.inject 可选等待），
   * 测试里提供 fake connection.fetch 捕获精确路由，模拟真实浏览器数据面调用。
   */
  function boot(
    ctx: Context,
    onRoute?: (route: ConnectionFetchRoute) => void,
    config: Record<string, unknown> = {},
  ): Promise<unknown> {
    ctx.provide('connection', {
      fetch: {
        register: (route: ConnectionFetchRoute) => {
          onRoute?.(route)
          return () => {}
        },
      },
    })
    return ctx.plugin(plugin, {
      version: 2,
      platform: 'linux',
      mode: 'systemd',
      config: { why: TEST_WHY },
      ...config,
    })
  }

  /** 走真实线格式调一个端点：POST { method, payload } → RpcResult。 */
  async function callRpc(
    route: ConnectionFetchRoute,
    method: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const request = new Request(`http://127.0.0.1:3080${RPC_ROUTE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, payload }),
      ...(signal === undefined ? {} : { signal }),
    })
    const response = await route.fetch(request)
    return response.json()
  }

  it('turn/start 拿锁 → turn/end 放锁；嵌套 turn 引用计数；卸载无条件放锁', async () => {
    const ctx = new Context()
    const fiber = await boot(ctx)
    const session = {}

    // —— turn/start 0→1 拿锁 ——
    ctx.emit('session/event', session, { type: 'turn/start', turn: 1 })
    await sleep(1500)
    expect(inhibitList()).toContain(TEST_WHY)

    // —— 嵌套 turn（子代理）：2 个 turn 同时打开，记录仍在 ——
    ctx.emit('session/event', session, { type: 'turn/start', turn: 2 })
    await sleep(600)
    expect(inhibitList()).toContain(TEST_WHY)

    // —— 子代理结束：引用计数 2→1，仍持有 ——
    ctx.emit('session/event', session, { type: 'turn/end', turn: 2, reason: 'completed' })
    await sleep(600)
    expect(inhibitList()).toContain(TEST_WHY)

    // —— 主任务结束：1→0 放锁 ——
    ctx.emit('session/event', session, { type: 'turn/end', turn: 1, reason: 'completed' })
    await sleep(1500)
    expect(inhibitList()).not.toContain(TEST_WHY)

    // —— 出错/中断也应释放 ——
    ctx.emit('session/event', session, { type: 'turn/start', turn: 3 })
    await sleep(800)
    expect(inhibitList()).toContain(TEST_WHY)
    ctx.emit('session/event', session, { type: 'turn/end', turn: 3, reason: 'error' })
    await sleep(1500)
    expect(inhibitList()).not.toContain(TEST_WHY)

    // —— 插件卸载 → 无条件放锁 ——
    ctx.emit('session/event', session, { type: 'turn/start', turn: 4 })
    await sleep(800)
    expect(inhibitList()).toContain(TEST_WHY)
    await fiber.dispose()
    await sleep(1000)
    expect(inhibitList()).not.toContain(TEST_WHY)
  }, 30000)

  it('配置 off → 不值守（无 systemd-inhibit 记录）', async () => {
    const ctx = new Context()
    const fiber = await boot(ctx, undefined, { mode: 'off', config: {} })
    const session = {}
    ctx.emit('session/event', session, { type: 'turn/start', turn: 1 })
    await sleep(800)
    expect(inhibitList()).not.toContain(TEST_WHY)
    await fiber.dispose()
  }, 15000)

  it('常开防休眠（awake.alwaysOn）→ 无任何任务也拿锁；任务结束仍保持；关闭后放锁', async () => {
    const ctx = new Context()
    let route: ConnectionFetchRoute | null = null
    const fiber = await boot(ctx, (r) => {
      route = r
    })
    const session = {}

    // 初始：未开启常开 → 无 inhibit 记录。
    await sleep(800)
    expect(inhibitList()).not.toContain(TEST_WHY)

    // 开启常开（走真实数据面路由）→ 未派发任何 turn/start 也应出现记录。
    const on = (await callRpc(route!, 'awake.alwaysOn', { enabled: true })) as {
      ok: true
      value: { alwaysOn: boolean; active: boolean; openTurns: number }
    }
    expect(on.ok).toBe(true)
    expect(on.value.alwaysOn).toBe(true)
    expect(on.value.active).toBe(true)
    expect(on.value.openTurns).toBe(0)
    await sleep(1200)
    expect(inhibitList()).toContain(TEST_WHY)

    // 任务结束后常开仍保持：turn/start → turn/end 全程记录在列。
    ctx.emit('session/event', session, { type: 'turn/start', turn: 1 })
    await sleep(800)
    ctx.emit('session/event', session, { type: 'turn/end', turn: 1, reason: 'completed' })
    await sleep(800)
    expect(inhibitList()).toContain(TEST_WHY)

    // 关闭常开 → 无任务时放锁。
    await callRpc(route!, 'awake.alwaysOn', { enabled: false })
    await sleep(1200)
    expect(inhibitList()).not.toContain(TEST_WHY)

    // 卸载 → 无条件放锁（幂等）。
    await fiber.dispose()
    await sleep(1000)
    expect(inhibitList()).not.toContain(TEST_WHY)
  }, 30000)
})
