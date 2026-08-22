/**
 * 开关滑块（对齐 dsh-win-mgr ToggleSwitch 的轨道滑块样式，inline styles 实现）。
 * 纯受控组件，状态由父级持有。
 */
import type { CSSProperties } from 'react'

export interface ToggleSwitchProps {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: () => void
  /** 开状态的 a11y 文案。 */
  readonly labelOn: string
  /** 关状态的 a11y 文案。 */
  readonly labelOff: string
}

export function ToggleSwitch({ checked, disabled = false, onChange, labelOn, labelOff }: ToggleSwitchProps): React.ReactElement {
  const track: CSSProperties = {
    width: 36,
    height: 20,
    borderRadius: 999,
    background: checked ? 'var(--dsw-alias-state-success-primary,#16a34a)' : 'var(--dsw-alias-border-l2,#d1d5db)',
    transition: 'background 0.15s ease',
    display: 'flex',
    alignItems: 'center',
    padding: 2,
    boxSizing: 'border-box',
  }
  const thumb: CSSProperties = {
    width: 16,
    height: 16,
    borderRadius: '50%',
    background: '#fff',
    transition: 'transform 0.15s ease',
    transform: checked ? 'translateX(16px)' : 'translateX(0)',
  }
  return (
    <label
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={checked ? labelOn : labelOff}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
      />
      <span style={track} title={checked ? labelOn : labelOff}>
        <span style={thumb} />
      </span>
    </label>
  )
}
