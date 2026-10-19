/**
 * 2.1 状态行：值守状态（语义色圆点 + 文案）+ 刷新按钮。
 * 圆点颜色按状态映射到官方状态色 class，亮暗主题自动成立。
 */
import type { AwakeStatus } from '../../types.js'

export interface StatusRowProps {
  /** 加载失败时传 null（后端不可达）。 */
  readonly data: AwakeStatus | null
  readonly loadError: string | null
  readonly refreshing: boolean
  readonly onRefresh: () => void
  readonly t: (key: string) => string
}

/** 状态色调：ok（值守中）/ warn（有任务但未值守）/ error（后端不可达）/ idle（其余）。 */
type Tone = 'ok' | 'warn' | 'error' | 'idle'

/** 值守状态：{ tone, text }。 */
function watchState(data: AwakeStatus | null, loadError: string | null, t: (key: string) => string): { tone: Tone; text: string } {
  if (data === null) {
    const suffix = loadError !== null ? `（${loadError}）` : ''
    return { tone: 'error', text: `${t('backendFailed')}${suffix}` }
  }
  if (data.platform === 'unsupported') return { tone: 'idle', text: t('unsupported') }
  if (data.active && data.effective !== null) {
    const modeName = data.modes.find((m) => m.id === data.effective)?.name ?? data.effective
    return { tone: 'ok', text: t('watching').replace('{mode}', modeName) }
  }
  if (data.openTurns > 0) return { tone: 'warn', text: t('watchFailed') }
  return { tone: 'idle', text: data.selected === null ? t('off') : t('idle') }
}

export function StatusRow({ data, loadError, refreshing, onRefresh, t }: StatusRowProps): React.ReactElement {
  const state = watchState(data, loadError, t)
  return (
    <div className="aw-status">
      <div className="aw-status-main">
        <span className={`aw-dot aw-dot-${state.tone}`} />
        <span className="aw-status-text">{state.text}</span>
      </div>
      <button type="button" className="aw-btn aw-btn-secondary aw-btn-sm" disabled={refreshing} onClick={onRefresh}>
        {refreshing ? '…' : `🔄 ${t('refresh')}`}
      </button>
    </div>
  )
}
