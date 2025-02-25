import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path'

export default defineConfig({
    plugins: [
        react(), 
        electron({
            entry: 'src/main/main.js',
        }),
    ],
    root: path.join(__dirname, 'src/renderer'), 
    build: {
        outDir: path.join(__dirname, 'dist'),
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});