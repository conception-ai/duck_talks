import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    svelte(),
    {
      name: 'recordings-index',
      configureServer(server) {
        server.middlewares.use('/recordings/index.json', (_req, res) => {
          const dir = path.join(__dirname, 'public/recordings')
          const files = fs.existsSync(dir)
            ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
            : []
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(files))
        })
      },
    },
  ],
  build: {
    outDir: 'dist/public',
  },
  envPrefix: ['VITE_', 'GOOGLE_'],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
