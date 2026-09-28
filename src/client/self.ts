/**
 * 本插件自身的 npm 包名 —— 由构建期注入（见 tsdown.client.config.ts / vitest.config.ts，
 * 二者都从 package.json 的 `name` 读取），**不硬编码**。
 *
 * 为什么必须以「npm 包名」为准（两处 DSH 契约，均已从 0.1.7-rc.2 源码核实）：
 *   1) 客户端 bundle 的 ModuleLoader id 必须等于包名：`dsh-client-modules`
 *      以 `packageName`（package.json 的 name，含 scope）作为 boot graph 的行 id
 *      （lib/index.js:884 `graphRow(packageName, …)`），加载时校验
 *      `factories.has(id)`（lib/client.js:625/739），id 不符即整半加载失败；
 *   2) `plugins.bundle.config` 的 key 必须等于包名：插件详情页以
 *      `configured = ledger.bundles.has(openPkg.name)` 决定是否渲染配置区块
 *      （dsh-client-ui-plugin-manager/lib/client.js:2879）。
 *
 * 包名在**构建期**已知（bundle 在脚本执行时就要注册正确的 ModuleLoader id，
 * 运行时再取已来不及），故用 define 注入单一常量；改包名发布时 `prepublishOnly`
 * 重新构建即自动对齐，无需改源码。
 */
declare const __DSH_AWAKE_PKG_NAME__: string

/** 本包实际 npm 包名（= package.json 的 name，例如 `dsh-awake` 或 `@scope/dsh-awake`）。 */
export const SELF_PACKAGE_NAME: string = __DSH_AWAKE_PKG_NAME__
