/**
 * 2.2 版本更新卡片（移植 dsh-pocket，仅新版时渲染）。
 *
 * - host 暴露 { current, loaded }（current = 磁盘包版本，loaded = 运行中版本）；
 * - client fetch npm registry latest + compareVersions（cache: no-store）+ 周期重查
 *   5 分钟 + 网络失败静默；
 * - 状态机：无新版（不渲染）/ 有新版（提示 + 一键更新）/ 更新中 / 已更新未重启
 *   （「重启生效」按钮）/ 失败（显示输出）；
 * - desktop === true：不渲染（更新由 DSH Desktop 管理）。
 */
import { useEffect, useState } from 'react'
import { NPM_REGISTRY_URL } from '../../shared/constants.js'
import type { AwakeStatus } from '../../types.js'
import type { AwakeApi } from '../api.js'
import { compareVersions } from '../api.js'
import { styles } from './styles.js'

export interface UpdateCardProps {
  readonly data: AwakeStatus
  readonly api: AwakeApi
  readonly t: (key: string) => string
}

/** 更新卡片状态。 */
interface UpdateInfo {
  readonly current: string
  readonly latest: string
  readonly updating: boolean
  readonly restarting: boolean
  readonly startedAt: number | null
  readonly result: 'ok' | 'fail' | null
  readonly updated: boolean
  readonly autoRestart: boolean
  readonly output: string | null
}

export function UpdateCard({ data, api, t }: UpdateCardProps): React.ReactElement | null {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [now, setNow] = useState(Date.now())

  // 每秒 tick，驱动倒计时。
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // 桌面端：更新由 DSH Desktop 管理，不渲染。
  const desktop = data.desktop
  useEffect(() => {
    if (desktop) return
    let alive = true
    const check = async (): Promise<void> => {
      try {
        const v = await api.version()
        const meta = (await (await fetch(NPM_REGISTRY_URL, { cache: 'no-store' })).json()) as { version?: unknown }
        if (!alive) return
        const latest = typeof meta.version === 'string' ? meta.version : null
        if (latest !== null && v.current !== '' && compareVersions(latest, v.current) > 0) {
          setInfo({ current: v.current, latest, updating: false, restarting: false, startedAt: null, result: null, updated: false, autoRestart: false, output: null })
        } else if (v.current !== '' && v.loaded !== '' && compareVersions(v.current, v.loaded) > 0) {
          // 已更新未重启：显示「已更新，重启生效」+ 重启按钮。
          setInfo({ current: v.current, latest: v.current, updating: false, restarting: false, startedAt: null, result: 'ok', updated: true, autoRestart: false, output: null })
        }
      } catch {
        // 网络失败静默
      }
    }
    void check()
    const timer = setInterval(check, 5 * 60 * 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [desktop, api])

  if (desktop || info === null) return null

  const elapsed = (startedAt: number | null): number =>
    startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000))

  // 一键更新：调宿主 dsh plugin update（成功后宿主自动重启生效，用户只点一次）。
  const runUpdate = async (): Promise<void> => {
    setInfo((prev) => (prev === null ? prev : { ...prev, updating: true, result: null, startedAt: Date.now() }))
    try {
      const r = await api.update()
      setInfo((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              updating: false,
              result: r.ok ? 'ok' : 'fail',
              autoRestart: r.autoRestart === true,
              output: r.output ?? r.error ?? null,
            },
      )
    } catch (err) {
      setInfo((prev) => (prev === null ? prev : { ...prev, updating: false, result: 'fail', output: err instanceof Error ? err.message : String(err) }))
    }
  }

  // 重启宿主（更新生效必需：刷新页面不会重载服务端代码）。
  const restartNow = async (): Promise<void> => {
    setInfo((prev) => (prev === null ? prev : { ...prev, restarting: true, startedAt: Date.now() }))
    try {
      // 宿主 500ms 后自杀，RPC 响应可能来不及送达 → 3 秒超时兜底。
      await Promise.race([
        api.restart(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('restart requested (no reply within 3s)')), 3000)),
      ])
      setInfo((prev) => (prev === null ? prev : { ...prev, restarting: true, result: 'ok' }))
    } catch (err) {
      // 网络断连/超时同样视为「已请求重启」——旧进程即将退出，等新进程起来后刷新即可。
      const msg = err instanceof Error ? err.message : String(err)
      if (/connection|socket|fetch|network|abort|cancelled|ECONN|disconnect|closed|timeout/i.test(msg)) {
        setInfo((prev) => (prev === null ? prev : { ...prev, restarting: true, result: 'ok' }))
        return
      }
      setInfo((prev) => (prev === null ? prev : { ...prev, restarting: false, result: 'fail', output: msg }))
    }
  }

  const title = info.updated
    ? t('updatedRestart').replace('{current}', info.current)
    : info.result === 'ok'
      ? (info.autoRestart ? t('updatedAutoRestart').replace('{latest}', info.latest) : t('updatedRestart').replace('{current}', info.latest))
      : t('updateAvailable').replace('{latest}', info.latest).replace('{current}', info.current)

  return (
    <div style={{ ...styles.block, borderLeft: '4px solid var(--dsw-alias-state-warn-primary,#b45309)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
        {info.result !== 'ok' ? (
          <button type="button" style={{ ...styles.primary, height: 28, padding: '0 14px', ...(info.updating ? styles.disabled : {}) }} disabled={info.updating} onClick={() => void runUpdate()}>
            {info.updating ? t('updating') : `${t('updateNow')} v${info.latest}`}
          </button>
        ) : info.autoRestart ? (
          <button type="button" style={{ ...styles.btn, height: 28, ...styles.disabled }} disabled>
            {t('updatedAutoRestart')}
          </button>
        ) : (
          <button type="button" style={{ ...styles.primary, height: 28, padding: '0 14px', ...(info.restarting ? styles.disabled : {}) }} disabled={info.restarting} onClick={() => void restartNow()}>
            {info.restarting ? t('restarting') : `🔄 ${t('restartNow')}`}
          </button>
        )}
      </div>
      <div style={styles.muted}>
        {info.updating
          ? `${t('updating')}（${t('elapsed').replace('{s}', String(elapsed(info.startedAt)))}）`
          : info.restarting
            ? `${t('restarting')}（${t('elapsed').replace('{s}', String(elapsed(info.startedAt)))}）`
            : info.result === 'ok'
              ? (info.autoRestart ? t('updatedAutoRestart') : t('updatedRestart').replace('{current}', info.latest))
              : info.result === 'fail'
                ? `${t('updateFailed').replace('{output}', info.output ?? '?')}（${t('updateManualHint')}）`
                : t('updateDesc').replace('{current}', info.current).replace('{latest}', info.latest)}
      </div>
    </div>
  )
}
