import { useState } from 'react';

// Shared helper for the parent tabs: run an API call, show errors, and go
// back to the PIN screen when the parent session has timed out.
export function useParentCall(onLocked) {
  const [error, setError] = useState('');
  async function call(fn) {
    setError('');
    try {
      return await fn();
    } catch (e) {
      if (e.data?.parentLocked) onLocked();
      else setError(e.message);
      return undefined;
    }
  }
  return { error, setError, call };
}
