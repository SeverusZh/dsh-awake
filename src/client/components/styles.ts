/**
 * 共享内联样式（对齐 DSH 官方设计系统 dsw-alias 令牌，带兜底色值；
 * 与 dsh-pocket 的做法一致，不引入 CSS Modules）。
 */
import type { CSSProperties } from 'react'

export const styles: Record<string, CSSProperties> = {
  card: {
    background: 'var(--dsw-alias-bg-layer-1,#fff)',
    border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
    borderRadius: 12,
    padding: '16px 20px',
    maxWidth: 560,
  },
  block: {
    borderTop: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
    marginTop: 16,
    paddingTop: 16,
  },
  muted: {
    color: 'var(--dsw-alias-label-tertiary,#8b93a1)',
    fontSize: 12,
    lineHeight: 1.5,
  },
  code: {
    fontFamily: 'ui-monospace,Menlo,monospace',
    fontSize: 12,
    wordBreak: 'break-all',
    margin: '6px 0 10px',
    color: 'var(--dsw-alias-label-primary,inherit)',
  },
  // 主按钮：官方 md 胶囊形（36px）
  primary: {
    font: 'inherit',
    cursor: 'pointer',
    border: 'none',
    background: 'var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary,#4f6ef7))',
    color: '#fff',
    height: 36,
    padding: '0 16px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 次级按钮：官方 outline/ghost 胶囊形
  btn: {
    font: 'inherit',
    cursor: 'pointer',
    border: '1px solid var(--dsw-alias-button-ghost-active-border, var(--dsw-alias-border-l2,#d1d5db))',
    background: 'var(--dsw-alias-bg-layer-1,#fff)',
    color: 'var(--dsw-alias-label-primary,inherit)',
    height: 36,
    padding: '0 16px',
    borderRadius: 999,
    fontSize: 13,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.45, cursor: 'not-allowed' },
  warn: { color: 'var(--dsw-alias-state-warn-primary,#b45309)', fontSize: 12, lineHeight: 1.5 },
  error: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, lineHeight: 1.5 },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
}
