/**
 * dsh-awake —— 「插件」设置页里的守夜人卡片（settings.plugin.item 列表槽条目）。
 *
 * 卡片只操作 `dsh-awake` 设置命名空间：暂存修改、保存时逐字段写入
 * （scope.set / scope.unset），改动经 Host 持久化到 $DSH_HOME/settings.yaml
 * 并热生效（服务端重新对账、web 端 Wake Lock 驱动实时跟随）。
 *
 * 刻意不引入 dsh-client-ui-settings-plugins 的卡片组件：客户端 bundle 只能
 * 依赖 shell 冻结模块表中的包，卡片外壳与控件为自包含实现。
 */

import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { WakeConfig } from '../config.ts'

/** 卡片注入面：通过 register 的 inject face 注入给组件。 */
export interface AwakeCardInjected {
  /** 绑定到 dsh-awake 命名空间的设置 scope。 */
  scope: SettingsScope<WakeConfig>
}

/** 布尔开关的字段定义。 */
interface ToggleFieldDef {
  key: 'enabled' | 'shellWakeLock' | 'powerCfgWakeLock' | 'webWakeLock'
  label: string
  hint: string
}

const TOGGLE_FIELDS: ToggleFieldDef[] = [
  { key: 'enabled', label: '总开关', hint: '关闭后所有防休眠方案（A/B/C）都不生效。' },
  { key: 'shellWakeLock', label: '方案B · 系统命令', hint: 'systemd-inhibit / caffeinate / PowerShell 后台进程，任务结束自动终止。' },
  { key: 'powerCfgWakeLock', label: '方案C · 电源设置（默认关）', hint: '临时修改系统电源策略，结束时恢复原值；需要相应系统权限。' },
  { key: 'webWakeLock', label: '方案A · 浏览器 Wake Lock', hint: 'web 界面保持打开且任务运行时阻止休眠；页面切后台会自动重取。' },
]

const COPY: Record<string, string> = {
  title: '守夜人（防休眠）',
  description: 'agent 任务执行期间阻止操作系统休眠，任务结束后恢复。',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  unsaved: '未保存',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  overridden: '已覆盖',
  reset: '恢复默认',
  whyLabel: 'systemd-inhibit 的 --why 参数',
  whyHint: 'Linux 下 systemd-inhibit 显示的休眠阻止原因（不影响其他平台）。',
}

const styles: Record<string, CSSProperties> = {
  card: {
    borderRadius: '10px',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    background: 'rgba(255, 255, 255, 0.02)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
    padding: '12px 14px',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
  },
  headText: { flex: 1, minWidth: 0 },
  name: { display: 'block', fontWeight: 600 },
  description: { display: 'block', marginTop: '2px', opacity: 0.65, fontSize: '12px' },
  pending: {
    fontSize: '11px',
    color: '#b45309',
    border: '1px solid currentColor',
    borderRadius: '999px',
    padding: '1px 8px',
    flexShrink: 0,
  },
  chevron: { flexShrink: 0, opacity: 0.6, fontSize: '10px' },
  body: { padding: '2px 14px 14px', display: 'flex', flexDirection: 'column', gap: '10px' },
  readOnly: { margin: 0, fontSize: '12px', opacity: 0.7 },
  row: { display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between', padding: '6px 0' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
  rowHint: { marginTop: '2px', fontSize: '12px', opacity: 0.55 },
  badge: { fontSize: '10px', color: '#b45309', border: '1px solid currentColor', borderRadius: '999px', padding: '0 6px' },
  reset: {
    background: 'transparent',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: '6px',
    padding: '1px 8px',
    fontSize: '11px',
    color: 'inherit',
    cursor: 'pointer',
  },
  toggle: {
    minWidth: '52px',
    borderRadius: '999px',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    padding: '4px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    color: 'inherit',
    background: 'rgba(148, 163, 184, 0.12)',
    flexShrink: 0,
  },
  toggleOn: { background: 'rgba(34, 197, 94, 0.25)', borderColor: 'rgba(34, 197, 94, 0.6)' },
  whyInput: {
    width: '100%',
    boxSizing: 'border-box',
    background: 'rgba(148, 163, 184, 0.1)',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    borderRadius: '6px',
    padding: '6px 10px',
    color: 'inherit',
    fontSize: '13px',
  },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center', marginTop: '2px' },
  failed: { margin: '0 auto 0 0', fontSize: '12px', color: '#dc2626' },
  button: {
    borderRadius: '6px',
    padding: '5px 14px',
    fontSize: '13px',
    cursor: 'pointer',
    border: '1px solid rgba(148, 163, 184, 0.4)',
    background: 'rgba(148, 163, 184, 0.1)',
    color: 'inherit',
  },
  save: { background: 'rgba(59, 130, 246, 0.9)', borderColor: 'transparent', color: '#fff' },
  disabled: { opacity: 0.45, cursor: 'not-allowed' },
}

/** 暂存值：null 表示「清除覆盖、恢复默认」。 */
type Staged = Partial<Record<keyof WakeConfig, boolean | string | null>>

export interface AwakeCardProps extends AwakeCardInjected {}

/**
 * 守夜人设置卡片。
 * @param props - 注入的设置 scope。
 * @returns 卡片（命名空间不可用时返回 null）。
 */
export function AwakeCard({ scope }: AwakeCardProps) {
  const snap: SettingsScopeSnapshot<WakeConfig> = useSyncExternalStore(
    (listener) => scope.subscribe(listener),
    () => scope.getSnapshot(),
  )
  const [staged, setStaged] = useState<Staged>({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)

  if (snap.status === 'unavailable') return null

  const writable = snap.writable && snap.status === 'ready'
  const value = snap.status === 'ready' && snap.value !== undefined ? snap.value : ({} as Partial<WakeConfig>)
  const user = typeof snap.user === 'object' && snap.user !== null ? snap.user : {}
  const dirty = Object.keys(staged).length > 0

  const effective = (key: keyof WakeConfig): boolean | string =>
    key in staged ? (staged[key] as boolean | string) : ((value[key] ?? (key === 'why' ? '' : true)) as boolean | string)

  const overridden = (key: keyof WakeConfig): boolean =>
    key in staged ? staged[key] !== null : key in user

  const stage = (key: keyof WakeConfig, next: boolean | string | null) => {
    setFailed(false)
    setStaged((prev) => ({ ...prev, [key]: next }))
  }

  const save = async () => {
    setSaving(true)
    setFailed(false)
    try {
      for (const [key, raw] of Object.entries(staged) as Array<[keyof WakeConfig, boolean | string | null]>) {
        if (raw === null || raw === '') {
          await scope.unset(key)
        } else {
          await scope.set(key, raw)
        }
      }
      setStaged({})
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const toggle = (key: ToggleFieldDef['key']) => stage(key, !(effective(key) as boolean))

  const rowControls: ReactNode[] = TOGGLE_FIELDS.map((def) => (
    <div key={def.key} style={styles.row}>
      <div style={styles.rowText}>
        <div style={styles.rowLabel}>
          <span>{def.label}</span>
          {overridden(def.key) && <span style={styles.badge}>{COPY.overridden}</span>}
          {overridden(def.key) && (
            <button type="button" style={styles.reset} disabled={!writable || saving} onClick={() => stage(def.key, null)}>
              {COPY.reset}
            </button>
          )}
        </div>
        <div style={styles.rowHint}>{def.hint}</div>
      </div>
      <button
        type="button"
        style={{ ...styles.toggle, ...(effective(def.key) === true ? styles.toggleOn : {}), ...(!writable || saving ? styles.disabled : {}) }}
        disabled={!writable || saving}
        aria-pressed={effective(def.key) === true}
        onClick={() => toggle(def.key)}
      >
        {effective(def.key) === true ? '开' : '关'}
      </button>
    </div>
  ))

  const whyDraft = 'why' in staged ? (staged.why as string | null) : undefined

  return (
    <div style={styles.card}>
      <button type="button" style={styles.header} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span style={styles.headText}>
          <span style={styles.name}>{COPY.title}</span>
          <span style={styles.description}>{COPY.description}</span>
        </span>
        {dirty && <span style={styles.pending}>{COPY.unsaved}</span>}
        <span style={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={styles.body}>
          {!writable && <p style={styles.readOnly} role="status">{COPY.readOnly}</p>}
          {rowControls}
          <div style={styles.row}>
            <div style={styles.rowText}>
              <div style={styles.rowLabel}>
                <span>{COPY.whyLabel}</span>
                {overridden('why') && <span style={styles.badge}>{COPY.overridden}</span>}
                {overridden('why') && (
                  <button type="button" style={styles.reset} disabled={!writable || saving} onClick={() => stage('why', null)}>
                    {COPY.reset}
                  </button>
                )}
              </div>
              <div style={styles.rowHint}>{COPY.whyHint}</div>
            </div>
          </div>
          <input
            style={styles.whyInput}
            disabled={!writable || saving}
            placeholder={typeof value.why === 'string' ? value.why : COPY.whyLabel}
            value={whyDraft ?? ''}
            onChange={(event) => stage('why', event.target.value)}
          />
          <div style={styles.footer}>
            {failed && <p style={styles.failed} role="status">{COPY.saveFailed}</p>}
            <button
              type="button"
              style={{ ...styles.button, ...(!dirty || saving ? styles.disabled : {}) }}
              disabled={!dirty || saving}
              onClick={() => {
                setStaged({})
                setFailed(false)
              }}
            >
              {COPY.discard}
            </button>
            <button
              type="button"
              style={{ ...styles.button, ...styles.save, ...(!dirty || saving ? styles.disabled : {}) }}
              disabled={!dirty || saving}
              onClick={save}
            >
              {saving ? COPY.saving : COPY.save}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
