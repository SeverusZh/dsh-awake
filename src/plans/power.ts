/**
 * dsh-awake —— 方案 C：电源设置兜底（默认关闭）。
 *
 * 先读取系统当前的睡眠相关电源设置，改为「从不睡眠」，任务结束时恢复原值：
 *   - Windows  powercfg /change standby-timeout-ac|-dc 0（恢复原值，单位秒→分钟）
 *   - Linux    gsettings（GNOME）sleep-inactive-ac-type -> 'nothing'（恢复原字符串）
 *   - macOS    pmset -a sleep 0（恢复各电源来源的原值）
 *
 * 全部为 best-effort：任一平台/命令不可用或失败时抛错，由上层捕获并降级，
 * 绝不中断 agent 任务。
 */

import { spawnSync } from 'node:child_process'
import { detectPlatform } from './shell.ts'

/** 一个已修改的电源设置快照；restore() 幂等。 */
export interface PowerInhibit {
  readonly description: string
  restore(): Promise<void>
}

/** 平台对应的「读取原始设置」与「恢复」动作。 */
interface PlatformSnapshot {
  readonly description: string
  restore(): Promise<void>
}

/** 运行一个命令并返回 stdout（失败抛错）。 */
function runCommand(command: string, args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new Error(`执行 ${command} 失败：${String(result.error.message ?? result.error)}`)
  }
  if (result.status !== 0) {
    throw new Error(`执行 ${command} ${args.join(' ')} 失败（退出码 ${result.status}）：${(result.stderr ?? '').trim().slice(0, 200)}`)
  }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/** 十六进制数值（powercfg 输出中的 0x…）。 */
const HEX_VALUE = /0x[0-9a-fA-F]+/g

async function snapshotWindows(): Promise<PlatformSnapshot> {
  // 读取当前生效方案的「睡眠超时」AC/DC 原始值（单位：秒）。
  // 输出为本地化文本，但 GUID 与 0x 索引不受语言影响；
  // 该设置小节里最后的两个 0x 值即 Current AC / Current DC。
  const { stdout } = runCommand('powercfg', [
    '/query',
    'SCHEME_CURRENT',
    'SUB_SLEEP',
    '29f6c1db-86da-48c5-9fdb-f2b67b1f44da', // STANDBYIDLE
  ])
  const matches = stdout.match(HEX_VALUE)
  if (!matches || matches.length < 2) {
    throw new Error('无法解析 powercfg 输出中的睡眠超时值')
  }
  const acSeconds = Number.parseInt(matches[matches.length - 2] ?? '0', 16)
  const dcSeconds = Number.parseInt(matches[matches.length - 1] ?? '0', 16)

  // 修改：从不睡眠（0 = 从不）。powercfg /change 以分钟为单位。
  runCommand('powercfg', ['/change', 'standby-timeout-ac', '0'])
  runCommand('powercfg', ['/change', 'standby-timeout-dc', '0'])

  return {
    description: `Windows · standby-timeout ac=${acSeconds}s dc=${dcSeconds}s -> 0`,
    async restore() {
      // 原值秒数换算回分钟（Windows 设置界面本身以分钟粒度保存，误差可忽略）。
      runCommand('powercfg', ['/change', 'standby-timeout-ac', String(Math.round(acSeconds / 60))])
      runCommand('powercfg', ['/change', 'standby-timeout-dc', String(Math.round(dcSeconds / 60))])
    },
  }
}

/** GNOME 电源设置的 gsettings key。 */
const GNOME_SCHEMA = 'org.gnome.settings-daemon.plugins.power'
const GNOME_KEY = 'sleep-inactive-ac-type'

async function snapshotLinux(): Promise<PlatformSnapshot> {
  // gsettings 仅在 GNOME 系桌面存在；gsettings get 输出自带单引号（GVariant 文本），
  // 原样保存并在恢复时原样回写即可。
  let original: string
  try {
    const { stdout } = runCommand('gsettings', ['get', GNOME_SCHEMA, GNOME_KEY])
    original = stdout.trim()
  } catch (error) {
    throw new Error(`gsettings 不可用（仅支持 GNOME 桌面）：${String((error as Error).message)}`)
  }

  runCommand('gsettings', ['set', GNOME_SCHEMA, GNOME_KEY, "'nothing'"])

  return {
    description: `Linux(GNOME) · ${GNOME_KEY}=${original} -> 'nothing'`,
    async restore() {
      runCommand('gsettings', ['set', GNOME_SCHEMA, GNOME_KEY, original])
    },
  }
}

async function snapshotMacos(): Promise<PlatformSnapshot> {
  // 读取每个电源来源（AC/Battery/UPS）的 sleep 原值（分钟）。
  const { stdout } = runCommand('pmset', ['-g', 'custom'])
  const sources: Array<{ kind: 'ac' | 'battery' | 'ups'; minutes: number }> = []
  const section = /^(AC Power|Battery Power|UPS Power):\s*$/gm
  const sleepLine = /^sleep\s+(\d+)/m
  let match: RegExpExecArray | null
  let cursor = 0
  while ((match = section.exec(stdout)) !== null) {
    const kind = match[1] === 'AC Power' ? 'ac' : match[1] === 'Battery Power' ? 'battery' : 'ups'
    const sectionStart = section.lastIndex
    // 本小节结束于下一个小节标题或文本结尾
    const next = section.exec(stdout)
    const sectionEnd = next !== null ? next.index : stdout.length
    section.lastIndex = sectionStart
    const body = stdout.slice(sectionStart, sectionEnd)
    const sleep = body.match(sleepLine)
    if (sleep !== null) sources.push({ kind, minutes: Number.parseInt(sleep[1] ?? '0', 10) })
    cursor = sectionEnd
  }
  if (sources.length === 0) {
    throw new Error('无法从 pmset -g custom 解析出任何 sleep 设置')
  }

  // 修改：所有电源来源从不睡眠。
  runCommand('pmset', ['-a', 'sleep', '0'])

  return {
    description: `macOS · pmset -a sleep 0（原值 ${sources.map((s) => `${s.kind}=${s.minutes}`).join(', ')}）`,
    async restore() {
      for (const source of sources) {
        const flag = source.kind === 'ac' ? '-c' : source.kind === 'battery' ? '-b' : '-u'
        runCommand('pmset', [flag, 'sleep', String(source.minutes)])
      }
    },
  }
}

/**
 * 读取并修改电源设置（方案C）。平台不支持时返回 null；命令失败时抛错。
 */
export async function acquirePowerInhibit(): Promise<PowerInhibit | null> {
  const platform = detectPlatform()
  let snapshot: PlatformSnapshot
  if (platform === 'win32') {
    snapshot = await snapshotWindows()
  } else if (platform === 'linux') {
    snapshot = await snapshotLinux()
  } else if (platform === 'darwin') {
    snapshot = await snapshotMacos()
  } else {
    return null
  }
  return {
    description: snapshot.description,
    restore: () => snapshot.restore(),
  }
}
