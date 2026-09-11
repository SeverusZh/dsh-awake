/**
 * 常开防休眠开关（设置页底部）：一键开启后，无论 dsh 是否在执行任务，
 * 服务端都持续值守（host 侧内存状态 + 协调器对账）。
 *
 * - 纯内存状态：不写配置文件，宿主重启即失效（每次用时再开）；
 * - 受控开关：checked 直接来自 data.alwaysOn（轮询/保存后自动同步）；
 * - 模式为「关闭（off）」或平台不受支持时禁用，并提示先选择运行模式；
 * - 切换走 awake.alwaysOn RPC（host 侧拒绝在 off 模式下开启，错误就地展示）。
 */
import { useState } from 'react'
import type { AwakeStatus } from '../../types.js'
import type { AwakeApi } from '../api.js'
import { styles } from './styles.js'
import { ToggleSwitch } from './ToggleSwitch.js'

export interface AlwaysOnToggleProps {
  readonly data: AwakeStatus
  readonly api: AwakeApi
  /** 保存成功后把最新状态同步给外层（不必等 5s 轮询）。 */
  readonly onStatus: (data: AwakeStatus) => void
  readonly t: (key: string) => string
}

export function AlwaysOnToggle({ data, api, onStatus, t }: AlwaysOnToggleProps): React.ReactElement {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 常开需要服务端有可值守的方式；off / 平台不支持时无法常开。
  const unavailable = data.platform === 'unsupported' || data.selected === null
  const disabled = saving || unavailable

  const toggle = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const res = await api.setAlwaysOn(!data.alwaysOn)
      onStatus(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={styles.block}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>🛡 {t('alwaysOnLabel')}</div>
          <div style={styles.muted}>
            {unavailable ? t('alwaysOnOffModeHint') : t('alwaysOnHint')}
          </div>
        </div>
        <ToggleSwitch
          checked={data.alwaysOn}
          disabled={disabled}
          onChange={() => void toggle()}
          labelOn={t('on')}
          labelOff={t('offShort')}
        />
      </div>
      {saving && <div style={{ ...styles.muted, marginTop: 8 }}>{t('saving')}</div>}
      {error !== null && (
        <div style={{ ...styles.error, marginTop: 8 }}>❌ {t('alwaysOnSaveFailed').replace('{message}', error)}</div>
      )}
    </div>
  )
}
