import React, { useState } from 'react';
import LoginPage from './LoginPage.jsx';
import { isAuthEnabled, isAuthenticated } from './auth.js';

/**
 * Runtime auth gate. When the deployment does not opt in, the app renders
 * exactly as before. When it does, the app is hidden behind the login page
 * until a token is present in sessionStorage.
 */
export default function AuthGate({ children }) {
  const enabled = isAuthEnabled();
  const [authenticated, setAuthenticated] = useState(() => isAuthenticated());

  if (!enabled) return children;
  if (!authenticated) {
    return <LoginPage onAuthenticated={() => setAuthenticated(true)} />;
  }
  return children;
}
