import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import federation from '@originjs/vite-plugin-federation'
import path from 'node:path'

// Module-Federation remote for design-frames-service's review UI.
//
// Mirrors FuzeFront's clock-app remote pattern exactly (see
// FuzeFront/clock-app/vite.config.ts and
// FuzeFront/docs/guides/BUILDING_ON_FUZEFRONT.md §1):
//   scope  = "fuzex"              (federation `name`)
//   module = "./DesignFramesApp"  (exposed module -> src/App.tsx default export)
//   remoteEntry served at …/apps/fuzex/remoteEntry.js
// React / react-dom are shared as singletons matching the host's React 19
// contract. The design system is NOT shared — it is bundled into this remote
// (per this feature's build spec), so no version coupling to the host there.
//
// LOCAL-VERIFY-ONLY: the published `@izzywdev/fuzefront-design-system` package
// requires a GitHub Packages token this environment doesn't have (401). Set
// LOCAL_DS=1 (and `npm install --no-save /home/user/FuzeFront/design-system`
// first) to alias the import to that local checkout for a local build check.
// CI/prod NEVER sets LOCAL_DS, so the declared dependency resolves normally
// there — this alias has zero effect on the real build.
const useLocalDs = process.env.LOCAL_DS === '1'

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'fuzex',
      filename: 'remoteEntry.js',
      exposes: {
        './DesignFramesApp': './src/App.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.0.0' } as any,
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' } as any,
      },
    }),
  ],
  resolve: useLocalDs
    ? {
        alias: {
          '@izzywdev/fuzefront-design-system': path.resolve(
            __dirname,
            'node_modules/@fuzefront/design-system'
          ),
        },
      }
    : undefined,
  // Served under /apps/fuzex/ in prod (remoteEntry at /apps/fuzex/remoteEntry.js) by
  // design-frames-service ITSELF — see server.js's WEBAPP_MOUNT. Same origin as the
  // API on purpose, which is what lets api.ts keep an empty base and work unchanged
  // behind local TLS and behind the prod ingress.
  //
  // This must stay in lockstep with THREE things that all name the same URL:
  // server.js's WEBAPP_MOUNT, and registration/manifest.json's
  // integration.remoteEntry. That manifest is written and pushed by this repo (from
  // the fail-closed init container in deploy/helm/fuzex) — an earlier version of this
  // comment said an orchestrator wrote it, which was true when FuzeX did not deploy
  // anything of its own and is not true now.
  base: '/apps/fuzex/',
  build: {
    target: 'esnext',
    minify: false,
    cssCodeSplit: false,
    // Output all chunks to dist/ directly (not dist/assets/) so remoteEntry.js
    // is served at /apps/fuzex/remoteEntry.js.
    assetsDir: '',
  },
  server: { host: '0.0.0.0', port: 4401, cors: true, strictPort: true },
  preview: { host: '127.0.0.1', port: 4402, cors: true, strictPort: true },
})
