/**
 * dsh-awake 的跨半常量（host 与 client 共享，各自打进自己的 bundle）。
 * 命名与约定见 DESIGN.md —— 勿改。
 */

/** 插件包名（也是 Cordis 条目名 / settings 命名空间 / 设置页 slot id）。 */
export const PLUGIN_ID = 'dsh-awake'

/** settings 命名空间（settings.yaml 里持久化的顶层键）。 */
export const SETTINGS_NS = 'dsh-awake'

/** 设置页 settings.section slot 的注册 id。 */
export const SETTINGS_SLOT_ID = 'dsh-awake'

/** 设置页 locale 命名空间（client 半注册到 dsh-client-locale）。 */
export const SETTINGS_LOCALE_NS = 'settings.awake'

/** 设置页数据面 RPC 通道（ctx.connection.rpc，绕开官方 settings wire 白名单，见 DESIGN.md 3.3）。 */
export const RPC_CHANNEL = '/dsh-awake'

/** 设置页在 settings.section 里的排序（越大越靠后）。 */
export const SECTION_ORDER = 60

/** 浏览器 Wake Lock 的 localStorage 键（每浏览器状态，不进配置文件）。 */
export const LOCALSTORAGE_KEY = 'dsh-awake.webWakeLock'

/** 配置文件版本：2（有老配置时自动转换，见 host/settings.ts 迁移逻辑）。 */
export const CONFIG_VERSION = 2

/** npm registry 最新版探测地址（更新卡片用，带 CORS *）。 */
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org/dsh-awake/latest'
