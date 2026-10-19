/**
 * 2.4 方式下拉 + 说明区 + 动态配置表单。
 *
 * - 下拉 = 平台 order（不可用项 disabled + 原因）；顶部「关闭（off）」；
 * - 选中方式的 description 显示在说明区；
 * - 动态表单由方式声明的 fields 驱动（ConfigField 描述符，纯数据不写 TSX）；
 * - 「应用」→ awake.select（host 侧 normalize 后写配置并热对账）。
 *
 * 视觉：与状态行 / 更新卡 / 开关行共用 aw-* 设计体系；表单行左 label 右控件，
 * 窄宽堆叠；反馈行独立于按钮行，不挤压操作。
 */
import { useState } from 'react'
import type { AwakeStatus, ConfigField } from '../../types.js'
import type { AwakeApi } from '../api.js'
import { ToggleSwitch } from './ToggleSwitch.js'

export interface ModeSelectProps {
  readonly data: AwakeStatus
  readonly api: AwakeApi
  /** 保存成功后把最新状态同步给外层（不必等 5s 轮询）。 */
  readonly onStatus: (data: AwakeStatus) => void
  readonly t: (key: string) => string
}

interface Draft {
  readonly mode: string
  readonly config: Record<string, unknown>
}

export function ModeSelect({ data, api, onStatus, t }: ModeSelectProps): React.ReactElement {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; reason?: string; description?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * 下拉当前值 = 配置里选中的方式（draft > selected）；off → 'off'；
   * stale（配置的方式不在当前平台注册表）→ 平台默认（应用时写回当前平台）。
   * 注意：不用 effective——回退是运行时状态，状态行已展示「值守中 · XX」，
   * 下拉必须反映配置本身，否则无法把失效配置改回去。
   */
  const currentMode = ((): string => {
    if (draft !== null) return draft.mode
    const sel = data.selected
    if (sel !== null && data.modes.some((m) => m.id === sel)) return sel
    if (sel === null) return 'off'
    return data.modes.find((m) => m.default)?.id ?? 'off'
  })()

  const selectedMode = data.modes.find((m) => m.id === currentMode)
  const fields = selectedMode?.fields ?? []
  const cfg = draft !== null ? draft.config : data.config

  const changeMode = (mode: string): void => {
    setSaved(false)
    setTestResult(null)
    setError(null)
    // 切回配置的方式 → 表单用已保存的配置；切到别的方式 → 空配置（字段回默认值）。
    const base = mode === data.selected ? data.config : {}
    setDraft((prev) => (prev !== null && prev.mode === mode ? prev : { mode, config: base }))
  }

  const setField = (key: string, value: unknown): void => {
    setSaved(false)
    setTestResult(null)
    setError(null)
    setDraft((prev) => {
      const base = prev !== null ? prev.config : data.config
      return { mode: currentMode, config: { ...base, [key]: value } }
    })
  }

  const apply = async (): Promise<void> => {
    if (draft === null) return
    setSaving(true)
    setError(null)
    setTestResult(null)
    try {
      const res = await api.select({ mode: currentMode, config: currentMode === 'off' ? {} : cfg })
      onStatus(res.status)
      setDraft(null)
      setSaved(true)
      setTestResult(res.test)
      // 反馈持续展示：试运行结果停留更久，让用户看清。
      setTimeout(() => {
        setSaved(false)
        setTestResult(null)
      }, res.test === null ? 2000 : 6000)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="aw-block">
      <p className="aw-heading">{t('modeLabel')}</p>
      <div className="aw-body">
        <select
          className="aw-select"
          value={currentMode}
          onChange={(e) => changeMode(e.target.value)}
        >
          <option value="off">{t('offOption')}</option>
          {data.modes.map((m) => (
            <option key={m.id} value={m.id} disabled={!m.available} title={m.available ? undefined : t('unavailable').replace('{reason}', m.reason ?? '')}>
              {m.name}
              {m.default ? `（${t('defaultBadge')}）` : ''}
              {!m.available ? ` — ${t('unavailable').replace('{reason}', m.reason ?? '')}` : ''}
            </option>
          ))}
        </select>

        {selectedMode !== undefined && (
          <div className="aw-info">
            <span className="aw-info-label">{t('descriptionLabel')}：</span>
            {selectedMode.description}
          </div>
        )}

        {currentMode !== 'off' && fields.length > 0 && (
          <ConfigFieldForm fields={fields} value={cfg} onChange={setField} disabled={saving} t={t} />
        )}

        <div className="aw-actions">
          {/* 按钮行：只放按钮，不被反馈文字挤压 */}
          <button
            type="button"
            className="aw-btn aw-btn-primary"
            disabled={draft === null || saving}
            onClick={() => void apply()}
          >
            {saving ? t('saving') : t('apply')}
          </button>
        </div>
        {/* 反馈行：独立一行，可自由换行，不挤压按钮 */}
        {(saved || testResult !== null || error !== null) && (
          <div className="aw-feedback">
            {saved && testResult === null && <span className="aw-success">✓ {t('saved')}</span>}
            {testResult !== null &&
              (testResult.ok ? (
                <span className="aw-success">✓ {t('savedTestOk')}</span>
              ) : (
                <span className="aw-warn">⚠ {t('savedTestFail').replace('{reason}', testResult.reason ?? '?')}</span>
              ))}
            {error !== null && <span className="aw-error">❌ {t('saveFailed').replace('{message}', error)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 动态配置表单：按 ConfigField 描述符渲染（加类型 = 这里加渲染分支 + types.ts 加一行）。
 * 独立导出以便单测（描述符 → 表单渲染）。
 */
export interface ConfigFieldFormProps {
  readonly fields: readonly ConfigField[]
  /** 当前值（键由方式声明；缺失回字段默认）。 */
  readonly value: Record<string, unknown>
  readonly onChange: (key: string, value: unknown) => void
  readonly disabled: boolean
  readonly t: (key: string) => string
}

export function ConfigFieldForm({ fields, value, onChange, disabled, t }: ConfigFieldFormProps): React.ReactElement {
  return (
    <div className="aw-body">
      {fields.map((field, index) => {
        if (field.type === 'text') {
          return (
            <p key={index} className="aw-hint">
              {field.content}
            </p>
          )
        }
        if (field.type === 'input') {
          const v = stringValue(value[field.key], 'default' in field ? field.default : undefined)
          return (
            <FieldRow key={field.key} title={field.title} hint={field.hint} t={t}>
              <input
                type="text"
                className="aw-input"
                disabled={disabled}
                placeholder={field.placeholder}
                value={v}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            </FieldRow>
          )
        }
        if (field.type === 'textarea') {
          const v = stringValue(value[field.key], 'default' in field ? field.default : undefined)
          return (
            <FieldRow key={field.key} title={field.title} hint={field.hint} t={t}>
              <textarea
                rows={field.rows ?? 3}
                className="aw-textarea"
                disabled={disabled}
                value={v}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            </FieldRow>
          )
        }
        if (field.type === 'boolean') {
          const v = value[field.key] === true || (value[field.key] === undefined && field.default === true)
          return (
            <FieldRow key={field.key} title={field.title} hint={field.hint} t={t}>
              <ToggleSwitch checked={v} disabled={disabled} onChange={() => onChange(field.key, !v)} labelOn={t('on')} labelOff={t('offShort')} />
            </FieldRow>
          )
        }
        if (field.type === 'select') {
          const v = stringValue(value[field.key], field.default)
          return (
            <FieldRow key={field.key} title={field.title} hint={field.hint} t={t}>
              <select className="aw-select" disabled={disabled} value={v} onChange={(e) => onChange(field.key, e.target.value)}>
                {field.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FieldRow>
          )
        }
        // number
        const raw = value[field.key]
        const v = typeof raw === 'number' ? raw : (typeof raw === 'string' ? raw : ('default' in field ? field.default : ''))
        return (
          <FieldRow key={field.key} title={field.title} hint={field.hint} t={t}>
            <input
              type="number"
              className="aw-input"
              disabled={disabled}
              min={field.min}
              max={field.max}
              value={v}
              onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
            />
          </FieldRow>
        )
      })}
    </div>
  )
}

function FieldRow({
  title,
  hint,
  t,
  children,
}: {
  readonly title: string
  readonly hint?: string | undefined
  readonly t: (key: string) => string
  readonly children: React.ReactNode
}): React.ReactElement {
  void t
  return (
    <div className="aw-field">
      <div className="aw-field-text">
        <div className="aw-field-title">{title}</div>
        {hint !== undefined && <div className="aw-hint">{hint}</div>}
      </div>
      <div className="aw-field-control">{children}</div>
    </div>
  )
}

/** 取值：优先当前值，缺失回字段默认。 */
function stringValue(raw: unknown, fallback: string | undefined): string {
  if (typeof raw === 'string') return raw
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return fallback ?? ''
}
