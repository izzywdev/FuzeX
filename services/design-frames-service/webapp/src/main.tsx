import React from 'react'
import ReactDOM from 'react-dom/client'
// Global DS stylesheet — load once so tokens/CSS-vars are present. When
// mounted inside the FuzeFront host shell the host already sets these vars on
// :root; importing here keeps this remote fully self-contained for standalone
// dev/preview too (the DS is bundled into this remote, not shared — see
// vite.config.ts).
import '@izzywdev/fuzefront-design-system/styles.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
