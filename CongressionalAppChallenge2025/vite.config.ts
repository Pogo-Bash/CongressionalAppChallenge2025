import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // Main process configuration
    plugins: [externalizeDepsPlugin(),
        tailwindcss()
    ],
    build: {
      outDir: 'dist/main'
    }
  },
  preload: {
    // Preload script configuration
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload'
    }
  },
  renderer: {
    // Renderer process configuration 
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
        '@shared': resolve(__dirname, 'src/shared'),
        '@assets': resolve(__dirname, 'src/renderer/assets'),
        '@services': resolve(__dirname, 'src/shared/js/services'),
        '@components': resolve(__dirname, 'src/shared/js/components')
      }
    },
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    server: {
      port: 3000
    }
  }
})