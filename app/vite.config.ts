/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Deployed under /degree-planner/ on bailey-inglish.github.io so the
// existing static reports at the site root keep their URLs.
export default defineConfig({
  base: '/degree-planner/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
