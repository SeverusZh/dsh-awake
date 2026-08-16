/**
 * dsh-awake —— 方案 A 的悬浮开关（挂在 shell.overlay 列表槽上）。
 *
 * 一个小浮标展示守夜人状态，点击可对本浏览器单独开关方案A
 * （写入 localStorage，覆盖服务端全局默认值），双击恢复跟随全局默认。
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { WakeLockManager, WEB_WAKE_LOCK_STORAGE_KEY, type WakeLockState } from './wake-lock.ts'

/** 服务端配置端点（由插件 node 半注册）。 */
const CONFIG_ENDPOINT = '/dsh-awake/config'

const STATE_META: Record<WakeLockState, { label: string; color: string; detail: string }> = {
  unsupported: { label: '防休眠不可用', color: '#b91c1c', detail: '当前浏览器不支持 Screen Wake Lock API（需 https / localhost 安全上下文）' },
  disabled: { label: '防休眠已停用', color: '#9ca3af', detail: '方案A已被本浏览器或全局配置关闭。单击恢复，双击回到全局默认' },
  idle: { label: '守夜人 · 待命', color: '#64748b', detail: '已启用；任务开始执行后自动防休眠。单击停用本浏览器' },
  holding: { label: '守夜人 · 值守中', color: '#16a34a', detail: 'agent 任务执行中，屏幕/系统不会休眠。单击停用本浏览器' },
  hidden: { label: '守夜人 · 后台', color: '#d97706', detail: '页面在后台时浏览器会释放锁；切回本页面将自动重取' },
  'request-error': { label: '防休眠申请失败', color: '#dc2626', detail: '系统拒绝了 Wake Lock 请求（可能与省电策略有关），请改用方案B' },
}

const STYLE_ID = 'dsh-awake-pill-style'

/** 注入一次脉冲动画样式（防重）。 */
function ensurePillStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent =
    '@keyframes dsh-awake-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }'
  document.head.appendChild(style)
}

const pillStyle: CSSProperties = {
  position: 'fixed',
  left: '12px',
  bottom: '12px',
  zIndex: 2147483000,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '6px 12px',
  borderRadius: '999px',
  background: 'rgba(15, 23, 42, 0.85)',
  color: '#e2e8f0',
  fontSize: '12px',
  lineHeight: '1',
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
  cursor: 'pointer',
  userSelect: 'none',
  pointerEvents: 'auto',
  backdropFilter: 'blur(4px)',
  whiteSpace: 'nowrap',
}

/**
 * `shell.overlay` 列表槽条目：守夜人状态浮标。
 * @param props - 槽运行时分发；只读全局会话列表 feed。
 */
export function WakeLockPill({ useSessions }: PropsRuntime<'shell.overlay'>) {
  const anyRunning = useSessions((state) =>
    Object.values(state.byId).some((summary) => summary.running),
  )
  const managerRef = useRef<WakeLockManager | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    ensurePillStyle()
    const manager = new WakeLockManager()
    managerRef.current = manager
    const unsubscribe = manager.subscribe(() => setTick((tick) => tick + 1))

    // 本浏览器独立开关（localStorage 覆盖）
    try {
      const raw = localStorage.getItem(WEB_WAKE_LOCK_STORAGE_KEY)
      manager.setOverride(raw === null ? null : raw === 'true')
    } catch {
      manager.setOverride(null)
    }

    // 服务端全局默认值；拿不到时按默认开启处理
    fetch(CONFIG_ENDPOINT, { cache: 'no-store' })
      .then((response) => (response.ok ? (response.json() as Promise<{ webWakeLock?: boolean }>) : null))
      .then((config) => manager.setDefaultEnabled(config?.webWakeLock !== false))
      .catch(() => manager.setDefaultEnabled(true))

    return () => {
      unsubscribe()
      manager.dispose()
      managerRef.current = null
    }
  }, [])

  useEffect(() => {
    managerRef.current?.setTaskActive(anyRunning)
  }, [anyRunning])

  const manager = managerRef.current
  const state: WakeLockState = manager === null ? 'idle' : manager.state
  const meta = STATE_META[state]
  const holding = state === 'holding'

  return (
    <div
      style={pillStyle}
      role="status"
      title={meta.detail}
      onClick={() => managerRef.current?.toggle()}
      onDoubleClick={() => managerRef.current?.setOverride(null)}
    >
      <span
        aria-hidden="true"
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: meta.color,
          flexShrink: 0,
          animation: holding ? 'dsh-awake-pulse 1.6s ease-in-out infinite' : undefined,
        }}
      />
      <span>{meta.label}</span>
    </div>
  )
}
