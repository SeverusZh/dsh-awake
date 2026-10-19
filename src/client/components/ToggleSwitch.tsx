/**
 * 开关滑块（对齐 DSH 官方设计令牌：轨道 36×20、圆角 999、开态 brand-primary、
 * 滑块 switch-thumb + 轻阴影；hover / focus-visible 等交互态由 styles.ts 注入的
 * .aw-switch-* 规则表达）。纯受控组件，状态由父级持有，role / aria 保持原样。
 */
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
  return (
    <label className="aw-switch">
      <input
        type="checkbox"
        className="aw-switch-input"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={checked ? labelOn : labelOff}
      />
      <span className="aw-switch-track" title={checked ? labelOn : labelOff}>
        <span className="aw-switch-thumb" />
      </span>
    </label>
  )
}
