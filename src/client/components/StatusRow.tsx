/**
 * 2.1 状态行：后端连接 + 值守状态 + 刷新按钮。
 */
import type { AwakeStatus } from '../../types.js'
import { styles } from './styles.js'

export interface StatusRowProps {
  /** 加载失败时传 null（后端不可达）。 */
  readonly data: AwakeStatus | null
  readonly loadError: string | null
  readonly refreshing: boolean
  readonly onRefresh: () => void
  readonly t: (key: string) => string
}

/** 值守状态：{ color, text }。 */
function watchState(data: AwakeStatus | null, loadError: string | null, t: (key: string) => string): { color: string; text: string } {
  if (data === null) {
    const suffix = loadError !== null ? `（${loadError}）` : ''
    return { color: '#dc2626', text: `${t('backendFailed')}${suffix}` }
  }
  if (data.platform === 'unsupported') return { color: '#9ca3af', text: t('unsupported') }
  if (data.active && data.effective !== null) {
    const modeName = data.modes.find((m) => m.id === data.effective)?.name ?? data.effective
    return { color: '#22c55e', text: t('watching').replace('{mode}', modeName) }
  }
  if (data.openTurns > 0) return { color: '#f59e0b', text: t('watchFailed') }
  return { color: '#9ca3af', text: data.selected === null ? t('off') : t('idle') }
}

export function StatusRow({ data, loadError, refreshing, onRefresh, t }: StatusRowProps): React.ReactElement {
  const state = watchState(data, loadError, t)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span style={{ ...styles.dot, background: state.color }} />
        <span>{state.text}</span>
      </div>
      <button
        type="button"
        style={{ ...styles.btn, height: 28, padding: '0 12px', ...(refreshing ? styles.disabled : {}) }}
        disabled={refreshing}
        onClick={onRefresh}
      >
        {refreshing ? '…' : `🔄 ${t('refresh')}`}
      </button>
    </div>
  )
}
