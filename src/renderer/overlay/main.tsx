import React from 'react'
import ReactDOM from 'react-dom/client'
// theme.css first: the panel's own rule makes the page background transparent
// so the window's rounded corners show, and it has to come after the theme's
// opaque `body` background to win. Vite injects dev CSS in import order.
import '../theme.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
