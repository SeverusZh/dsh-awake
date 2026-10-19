/**
 * 共享设计系统样式（对齐 DSH 官方 dsw-alias 设计令牌）。
 *
 * 做法与 DSH 官方客户端组件一致：插件注入一份带 `data-plugin` 标记的
 * `<style>`（hover / focus-visible / 开关等交互态无法用 inline style 表达），
 * 颜色、字体、圆角、阴影全部取自官方 `--dsw-*` 令牌，因此亮色 / 暗色主题
 * 都自动成立，源码中不出现任何硬编码色值。卸载时 client/index.ts 的
 * effect 会按 `data-plugin` 清理该标签。
 */
import type { CSSProperties } from 'react'
import { PLUGIN_ID } from '../../shared/constants.js'

/** 本插件样式标签的稳定 id（卸载清理按 data-plugin 属性匹配）。 */
const STYLE_TAG_ID = `${PLUGIN_ID}/settings.css`

/** 设置页样式表：状态行、卡片、开关、选择器、更新卡、通知条共用一套体系。 */
export const css = `
.aw-root{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:640px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);}
.aw-status{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:14px;border-bottom:.5px solid var(--dsw-alias-border-l2);}
.aw-status-main{display:inline-flex;align-items:center;gap:8px;min-width:0;font:var(--dsw-font-xs-13);font-weight:500;line-height:20px;}
.aw-status-text{overflow-wrap:anywhere;}
.aw-dot{width:8px;height:8px;border-radius:50%;flex:none;}
.aw-dot-ok{background:var(--dsw-alias-state-success-primary);}
.aw-dot-warn{background:var(--dsw-alias-state-warn-primary);}
.aw-dot-error{background:var(--dsw-alias-state-error-primary);}
.aw-dot-idle{background:var(--dsw-alias-label-caption);}
.aw-msg{margin:12px 0 0;font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.aw-msg-error{color:var(--dsw-alias-state-error-primary);}
.aw-block{display:flex;flex-direction:column;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);}
.aw-block:last-child{border-bottom:none;padding-bottom:0;}
.aw-heading{margin:0;font:var(--dsw-font-xs-13);font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);}
.aw-row{display:flex;align-items:center;justify-content:space-between;gap:16px;}
.aw-row-main{flex:1;min-width:0;}
.aw-row-title{font:var(--dsw-font-xs-13);font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary);}
.aw-hint{margin-top:4px;font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.aw-muted{margin-top:4px;font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;}
.aw-error{margin:0;font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-state-error-primary);overflow-wrap:anywhere;}
.aw-success{color:var(--dsw-alias-state-success-primary);}
.aw-warn{color:var(--dsw-alias-state-warn-label);}
.aw-body{display:flex;flex-direction:column;gap:10px;min-width:0;}
.aw-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.aw-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:30px;padding:0 14px;border:1px solid transparent;border-radius:var(--dsw-radius-sm);font:var(--dsw-font-xs-13);font-weight:500;line-height:1;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease,opacity .15s ease;}
.aw-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;}
.aw-btn:disabled{opacity:.5;cursor:not-allowed;}
.aw-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);}
.aw-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);}
.aw-btn-secondary{background:transparent;border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}
.aw-btn-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);}
.aw-btn-sm{height:26px;padding:0 10px;font:var(--dsw-font-xxs-strong-12);}
.aw-select,.aw-input,.aw-textarea{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);transition:border-color .15s ease;}
.aw-input::placeholder,.aw-textarea::placeholder{color:var(--dsw-alias-label-tertiary);}
.aw-select:hover:not(:disabled),.aw-input:hover:not(:disabled),.aw-textarea:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);}
.aw-select:focus,.aw-input:focus,.aw-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary)) 14%, transparent);}
.aw-select:disabled,.aw-input:disabled,.aw-textarea:disabled{opacity:.55;cursor:not-allowed;}
.aw-textarea{height:auto;min-height:56px;padding:6px 10px;line-height:18px;resize:vertical;}
.aw-select{padding-right:6px;}
.aw-field{display:flex;align-items:center;justify-content:space-between;gap:16px;}
.aw-field-text{flex:1;min-width:0;}
.aw-field-title{font:var(--dsw-font-xs-13);line-height:20px;color:var(--dsw-alias-label-primary);}
.aw-field-control{flex:none;width:220px;max-width:55%;display:flex;justify-content:flex-end;}
.aw-field-control > .aw-input,.aw-field-control > .aw-select{width:100%;}
@media (max-width:480px){.aw-field{flex-direction:column;align-items:stretch;gap:6px;}.aw-field-control{width:100%;max-width:none;justify-content:stretch;}}
.aw-info{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.aw-info-label{color:var(--dsw-alias-label-primary);font-weight:500;margin-right:4px;}
.aw-feedback{display:flex;flex-direction:column;gap:4px;font:var(--dsw-font-xxs-12);line-height:18px;overflow-wrap:anywhere;}
.aw-notice{--aw-tone:var(--dsw-alias-label-secondary);--aw-tone-text:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:4px;margin-top:12px;padding:10px 12px;border:1px solid color-mix(in srgb, var(--aw-tone) 32%, transparent);border-radius:var(--dsw-radius-sm);background:color-mix(in srgb, var(--aw-tone) 8%, transparent);font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere;}
.aw-notice-warn{--aw-tone:var(--dsw-alias-state-warn-primary);--aw-tone-text:var(--dsw-alias-state-warn-label);}
.aw-notice-error{--aw-tone:var(--dsw-alias-state-error-primary);--aw-tone-text:var(--dsw-alias-state-error-primary);}
.aw-notice-title{font-weight:500;color:var(--aw-tone-text);}
.aw-notice-detail{color:var(--dsw-alias-label-secondary);}
.aw-notice-detail-error{color:var(--dsw-alias-state-error-primary);}
.aw-update{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);}
.aw-update-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
.aw-update-title{font:var(--dsw-font-xs-13);font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary);}
.aw-update-desc{font:var(--dsw-font-xxs-12);line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.aw-switch{position:relative;display:inline-flex;align-items:center;flex:none;cursor:pointer;}
.aw-switch-input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;}
.aw-switch-track{box-sizing:border-box;display:flex;align-items:center;width:36px;height:20px;padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-3);transition:background-color .15s ease,border-color .15s ease;}
.aw-switch-thumb{width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-switch-thumb);box-shadow:var(--dsw-shadow-lv1);transition:transform .15s ease;}
.aw-switch-input:checked + .aw-switch-track{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}
.aw-switch-input:checked + .aw-switch-track .aw-switch-thumb{transform:translateX(16px);}
.aw-switch-input:focus-visible + .aw-switch-track{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;}
.aw-switch-input:disabled + .aw-switch-track{opacity:.5;}
.aw-switch-input:disabled{cursor:not-allowed;}
`

/** 注入设置页样式表（幂等；卸载时由 data-plugin 清理）。 */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PLUGIN_ID
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = css
  document.head.appendChild(tag)
}

/** 需要与主题联动、保持 inline 下发的动态样式（目前仅禁用态兜底）。 */
export const styles: Record<string, CSSProperties> = {
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
}
