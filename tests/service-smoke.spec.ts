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
})
