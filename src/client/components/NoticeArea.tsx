/**
 * 2.2 提示区：stale（黄）/ 回退（黄）/ 全失败（红）。
 *
 * 规则（DESIGN.md 4.2）：
 *   - stale → 黄（配置来自其他平台 / 方式失效）；
 *   - attempts 有失败但 effective 非 null → 黄（「首选失败，当前生效 XX」）；
 *   - effective === null && attempts 全失败 → 红（列每个原因）；
 *   - 用户选 off → 不提示；
 *   - 无任务运行（openTurns=0 且未值守）时不展示拿锁结果，避免残留噪音。
 */
import type { AwakeStatus } from '../../types.js'
import { styles } from './styles.js'

export interface NoticeAreaProps {
  readonly data: AwakeStatus
  readonly t: (key: string) => string
}

export function NoticeArea({ data, t }: NoticeAreaProps): React.ReactElement | null {
  // 用户选 off → 不提示。
  if (data.selected === null) return null

  // stale：黄（无论是否在值守）。
  if (data.stale) {
    const text =
      data.configured.platform !== null && data.configured.platform !== data.platform
        ? t('staleFromPlatform')
            .replace('{from}', data.configured.platform)
            .replace('{to}', data.platform)
            .replace('{mode}', defaultModeName(data))
        : t('staleModeMissing')
            .replace('{mode}', data.configured.mode ?? '?')
            .replace('{default}', defaultModeName(data))
    return (
      <div style={{ ...noticeBox, borderLeftColor: '#b45309', background: 'rgba(180, 83, 9, 0.08)' }}>
        <span style={{ color: 'var(--dsw-alias-state-warn-primary,#b45309)' }}>⚠ {text}</span>
      </div>
    )
  }

  // 拿锁结果：只在「有任务运行或刚运行过」时展示。
  if (data.openTurns <= 0 && !data.active) return null
  const attempts = data.attempts
  if (attempts.length === 0) return null
  const failures = attempts.filter((a) => !a.ok)
  const success = attempts.find((a) => a.ok)

  if (data.effective !== null && failures.length > 0 && success !== undefined) {
    // 黄：首选失败，当前生效 XX。
    const modeName = data.modes.find((m) => m.id === data.effective)?.name ?? data.effective
    const reason = failures.map((f) => f.reason ?? f.id).join('；')
    return (
      <div style={{ ...noticeBox, borderLeftColor: '#b45309', background: 'rgba(180, 83, 9, 0.08)' }}>
        <span style={{ color: 'var(--dsw-alias-state-warn-primary,#b45309)' }}>
          ⚠ {t('fallbackActive').replace('{mode}', modeName)}
        </span>
        <div style={styles.muted}>{t('fallbackReason').replace('{reason}', reason)}</div>
      </div>
    )
  }

  if (data.effective === null && failures.length === attempts.length) {
    // 红：全部失败，列每个原因。
    return (
      <div style={{ ...noticeBox, borderLeftColor: '#dc2626', background: 'rgba(220, 38, 38, 0.08)' }}>
        <span style={{ color: 'var(--dsw-alias-state-error-primary,#dc2626)' }}>❌ {t('allFailed')}</span>
        {attempts.map((a) => (
          <div key={a.id} style={{ color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, lineHeight: 1.5 }}>
            {a.id}
            {a.reason !== undefined ? `：${a.reason}` : ''}
          </div>
        ))}
      </div>
    )
  }

  return null
}

const noticeBox: React.CSSProperties = {
  borderLeft: '4px solid',
  borderRadius: 8,
  marginTop: 12,
  padding: '10px 12px',
  fontSize: 12,
  lineHeight: 1.6,
}

/** 当前平台默认方式名（提示文案用）。 */
function defaultModeName(data: AwakeStatus): string {
  const def = data.modes.find((m) => m.default)
  return def?.name ?? def?.id ?? '?'
}
