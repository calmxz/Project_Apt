import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      // Pin chat to the JSON (non-streaming) path under unit tests so the
      // send-flow assertions stay deterministic. The app defaults to streaming
      // (VITE_CHAT_STREAM unset -> on); the SSE path is covered by the
      // chatStreamService / store tests and the msg-streaming render test.
      env: { VITE_CHAT_STREAM: 'false' },
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      setupFiles: ['./src/__tests__/setup.js'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{js,vue}'],
        exclude: ['src/**/*.spec.js', 'src/**/__tests__/**', 'e2e/**', 'src/main.js'],
        thresholds: { lines: 80, statements: 80, functions: 70, branches: 65 },
      },
    },
  }),
)
