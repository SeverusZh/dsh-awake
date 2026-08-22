/**
 * 2.3 浏览器防休眠开关（每浏览器状态：localStorage，不进配置文件）。
 * 与 2.4 服务端方式完全独立。开关样式对齐 win-mgr ToggleSwitch。
 */
import { useState } from 'react'
import { isWebWakeLockEnabled, setWebWakeLockEnabled, type WakeLockManager } from '../wake-lock.js'
import { styles } from './styles.js'
import { ToggleSwitch } from './ToggleSwitch.js'

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
      <ToggleSwitch checked={enabled} disabled={unsupported} onChange={toggle} labelOn={t('on')} labelOff={t('offShort')} />
    </div>
  )
}
