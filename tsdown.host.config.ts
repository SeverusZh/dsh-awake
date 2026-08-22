/**
 * Host（node）半构建：把 tsc 产物 lib/types/*.js 打包成单个 ESM 文件。
 *
 * 产出：lib/index.js —— 插件入口（export { name, inject, apply } + 类型再导出）。
 *
 * node: 内建模块自动 external；本包无运行时第三方依赖，全部内联。
 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  clean: false,
  dts: false,
})
