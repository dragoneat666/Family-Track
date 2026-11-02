import { useState } from 'react';

// Shared helper for the grown-up tabs: run an API call, show errors, and
// go back to "Who are you?" if this device got signed out.
export function useParentCall(onAuthLost) {
  const [error, setError] = useState('');
  async function call(fn) {
    setError('');
    try {
      return await fn();
    } catch (e) {
      if (e.status === 401) onAuthLost?.();
      else setError(e.message);
      return undefined;
    }
  }
  return { error, setError, call };
}
