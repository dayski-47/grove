import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { compression } from 'vite-plugin-compression2'

export default defineConfig({
  plugins: [
    react(),
    compression({ algorithms: ['gzip'] }),
    compression({ algorithms: ['brotliCompress'], filename: '[path][base].br' }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
  }
})