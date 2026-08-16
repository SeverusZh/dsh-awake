/**
 * web 客户端半测试：
 *  1. 用假 window.__ModuleLoader__ 加载 lib/client.js，校验导出（inject / apply）；
 *  2. 用假上下文调用 apply，校验：后台防休眠驱动订阅会话与设置；
 *     设置卡片注册进 settings.plugin.item；
 *  3. 用 mock 注入直接测 WakeLockManager 状态机（编译产物 wake-lock.js）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  —  ' + extra : ''}`)
  if (!ok) failures += 1
}

// —— 1. 加载客户端 bundle ——
const bundleSrc = readFileSync(join(here, '../lib/client.js'), 'utf8')
check('client bundle 存在', bundleSrc.length > 0)

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(handoff) {
      loaded = handoff
    },
  },
}
const code = new Function('window', bundleSrc)
code(globalThis.window)
check('bundle 已注册到 __ModuleLoader__', loaded !== null && loaded.id === 'dsh-awake')
check('bundle 带 factory', typeof loaded?.factory === 'function')

const exportsObj = loaded.factory(require)
check('factory 导出 apply', typeof exportsObj?.apply === 'function')
check(
  'factory 导出 inject（slots/settingsScope/sessions）',
  Array.isArray(exportsObj?.inject) &&
    ['slots', 'settingsScope', 'sessions'].every((s) => exportsObj.inject.includes(s)),
  JSON.stringify(exportsObj?.inject),
)

// —— 2. apply：后台驱动订阅 + 卡片注册 ——
const scopeListeners = new Set()
const scopeSnap = {
  status: 'ready',
  value: { enabled: true, shellWakeLock: true, powerCfgWakeLock: false, webWakeLock: true, why: 'x' },
  base: undefined,
  user: undefined,
  revision: 1,
  writable: true,
  mode: 'host',
}
const fakeScope = {
  getSnapshot: () => scopeSnap,
  subscribe: (listener) => {
    scopeListeners.add(listener)
    return () => scopeListeners.delete(listener)
  },
  set: async (field, value) => {
    scopeSnap.value = { ...scopeSnap.value, [field]: value }
  },
  unset: async (field) => {
    const copy = { ...scopeSnap.value }
    delete copy[field]
    scopeSnap.value = copy
  },
}

const sessionListeners = new Set()
let running = false
const fakeSessions = {
  list: {
    getSnapshot: () => ({ byId: running ? { a: { running: true } } : {} }),
    subscribe: (listener) => {
      sessionListeners.add(listener)
      return () => sessionListeners.delete(listener)
    },
  },
}

let cardRegistered = null
let injectedSlot = null
const fakeCtx = {
  get: (name) => {
    if (name === 'sessions') return fakeSessions
    return undefined
  },
  settingsScope: {
    bind: (spec) => {
      check('settingsScope.bind 绑定 dsh-awake 命名空间', spec.namespace === 'dsh-awake', JSON.stringify(spec))
      return fakeScope
    },
  },
  slots: {
    inject(key, callback) {
      injectedSlot = key
      callback()
      return () => {}
    },
    register(options, component) {
      cardRegistered = { options, component }
      return () => {}
    },
  },
  effect() {
    return () => {}
  },
}
exportsObj.apply(fakeCtx)
check('卡片注册进 settings.plugin.item', injectedSlot === 'settings.plugin.item', String(injectedSlot))
check(
  '卡片 id 为 dsh-awake',
  cardRegistered?.options?.id === 'dsh-awake',
  JSON.stringify(cardRegistered?.options),
)
check('卡片是 React 组件', typeof cardRegistered?.component === 'function')
check('卡片注入面带 scope', typeof cardRegistered?.options?.inject?.()?.scope?.getSnapshot === 'function')

// 后台驱动：会话 running 变化应触发 manager.setTaskActive（通过订阅链验证）
check('apply 订阅了会话列表', sessionListeners.size === 1)
check('apply 订阅了设置 scope', scopeListeners.size === 1)

// —— 3. WakeLockManager 状态机（mock 注入，无 localStorage）——
const { WakeLockManager } = require(join(here, '../lib/types/web/wake-lock.js'))

const makeManager = (overrides = {}) => {
  const requests = []
  const manager = new WakeLockManager({
    isSupported: () => true,
    request: async () => {
      const sentinel = {
        release: async () => {},
        addEventListener: () => {},
      }
      requests.push(sentinel)
      return sentinel
    },
    subscribeVisibility: () => () => {},
    isVisible: () => true,
    ...overrides,
  })
  return { manager, requests }
}

{
  const { manager, requests } = makeManager()
  check('初始状态 idle', manager.state === 'idle')
  manager.setEnabled(true)
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('任务开始后持有锁', manager.state === 'holding' && requests.length === 1)
  manager.setTaskActive(false)
  check('任务结束后释放', manager.state === 'idle')
}

{
  const { manager } = makeManager()
  manager.setEnabled(false)
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('设置关闭时任务中也不申请', manager.state === 'disabled')
}

{
  // visibilitychange：后台释放、回前台自动重取
  let visibilityListener = null
  let visible = true
  const { manager, requests } = makeManager({
    subscribeVisibility: (listener) => {
      visibilityListener = listener
      return () => {
        visibilityListener = null
      }
    },
    isVisible: () => visible,
  })
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('前台任务持有锁', manager.state === 'holding')
  visible = false
  visibilityListener?.()
  check('页面后台时状态 hidden', manager.state === 'hidden')
  visible = true
  visibilityListener?.()
  await new Promise((r) => setTimeout(r, 10))
  check('回到前台自动重取', manager.state === 'holding' && requests.length === 2, `requests=${requests.length}`)
}

{
  // 请求失败 → request-error
  const { manager } = makeManager({
    request: async () => {
      throw new Error('denied')
    },
  })
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('申请失败显示 request-error', manager.state === 'request-error')
}

{
  // 不支持 → unsupported
  const { manager } = makeManager({ isSupported: () => false })
  check('不支持时 unsupported', manager.state === 'unsupported')
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 个失败`)
process.exit(failures === 0 ? 0 : 1)
