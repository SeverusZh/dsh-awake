/**
 * dsh-awake —— Linux 平台注册表。
 * order: ['systemd', 'gnome-gsettings']（= 下拉顺序 = 回退顺序），default: 'systemd'。
 */
import type { PlatformRegistry } from '../index.js'
import { systemd } from './systemd.js'
import { gnomeGsettings } from './gnome-gsettings.js'

export const linuxRegistry: PlatformRegistry = {
  platform: 'linux',
  order: ['systemd', 'gnome-gsettings'],
  defaultMode: 'systemd',
  modes: { systemd, 'gnome-gsettings': gnomeGsettings },
}
