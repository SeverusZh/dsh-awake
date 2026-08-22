/**
 * 一键更新：`dsh plugin --profile <p> update dsh-awake --latest -w`（超时保护）。
 * 移植自 dsh-pocket lib/index.js 的 performUpdate。
 */

import { spawn } from 'node:child_process'
import { versionInfo } from './version.js'

export interface UpdateOutcome {
  readonly ok: boolean
  code?: number
  output?: string
  error?: string
}

export interface UpdateHelper {
  readonly currentVersion: () => string
  readonly loadedVersion: () => string
  perform(profile?: string): Promise<UpdateOutcome>
}

/** 创建更新助手（默认 profile 'web'，与 dsh-pocket 一致）。 */
export function createUpdateHelper(defaultProfile = 'web', { timeoutMs = 180_000 } = {}): UpdateHelper {
  const perform = (profile?: string): Promise<UpdateOutcome> =>
    new Promise((resolve) => {
      const child = spawn(
        'dsh',
        ['plugin', '--profile', profile ?? defaultProfile, 'update', 'dsh-awake', '--latest', '-w'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let out = ''
      const onData = (chunk: Buffer | string): void => {
        out += String(chunk)
        if (out.length > 4000) out = out.slice(-4000)
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      const timer = setTimeout(() => child.kill(), timeoutMs)
      child.once('exit', (code) => {
        clearTimeout(timer)
        const outcome: UpdateOutcome = { ok: code === 0 }
        if (code !== null) outcome.code = code
        outcome.output = out.slice(-800)
        resolve(outcome)
      })
      child.once('error', (err) => {
        clearTimeout(timer)
        resolve({ ok: false, error: err.message })
      })
    })

  return {
    currentVersion: () => versionInfo().current,
    loadedVersion: () => versionInfo().loaded,
    perform,
  }
}
