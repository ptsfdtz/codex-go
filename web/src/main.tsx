import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InstallProvider } from './features/InstallApp';
import { initializePwa } from './pwa';
import { initializeMotion } from './motion';
import './motion.css';

// Apply the persisted palette before React mounts to avoid a light flash.
try {
  document.documentElement.dataset.theme = localStorage.getItem('agentdeck.web.theme') || 'system';
} catch {
  // System palette remains available when storage is blocked.
}

initializePwa();
initializeMotion();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InstallProvider>
      <App />
    </InstallProvider>
  </React.StrictMode>,
);
