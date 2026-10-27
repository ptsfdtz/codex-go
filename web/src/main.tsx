import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { InstallProvider } from './features/InstallApp';
import { initializePwa } from './pwa';
import { initializeMotion } from './motion';
import './motion.css';

initializePwa();
initializeMotion();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InstallProvider>
      <App />
    </InstallProvider>
  </React.StrictMode>,
);
