import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import { installAuthInterceptors, isAuthEnabled } from './auth.js';

// The /auth-config.js script in index.html runs before this bundle, so the
// runtime flag is available here. With no config (local dev/test) the shell
// renders directly and no fetch/XHR hooks are installed.
if (isAuthEnabled()) installAuthInterceptors();

createRoot(document.getElementById('root')).render(
  <AuthGate>
    <App />
  </AuthGate>
);
