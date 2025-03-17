import { defineConfig } from 'vite'
import { resolve, dirname, join } from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

// Get the current file's directory
const __dirname = dirname(fileURLToPath(import.meta.url))

// Simple plugin for setting up directories
function setupDirectories() {
  return {
    name: 'setup-directories',
    buildStart() {
      console.log('Setting up build directories...')
    },
    closeBundle() {
      try {
        // Output directory
        const outDir = resolve(__dirname, 'dist/mobile')
        const assetsDir = join(outDir, 'assets')

        // Create assets directory if it doesn't exist
        if (!fs.existsSync(assetsDir)) {
          fs.mkdirSync(assetsDir, { recursive: true })
        }

        console.log('Assets directory created:', assetsDir)
      } catch (err) {
        console.error('Error in directory setup:', err)
      }
    }
  }
}

export default defineConfig({
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
    outDir: 'dist/mobile',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  },
  // Removing all CSS processing options
  plugins: [setupDirectories()],
  server: {
    port: 8100 // Standard Ionic dev server port
  }
})
