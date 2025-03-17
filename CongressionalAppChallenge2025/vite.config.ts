import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import electron from 'vite-plugin-electron'
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { dirname, join } from 'path'

// Function to copy Ionic assets during build
function copyIonicAssetsPlugin() {
  return {
    name: 'copy-ionic-assets',
    buildStart() {
      console.log('Copying Ionic assets...')
    },
    writeBundle() {
      try {
        // Get path to @ionic/core
        const ionicCorePath = dirname(require.resolve('@ionic/core/package.json'))
        const ionicDist = join(ionicCorePath, 'dist')

        // Create destination directories
        const rendererDir = resolve(__dirname, 'dist/renderer/assets/ionic')
        const cssDir = join(rendererDir, 'css')
        const componentDir = join(rendererDir, 'components')

        // Create dirs if they don't exist
        if (!existsSync(rendererDir)) mkdirSync(rendererDir, { recursive: true })
        if (!existsSync(cssDir)) mkdirSync(cssDir, { recursive: true })
        if (!existsSync(componentDir)) mkdirSync(componentDir, { recursive: true })

        // Copy essential Ionic files
        const filesToCopy = [
          // CSS files
          {
            src: join(ionicDist, 'ionic/css/ionic.bundle.css'),
            dest: join(cssDir, 'ionic.bundle.css')
          },

          // Core components
          { src: join(ionicDist, 'ionic/ionic.esm.js'), dest: join(rendererDir, 'ionic.esm.js') },

          // Ionicons
          {
            src: join(ionicCorePath, 'components/icon/icon.js'),
            dest: join(componentDir, 'icon.js')
          }
        ]

        // Copy all files
        filesToCopy.forEach(({ src, dest }) => {
          try {
            copyFileSync(src, dest)
            console.log(`Copied: ${src} → ${dest}`)
          } catch (err) {
            console.error(`Failed to copy ${src}:`, err)
          }
        })

        console.log('Ionic assets copied successfully')
      } catch (err) {
        console.error('Error copying Ionic assets:', err)
      }
    }
  }
}

export default defineConfig({
  main: {
    // Main process configuration
    plugins: [externalizeDepsPlugin()],
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
        '@components': resolve(__dirname, 'src/shared/js/components'),
        '@ionic/core': resolve(__dirname, 'node_modules/@ionic/core')
      }
    },
    plugins: [copyIonicAssetsPlugin()],
    build: {
      outDir: 'dist/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        },
        external: [
          // Ensure external dependencies are properly handled
          /^@ionic\/core/
        ]
      },
      commonjsOptions: {
        transformMixedEsModules: true,
        // Add Ionic to include list to prevent bundling issues
        include: [/node_modules\/@ionic\/core/]
      }
    },
    optimizeDeps: {
      include: ['@ionic/core']
    },
    server: {
      port: 3000
    }
  }
})
