/**
 * 版本信息：current = 磁盘包版本 / loaded = 运行中版本。
 * （一键更新会改写磁盘 package.json；「已更新未重启」靠两者比对识别。）
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 本插件 package.json 的绝对路径（相对本模块：lib/ 或 src/host/ → 包根）。 */
const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))

/** 实时读磁盘包版本（不能用 require 缓存——进程内永远不变）。 */
export function currentVersion(): string {
  try {
    const raw = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: unknown }
    return typeof raw.version === 'string' ? raw.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 进程启动时加载的版本（模块加载瞬间固化）。 */
export const loadedVersion = currentVersion()

/** 版本快照（更新卡片用）。 */
export function versionInfo(): { current: string; loaded: string } {
  return { current: currentVersion(), loaded: loadedVersion }
}
