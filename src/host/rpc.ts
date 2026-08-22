/**
 * /dsh-awake RPC 通道（host 半）：设置页数据面。
 *
 * 走 ctx.connection.rpc（绕开官方 settings wire 白名单，见 DESIGN.md 3.3），
 * 不碰 webServer。错误形状对齐 dsh-pocket rpcErrorSchema：
 * `{ ok: false, error: { code, message, details } }`；signal.aborted → cancelled。
 */
import { PLUGIN_ID, RPC_CHANNEL } from '../shared/constants.js'
import type { AwakeStatus, RestartResult, RpcError, RpcResult, UpdateResult } from '../types.js'
import type { ConnectionService, HostContext } from './context.js'
import { dshPortFromArgs, restartLaunch } from './restart.js'
import type { UpdateHelper } from './update.js'
import { versionInfo } from './version.js'

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

/** 构造符合 DSH rpcErrorSchema 的错误（details 必填）。 */
function fail(code: RpcError['code'], message: string): RpcResult<never> {
  if (code === 'cancelled') {
    return { ok: false, error: { code: 'cancelled', message, details: {} } }
  }
  // 其余一律归入 bad-request（issues 是自由数组）。
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [{ message }] } } }
}

/** 各平台停止 dsh web 进程的命令（Windows 没有 lsof/kill）。 */
function killHint(port: number): string {
  if (process.platform === 'win32') {
    return `netstat -ano | findstr :${port}（找 LISTENING 的 PID）→ taskkill /PID <PID> /F`
  }
  return `lsof -ti :${port} | xargs kill -9`
}

/** RPC 层依赖的服务面（AwakeService 实现）。 */
export interface RpcService {
  status(): AwakeStatus
  refresh(): AwakeStatus
  select(mode: string, config: Record<string, unknown>): Promise<AwakeStatus>
}

export interface RpcDeps {
  readonly service: RpcService
  /** DSH Desktop 环境（更新/重启由桌面版管理，端点关闭）。 */
  readonly desktop: boolean
  /** 一键更新助手（不可用时 update 端点报错）。 */
  readonly runUpdate: UpdateHelper | null
  /** 自重启（不可用时 restart 端点报错）。 */
  readonly restart: (() => { helperPid: number | null; error?: string }) | null
}

/** 注册 /dsh-awake 逻辑通道（仅本机 loopback 可调）。 */
export function installAwakeRpc(ctx: HostContext, deps: RpcDeps): () => Promise<void> | void {
  // 注意：connection 未在 inject 声明，必须用 ctx.get()（属性访问会抛
  // "cannot get property without inject"）；缺失 = 设置页数据面停用。
  const connection = ctx.get<ConnectionService>('connection')
  if (connection?.rpc?.handle === undefined) {
    ctx.logger.warn(`[${PLUGIN_ID}] Connection RPC 不可用，设置页数据面停用（服务端照常值守）`)
    return () => {}
  }
  const { service, desktop, runUpdate, restart } = deps

  return connection.rpc.handle(
    RPC_CHANNEL,
    async (endpoint, payload = {}, signal) => {
      if (signal?.aborted) return fail('cancelled', 'The request was cancelled.')
      const p = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
      try {
        if (endpoint === 'awake.status') {
          return ok(service.status())
        }
        if (endpoint === 'awake.refresh') {
          // 失效可用性缓存重新探测。
          return ok(service.refresh())
        }
        if (endpoint === 'awake.select') {
          if (typeof p.mode !== 'string') return fail('bad-request', 'select 需要 mode 字段')
          const config =
            typeof p.config === 'object' && p.config !== null ? (p.config as Record<string, unknown>) : {}
          return ok(await service.select(p.mode, config))
        }
        if (endpoint === 'awake.version') {
          return ok(versionInfo())
        }
        if (endpoint === 'awake.update') {
          // 桌面端：更新由 DSH Desktop 管理，这里关闭（不删除，仅禁用）。
          if (desktop) return fail('bad-request', '桌面版更新由 DSH Desktop 管理，已在此环境停用')
          if (runUpdate === null) return fail('bad-request', '更新不可用')
          const result = await runUpdate.perform(typeof p.profile === 'string' ? p.profile : undefined)
          const outcome: UpdateResult = { ok: result.ok }
          if (result.output !== undefined) outcome.output = result.output
          if (result.error !== undefined) outcome.error = result.error
          // 更新成功 → 自动重启生效（用户只点一次；helper 拉起失败则保持现状，可手动重启）。
          if (result.ok && restart !== null) {
            outcome.autoRestart = restart().helperPid !== null
          }
          return ok(outcome)
        }
        if (endpoint === 'awake.restart') {
          // 桌面端：重启由 DSH Desktop 管理，这里关闭。
          if (desktop) return fail('bad-request', '桌面版重启由 DSH Desktop 管理，已在此环境停用')
          if (restart === null) return fail('bad-request', '重启不可用')
          const result = restart()
          // 重启拉起失败（helper 都没 spawn 出来）→ 如实报错，别让 UI 误报成功。
          if (result.helperPid === null) {
            return fail('bad-request', `重启失败：${result.error ?? '未知'}`)
          }
          const port = dshPortFromArgs(restartLaunch().args)
          const resp: RestartResult = {
            ok: true,
            helperPid: result.helperPid,
            hint: `重启后进程在后台运行；如需停止：${killHint(port)}`,
          }
          return ok(resp)
        }
        return fail('bad-request', `Unknown endpoint: ${endpoint}`)
      } catch (err) {
        ctx.logger.error(`[${PLUGIN_ID}] rpc ${String(endpoint)} 失败：${err instanceof Error ? err.message : String(err)}`)
        return fail('bad-request', err instanceof Error ? err.message : String(err))
      }
    },
    { authority: 'loopback' },
  )
}
