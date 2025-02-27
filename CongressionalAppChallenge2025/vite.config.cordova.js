import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({

    base: './',

    build: {
        outDir: path.resolve(__dirname, 'mobile/www'),
        emptyOutDir: true,
        
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'shared/index.html')
          },
          output: {
            // Don't create extra directories when copying index.html
            assetFileNames: 'assets/[name].[hash].[ext]'
          }
        }
      },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './shared')
    }
  },

  server: {
    port: 8080,
    open: true
  },
  
  plugins: [
    tailwindcss(),
  ],
});