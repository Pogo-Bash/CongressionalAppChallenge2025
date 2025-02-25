import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import path from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {}, 
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './shared'),
      '@renderer': path.resolve(__dirname, './src/renderer/src'),
    }
  },
})
