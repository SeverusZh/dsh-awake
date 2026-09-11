/**
 * AwakeService.select 试运行（smoke test）测试：
 * 应用后 start→stop 验证方式可用；off / 有任务运行 → test null。
 * 使用 fake ctx（fake settings 服务 + 可派发 session/event 的 on）。
 */
import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { AwakeService } from '../src/host/service.js'
import { registries } from '../src/modes/index.js'
import type { HostContext, LoggerLike, SettingsService } from '../src/host/context.js'

const silentLogger: LoggerLike = { info: () => {}, warn: () => {}, error: () => {} }

const isLinux = process.platform === 'linux'
const hasSystemd = ((): boolean => {
  try {
    execSync('systemd-inhibit --help', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** fake ctx：settings 可读写；on 收集监听器供测试 emit。 */
function makeFakeCtx(initialUser: Record<string, unknown> | undefined): {
  ctx: HostContext
  emitSession(event: { type: string }): void
  getUser(): Record<string, unknown> | undefined
} {
  let user = initialUser
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  let updatedListener: ((ns: unknown) => void) | null = null

  const settings: SettingsService = {
    register: () => {},
    update: async (ns, patch) => {
      user = { ...(user ?? {}), ...patch }
      updatedListener?.(ns)
    },
    replace: async (ns, section) => {
      user = { ...section }
      updatedListener?.(ns)
    },
    get: () => user,
    describe: () => [{ ns: 'dsh-awake', user }],
  }

  const ctx: HostContext = {
    baseUrl: import.meta.dirname + '/../x.js',
    logger: silentLogger,
    effect: () => {},
    on: (event, listener) => {
      ;(listeners[event] ??= []).push(listener)
      return () => {}
    },
    get: () => undefined,
    inject: (services, callback) => {
      if (services.includes('settings')) {
        callback({
          settings,
          on: (event, listener) => {
            if (event === 'settings/updated') updatedListener = listener as (ns: unknown) => void
            return () => {}
          },
        })
      }
    },
  }

  return {
    ctx,
    emitSession: (event) => {
      for (const listener of listeners['session/event'] ?? []) listener({}, event)
    },
    getUser: () => user,
  }
}

const runOnUsable = isLinux && hasSystemd ? describe : describe.skip

runOnUsable('AwakeService.select 试运行', () => {
  it('应用 systemd → test.ok（真实 start→stop 冒烟，不残留）', async () => {
    const { ctx, getUser } = makeFakeCtx(undefined)
    const service = new AwakeService(ctx, {})
    const res = await service.select('systemd', { why: 'dsh-awake-smoke-test' })
    expect(res.status.selected).toBe('systemd')
    expect(res.test?.ok).toBe(true)
    expect(res.test?.description).toContain('systemd-inhibit')
    // 试运行已停止：--list 不应出现 smoke 记录（等待进程清理）
    await new Promise((r) => setTimeout(r, 600))
    expect(execSync('systemd-inhibit --list', { encoding: 'utf8' })).not.toContain('dsh-awake-smoke-test')
    // 配置已写入
    expect(getUser()?.mode).toBe('systemd')
    expect((getUser()?.config as Record<string, unknown>)?.why).toBe('dsh-awake-smoke-test')
  }, 20000)

  it('选 off → test null', async () => {
    const { ctx } = makeFakeCtx(undefined)
    const service = new AwakeService(ctx, {})
    const res = await service.select('off', {})
    expect(res.status.selected).toBeNull()
    expect(res.test).toBeNull()
  })

  it('有任务运行（openTurns>0）→ test null（真实拿锁即测试，不重复试运行）', async () => {
    const { ctx, emitSession } = makeFakeCtx(undefined)
    const service = new AwakeService(ctx, {})
    emitSession({ type: 'turn/start' })
    await new Promise((r) => setTimeout(r, 400)) // 等真实拿锁完成
    const res = await service.select('systemd', {})
    expect(res.status.active).toBe(true)
    expect(res.test).toBeNull()
  }, 15000)

  it('方式不可用 → 已保存但 test.ok=false + 原因（与可用性探测一致）', async () => {
    const { ctx } = makeFakeCtx(undefined)
    const service = new AwakeService(ctx, {})
    const mode = registries.linux.modes['gnome-gsettings']!
    const probe = mode.isAvailable()
    const res = await service.select('gnome-gsettings', {})
    expect(res.status.selected).toBe('gnome-gsettings')
    expect(res.test?.ok).toBe(probe.ok)
    if (!probe.ok) {
      expect(res.test?.reason).toBeTruthy()
    }
  }, 15000)

  it('setAlwaysOn：开启 → 无任务也值守（真实 inhibit）；关闭 → 放锁；不写配置文件', async () => {
    const why = 'dsh-awake-smoke-alwayson'
    const { ctx, getUser } = makeFakeCtx({ version: 2, platform: 'linux', mode: 'systemd', config: { why } })
    const service = new AwakeService(ctx, {})
    // 初始 alwaysOn=false → 不值守。
    expect(service.status().active).toBe(false)

    const on = await service.setAlwaysOn(true)
    expect(on.alwaysOn).toBe(true)
    expect(on.openTurns).toBe(0) // 无任务
    expect(on.active).toBe(true) // 常开值守
    expect(getUser()).not.toHaveProperty('alwaysOn') // 纯内存：settings 不被污染
    await new Promise((r) => setTimeout(r, 600))
    expect(execSync('systemd-inhibit --list', { encoding: 'utf8' })).toContain(why)

    const off = await service.setAlwaysOn(false)
    expect(off.alwaysOn).toBe(false)
    expect(off.active).toBe(false)
    await new Promise((r) => setTimeout(r, 600))
    expect(execSync('systemd-inhibit --list', { encoding: 'utf8' })).not.toContain(why)
  }, 20000)

  it('常开是内存状态：新宿主（新 AwakeService）启动后恢复关闭', async () => {
    const why = 'dsh-awake-smoke-alwayson-reset'
    const user = { version: 2, platform: 'linux', mode: 'systemd', config: { why } }
    const first = new AwakeService(makeFakeCtx(user).ctx, {})
    await first.setAlwaysOn(true)
    expect(first.status().alwaysOn).toBe(true)
    await first.setAlwaysOn(false) // 清理 inhibit，避免污染后续断言

    // 模拟宿主重启：同一份 settings（无 alwaysOn 键），新服务实例默认关闭。
    const second = new AwakeService(makeFakeCtx(user).ctx, {})
    expect(second.status().alwaysOn).toBe(false)
    expect(second.status().active).toBe(false)
    expect(second.status().openTurns).toBe(0)
  }, 15000)

  it('setAlwaysOn(true)：模式为 off → 拒绝并提示', async () => {
    const { ctx } = makeFakeCtx({ version: 2, platform: 'linux', mode: 'off', config: {} })
    const service = new AwakeService(ctx, {})
    await expect(service.setAlwaysOn(true)).rejects.toThrow('请先选择一种方式')
  })
})
