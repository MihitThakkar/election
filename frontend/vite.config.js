import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        host: true,
        allowedHosts: ['8c97-2401-4900-4e55-4cc5-1d70-35b5-2e44-6ef4.ngrok-free.app'],
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
            '/uploads': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
        },
    },
    preview: {
        port: 3000,
        host: true,
        allowedHosts: ['8c97-2401-4900-4e55-4cc5-1d70-35b5-2e44-6ef4.ngrok-free.app'],
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
            '/uploads': {
                target: 'http://localhost:4000',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false,
    },
});
