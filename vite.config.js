import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Tauri recommends excluding the Rust project from Vite's file watcher.
      // Source: https://v2.tauri.app/start/create-project/#manual-setup-tauri-cli
      ignored: ['**/src-tauri/**'],
    },
  },
})
