/**
 * dsh-awake —— Windows 平台注册表。
 * order: ['powershell', 'powercfg']（= 下拉顺序 = 回退顺序），default: 'powershell'。
 */
import type { PlatformRegistry } from '../index.js'
import { powershell } from './powershell.js'
import { powercfg } from './powercfg.js'

export const win32Registry: PlatformRegistry = {
  platform: 'win32',
  order: ['powershell', 'powercfg'],
  defaultMode: 'powershell',
  modes: { powershell, powercfg },
}
