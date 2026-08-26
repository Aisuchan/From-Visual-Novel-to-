import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Bundled locally rather than pulled from a CDN — the renderer CSP only allows
// 'self' for scripts/fonts (plus Google Fonts for the theme faces).
import '@fortawesome/fontawesome-free/css/all.min.css'
import '../theme.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
