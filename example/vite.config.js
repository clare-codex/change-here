import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import changeHere from 'vite-plugin-changehere'

export default defineConfig({
  plugins: [changeHere(), react()],
})
