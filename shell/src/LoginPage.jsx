import React, { useState } from 'react';
import { login } from './auth.js';

function errorMessage(error) {
  if (error && error.code === 'invalid_grant') {
    return 'Invalid username or password.';
  }
  if (error && error.status === 401) {
    return 'Invalid username or password.';
  }
  return 'Unable to sign in. Check that the sign-in service is available and try again.';
}

export default function LoginPage({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError('');
    try {
      await login(username.trim(), password);
      if (onAuthenticated) onAuthenticated();
      else window.location.reload();
    } catch (loginError) {
      setError(errorMessage(loginError));
      setPending(false);
    }
  };

  return (
    <div className="eia-auth-page">
      <div className="eia-auth-panel">
        <div className="eia-auth-brand">
          <span className="eia-auth-mark" aria-hidden="true">EIA</span>
          <div>
            <strong>EIA Open Insurance</strong>
            <span>Claims &amp; Reinsurance Operations</span>
          </div>
        </div>

        <div className="eia-auth-card">
          <h1>Sign in to EIA Open Insurance</h1>
          <p className="eia-auth-lede">Use your adjuster credentials to open the operations workspace.</p>

          {error ? (
            <div className="eia-auth-error" role="alert">
              {error}
            </div>
          ) : null}

          <form onSubmit={submit} aria-label="Sign in" aria-busy={pending}>
            <div className="eia-auth-field">
              <label htmlFor="eia-username">Username</label>
              <input
                id="eia-username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                required
                disabled={pending}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div className="eia-auth-field">
              <label htmlFor="eia-password">Password</label>
              <input
                id="eia-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <button
              type="submit"
              className="eia-auth-submit"
              disabled={pending || !username.trim() || !password}
            >
              {pending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="eia-auth-hint">
            Local demo: <b>adjuster</b> / <b>password</b>
          </p>
        </div>

        <p className="eia-auth-footer">Local environment · Meridian Specialty</p>
      </div>
    </div>
  );
}
