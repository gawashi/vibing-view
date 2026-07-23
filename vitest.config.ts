import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer'), '@shared': resolve('src/shared') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/renderer/setup.ts'],
    passWithNoTests: true
  }
})
