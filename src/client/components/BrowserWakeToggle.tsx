/**
 * 2.3 浏览器防休眠开关（每浏览器状态：localStorage，不进配置文件）。
 * 与 2.4 服务端方式完全独立。
 */
import { useState } from 'react'
import { isWebWakeLockEnabled, setWebWakeLockEnabled, type WakeLockManager } from '../wake-lock.js'
import { styles } from './styles.js'

export interface BrowserWakeToggleProps {
  readonly manager: WakeLockManager
  readonly t: (key: string) => string
}

export function BrowserWakeToggle({ manager, t }: BrowserWakeToggleProps): React.ReactElement {
  const [enabled, setEnabled] = useState<boolean>(() => isWebWakeLockEnabled())
  const unsupported = manager.state === 'unsupported'

  const toggle = (): void => {
    const next = !enabled
    setEnabled(next)
    setWebWakeLockEnabled(next)
    manager.setEnabled(next)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>💤 {t('browserWakeLock')}</div>
        <div style={styles.muted}>{unsupported ? t('browserUnsupported') : t('browserWakeHint')}</div>
      </div>
      <button
        type="button"
        style={{
          minWidth: 52,
          borderRadius: 999,
          border: '1px solid rgba(148, 163, 184, 0.4)',
          padding: '4px 12px',
          fontSize: 12,
          cursor: unsupported ? 'not-allowed' : 'pointer',
          color: 'inherit',
          background: enabled ? 'rgba(34, 197, 94, 0.25)' : 'rgba(148, 163, 184, 0.12)',
          borderColor: enabled ? 'rgba(34, 197, 94, 0.6)' : 'rgba(148, 163, 184, 0.4)',
          ...(unsupported ? styles.disabled : {}),
        }}
        aria-pressed={enabled}
        disabled={unsupported}
        onClick={toggle}
      >
        {enabled ? t('on') : t('offShort')}
      </button>
    </div>
  )
}
