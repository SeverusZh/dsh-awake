/**
 * 设置页数据面路由（host 半）：POST /api/dsh-awake。
 *
 * 用 connection.fetch.register 注册 /api 共享通道上的**精确路由**（官方
 * file-upload / deliverables / session-log-export 同款），而不是
 * connection.rpc.handle——后者注册时会读提供方 fiber 祖先链上的 webServer，
 * 第三方插件（与 webserver 条目平级）在 DSH 0.1.5-rc 起必挂
 * "cannot get property webServer without inject"。
 *
 * 线格式：请求体 `{ method, payload }`，响应体 RpcResult（绕开官方 settings
 * wire 白名单，见 DESIGN.md 3.3）；错误形状对齐 rpcErrorSchema：
 * `{ ok: false, error: { code, message, details } }`；signal.aborted → cancelled。
 */
import { PLUGIN_ID, RPC_ROUTE_PATH } from '../shared/constants.js'
import type { AwakeStatus, RestartResult, RpcError, RpcRequest, RpcResult, SelectResponse, UpdateResult } from '../types.js'
import type { ConnectionService, LoggerLike } from './context.js'
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
  select(mode: string, config: Record<string, unknown>): Promise<SelectResponse>
  setAlwaysOn(enabled: boolean): Promise<AwakeStatus>
}

export interface RpcDeps {
  readonly service: RpcService
  /** DSH Desktop 环境（更新/重启由桌面版管理，端点关闭）。 */
  readonly desktop: boolean
  /** 一键更新助手（不可用时 update 端点报错）。 */
  readonly runUpdate: UpdateHelper | null
  /** 自重启（不可用时 restart 端点报错）。 */
  readonly restart: (() => { helperPid: number | null; error?: string }) | null
  /** 插件 logger（端点失败时记一条 error）。 */
  readonly logger: LoggerLike
}

/** 应答头：JSON + 禁缓存（状态是实时值，代理/浏览器都别缓存）。 */
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } as const

/** 构造 JSON 应答（body 一律是 RpcResult / 请求体错误）。 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/**
 * 注册 POST /api/dsh-awake（/api 共享通道的精确路由，沿用其信任 + 登录栅栏）。
 *
 * @param connection - host 半 connection 服务（调用方保证可用）。
 * @param deps - 端点实现 + 平台能力。
 * @returns 注销函数（卸载 / 重载时由 Connection 的 effect 调用）。
 */
export function installAwakeRpc(connection: ConnectionService, deps: RpcDeps): () => Promise<void> | void {
  const { service, desktop, runUpdate, restart, logger } = deps

  /** 端点分发（与传输无关，便于单测直接调）。 */
  const dispatch = async (endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>> => {
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
      if (endpoint === 'awake.alwaysOn') {
        if (typeof p.enabled !== 'boolean') return fail('bad-request', 'alwaysOn 需要 enabled 布尔字段')
        return ok(await service.setAlwaysOn(p.enabled))
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
      logger.error(`[${PLUGIN_ID}] rpc ${String(endpoint)} 失败：${err instanceof Error ? err.message : String(err)}`)
      return fail('bad-request', err instanceof Error ? err.message : String(err))
    }
  }

  logger.info(`[${PLUGIN_ID}] 数据面路由 POST ${RPC_ROUTE_PATH} 已注册（设置页就绪）`)
  return connection.fetch.register({
    path: RPC_ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request): Promise<Response> => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return json(fail('bad-request', '请求体不是合法 JSON'), 400)
      }
      const envelope = (typeof body === 'object' && body !== null ? body : {}) as Partial<RpcRequest>
      if (typeof envelope.method !== 'string' || envelope.method === '') {
        return json(fail('bad-request', '请求体缺少 method 字段'), 400)
      }
      return json(await dispatch(envelope.method, envelope.payload, request.signal))
    },
  })
}
