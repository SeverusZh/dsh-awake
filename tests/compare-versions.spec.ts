/**
 * compareVersions 单测（移植 dsh-pocket api.js 的用例覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { compareVersions } from '../src/client/api.js'

describe('compareVersions', () => {
  it('数字段比较', () => {
    expect(compareVersions('0.2.0', '0.1.1')).toBeGreaterThan(0)
    expect(compareVersions('0.1.1', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('1.0.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0)
  })

  it('容忍 v 前缀', () => {
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('v0.2.1', '0.2.0')).toBeGreaterThan(0)
  })

  it('缺段按 0 处理', () => {
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('0.2.1', '0.2')).toBeGreaterThan(0)
    expect(compareVersions('1', '0.9.9')).toBeGreaterThan(0)
  })

  it('预发布后缀：正式版 > 预发布', () => {
    expect(compareVersions('0.2.0', '0.2.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0-rc.1', '0.2.0')).toBeLessThan(0)
  })

  it('预发布段：alpha < beta < rc，数字段按数值', () => {
    expect(compareVersions('0.2.0-alpha.1', '0.2.0-beta.1')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0-rc.1')).toBeLessThan(0)
    expect(compareVersions('0.2.0-rc.9', '0.2.0-rc.10')).toBeLessThan(0)
    expect(compareVersions('0.2.0-rc.10', '0.2.0-rc.9')).toBeGreaterThan(0)
  })

  it('npm registry 场景：local 0.2.0 vs latest 0.1.1 → 无新版', () => {
    expect(compareVersions('0.1.1', '0.2.0')).toBeLessThan(0)
  })
})
