import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
// Before styles.css so the faces are declared by the time anything uses them.
import './fonts.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
