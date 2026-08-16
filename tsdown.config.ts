/**
 * tsdown config for dsh-awake. Adapted from the official plugin template
 * (deepseek-harness `packages/client/tsdown.client.ts`, MIT, Copyright (c)
 * 2026 DeepSeek):
 *  - node half:  lib/types/index.js -> lib/index.js (ESM)
 *  - browser half: lib/types/web/index.js -> lib/client.js (CJS bundle that
 *    hands itself to the dsh web shell's `window.__ModuleLoader__.load`).
 * Externals resolve through the shell's frozen module table at runtime.
 */
import type { UserConfig } from 'tsdown'

const ID = 'dsh-awake'

/**
 * The module specifiers the dsh web shell seeds into its frozen module table
 * (mirrors deepseek-harness packages/client/web/src/platform.ts). Everything
 * else inlines into the bundle.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

const libConfig: UserConfig = {
  name: ID,
  entry: ['lib/types/index.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'lib/types/web/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default [libConfig, clientConfig]
