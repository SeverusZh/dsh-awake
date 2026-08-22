/**
 * 设置页数据面（client 半 → host 半的 Connection RPC）。
 * 端点契约见 src/types.ts 与 DESIGN.md 3.3。
 */
import { RPC_CHANNEL } from '../shared/constants.js'
import type { AwakeStatus, RpcResult, SelectRequest, UpdateResult } from '../types.js'
import type { ConnectionService } from './types.js'

/**
 * 语义化版本比较：a > b 返回正数，相等 0，a < b 负数（数字段 + 预发布后缀）。
 * 移植自 dsh-pocket client/api.js（MIT）。
 */
export function compareVersions(a: string | number, b: string | number): number {
  const pa = String(a).replace(/^[vV]/, '').split('.')
  const pb = String(b).replace(/^[vV]/, '').split('.')
  for (let i = 0; i < 3; i++) {
    const x = Number.parseInt(pa[i] ?? '', 10) || 0
    const y = Number.parseInt(pb[i] ?? '', 10) || 0
    if (x !== y) return x - y
  }
  // 数字段相等：无预发布后缀的更新；都有后缀时按段比较（alpha < beta < rc…，
  // 数字段按数值：rc.9 < rc.10）
  const aPre = String(a).replace(/^[vV]/, '').match(/-.*$/)?.[0] ?? ''
  const bPre = String(b).replace(/^[vV]/, '').match(/-.*$/)?.[0] ?? ''
  if (!aPre && !bPre) return 0
  if (!aPre) return 1
  if (!bPre) return -1
  // 逐段比较：数字段按数值、文本段按字典序
  const aParts = aPre.slice(1).split('.')
  const bParts = bPre.slice(1).split('.')
  const len = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < len; i++) {
    const ax = aParts[i] ?? ''
    const bx = bParts[i] ?? ''
    if (ax === bx) continue
    const aNum = /^\d+$/.test(ax)
    const bNum = /^\d+$/.test(bx)
    if (aNum && bNum) return Number(ax) - Number(bx) // 数值比较
    if (aNum) return 1 // 数字段 > 文本段
    if (bNum) return -1
    return ax < bx ? -1 : 1 // 字典序
  }
  return 0
}

/** RPC 封装：统一解信封（!ok → throw）。 */
export function makeRpc(connection: ConnectionService) {
  const call = async <T>(endpoint: string, payload: unknown = {}, signal?: AbortSignal): Promise<T> => {
    const res: RpcResult<unknown> = await connection.rpc.call(RPC_CHANNEL, endpoint, payload, signal)
    if (!res.ok) throw new Error(res.error.message ?? 'RPC failed')
    return res.value as T
  }
  return {
    status: () => call<AwakeStatus>('awake.status', {}),
    refresh: () => call<AwakeStatus>('awake.refresh', {}),
    select: (req: SelectRequest) => call<AwakeStatus>('awake.select', req),
    version: () => call<{ current: string; loaded: string }>('awake.version', {}),
    update: () => call<UpdateResult>('awake.update', {}),
    restart: () => call<{ ok: boolean; hint?: string }>('awake.restart', {}),
  }
}

export type AwakeApi = ReturnType<typeof makeRpc>
