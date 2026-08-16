/**
 * web 客户端半测试：
 *  1. 用假 window.__ModuleLoader__ 加载 lib/client.js，校验导出（inject / apply）；
 *  2. 用假 slots 上下文调用 apply，校验注册到 shell.overlay；
 *  3. 用 mock 注入直接测 WakeLockManager 的状态机（编译产物 wake-lock.js）。
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
const bundlePath = join(here, '../lib/client.js')
const bundleSrc = readFileSync(bundlePath, 'utf8')
check('client bundle 存在', bundleSrc.length > 0)

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load(handoff) {
      loaded = handoff
    },
  },
}
// 把 bundle 当 CJS 执行：它自带 `window.__ModuleLoader__.load({...})`，注册后不直接执行 factory。
const code = new Function('window', bundleSrc)
code(globalThis.window)
check('bundle 已注册到 __ModuleLoader__', loaded !== null && loaded.id === 'dsh-awake')
check('bundle 带 factory', typeof loaded?.factory === 'function')

// 执行 factory：externals（react / cordis / ui-slots）从项目 devDeps 解析
const exportsObj = loaded.factory(require)
check('factory 导出 apply', typeof exportsObj?.apply === 'function')
check('factory 导出 inject', Array.isArray(exportsObj?.inject) && exportsObj.inject.includes('slots'))

// —— 2. apply 注册到 shell.overlay ——
let registered = null
let injected = false
const fakeCtx = {
  slots: {
    inject(key, callback) {
      injected = key === 'shell.overlay'
      // 同步执行回调，返回幂等 disposer
      const disposer = callback()
      return () => {}
    },
    register(options, component) {
      registered = { options, component }
      return () => {}
    },
  },
}
exportsObj.apply(fakeCtx)
check('apply 等待 shell.overlay 声明', injected)
check(
  'apply 注册守夜人条目',
  registered?.options?.name === 'shell.overlay' && registered?.options?.id === 'dsh-awake',
  JSON.stringify(registered?.options),
)
check('注册的是 React 组件', typeof registered?.component === 'function')

// —— 3. WakeLockManager 状态机（mock 注入）——
const { WakeLockManager, WEB_WAKE_LOCK_STORAGE_KEY } = require(join(here, '../lib/types/web/wake-lock.js'))

const makeManager = (overrides = {}) => {
  const requests = []
  const releases = []
  let visibilityListener = null
  const manager = new WakeLockManager({
    storage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    isSupported: () => true,
    request: async () => {
      const sentinel = {
        release: async () => {
          releases.push(1)
        },
        addEventListener: () => {},
      }
      requests.push(sentinel)
      return sentinel
    },
    subscribeVisibility: (listener) => {
      visibilityListener = listener
      return () => {
        visibilityListener = null
      }
    },
    isVisible: () => true,
    ...overrides,
  })
  return { manager, requests, releases, getVisibilityListener: () => visibilityListener }
}

{
  const { manager, requests } = makeManager()
  check('初始状态 idle', manager.state === 'idle')
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('任务开始后持有锁', manager.state === 'holding' && requests.length === 1)
  manager.setTaskActive(false)
  check('任务结束后释放', manager.state === 'idle')
}

{
  const { manager } = makeManager()
  manager.setDefaultEnabled(false)
  check('全局关闭时任务中也不申请', manager.state === 'disabled')
  manager.setOverride(true)
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('本浏览器覆盖可重新打开', manager.state === 'holding')
  manager.toggle()
  check('toggle 关闭后 disabled', manager.state === 'disabled')
}

{
  // visibilitychange：后台释放、回前台重取
  const { manager, requests, getVisibilityListener } = makeManager()
  manager.setTaskActive(true)
  await new Promise((r) => setTimeout(r, 10))
  check('前台任务持有锁', manager.state === 'holding')
  // 模拟页面隐藏：浏览器自动释放（sentinel release 事件），状态 hidden
  requests[0].release()
  manager.setTaskActive(true) // 触发一次对账（release 事件回调置空 sentinel）
  // 直接调用可见性监听（isVisible 注入恒为 true，这里先翻转）
  const listener = getVisibilityListener()
  check('已订阅 visibilitychange', typeof listener === 'function')
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
