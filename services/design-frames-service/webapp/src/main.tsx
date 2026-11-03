import React from 'react'
import ReactDOM from 'react-dom/client'
// Global DS stylesheet — load once so tokens/CSS-vars are present. When
// mounted inside the FuzeFront host shell the host already sets these vars on
// :root; importing here keeps this remote fully self-contained for standalone
// dev/preview too (the DS is bundled into this remote, not shared — see
// vite.config.ts).
import '@izzywdev/fuzefront-design-system/styles.css'
import { initBrowserTelemetry, initBrowserRum } from '@izzywdev/fuzefront-telemetry/browser'
import App from './App'

// Observability standard P29/P31-P36. Opt-in per deployment via build env;
// same-origin by default (traces -> /v1/traces, RUM -> /api/v1/rum), so no
// endpoint is hardcoded.
if (import.meta.env.VITE_TELEMETRY_ENABLED === 'true') {
  initBrowserTelemetry({
    serviceName: 'design-frames-webapp',
    serviceVersion: import.meta.env.VITE_APP_RELEASE,
  })
  initBrowserRum({ serviceName: 'design-frames-webapp', release: import.meta.env.VITE_APP_RELEASE })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
