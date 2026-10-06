import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { markdownParserAliases } from '../../../config/build-plugins/markdown-parser-exports'

const orcaRoot = resolve(__dirname, '../../..')
const harnessHtml = resolve(__dirname, 'index.html')

// Why root stays at src/renderer: Tailwind scans sources relative to the Vite
// root, so the harness must share the real renderer's root to get its classes.
function designHarnessPage(): Plugin {
  return {
    name: 'design-harness-page',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0]
        if (pathname !== '/' && pathname !== '/index.html') {
          next()
          return
        }
        const raw = readFileSync(harnessHtml, 'utf8').replace(
          './harness-main.ts',
          `/@fs/${resolve(__dirname, 'harness-main.ts').split(sep).join('/')}`
        )
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml('/index.html', raw))
      })
    }
  }
}

// Fixture-preload renderer for design captures. Binds loopback only and never
// builds into out/, so it cannot replace or ship with the desktop bundle.
export default defineConfig({
  root: resolve(orcaRoot, 'src/renderer'),
  plugins: [designHarnessPage(), react(), tailwindcss()],
  define: {
    ORCA_FEATURE_WALL_ENABLED: 'false',
    'import.meta.env.VITE_ENABLE_REACT_GRAB': JSON.stringify('false')
  },
  resolve: {
    alias: {
      ...markdownParserAliases,
      '@renderer': resolve(orcaRoot, 'src/renderer/src'),
      '@': resolve(orcaRoot, 'src/renderer/src')
    }
  },
  server: {
    host: '127.0.0.1',
    strictPort: false,
    fs: { allow: [orcaRoot] }
  },
  worker: {
    format: 'es'
  }
})
