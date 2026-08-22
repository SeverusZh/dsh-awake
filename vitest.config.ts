import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // globals 开启后 @testing-library/react 的自动 cleanup 才能挂到 afterEach，
    // 避免 jsdom DOM 在用例之间累积。
    globals: true,
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
})
