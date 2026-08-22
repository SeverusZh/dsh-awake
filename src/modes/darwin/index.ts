/**
 * dsh-awake —— macOS 平台注册表。
 * order: ['caffeinate', 'pmset']（= 下拉顺序 = 回退顺序），default: 'caffeinate'。
 */
import type { PlatformRegistry } from '../index.js'
import { caffeinate } from './caffeinate.js'
import { pmset } from './pmset.js'

export const darwinRegistry: PlatformRegistry = {
  platform: 'darwin',
  order: ['caffeinate', 'pmset'],
  defaultMode: 'caffeinate',
  modes: { caffeinate, pmset },
}
