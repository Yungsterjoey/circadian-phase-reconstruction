/**
 * PayNav: context & hook for the persistent two-button dock.
 * Each screen calls usePayNav({ back, next }) in useEffect to set its config.
 * The <PayNav/> dock reads this and renders glass buttons at the bottom.
 *
 *   back: { label?: string, onClick?: () => void }
 *   next: { label?: string, onClick?: () => void, loading?: bool, variant?: 'primary'|'ghost' }
 *
 * Omit onClick → button renders greyed/disabled. Label stays for context.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const PayNavContext = createContext(null);

export function PayNavProvider({ children }) {
  const [state, setState] = useState({
    back: { label: 'Back' },
    next: { label: 'Next' },
  });
  return (
    <PayNavContext.Provider value={{ state, setState }}>
      {children}
    </PayNavContext.Provider>
  );
}

export function usePayNavState() {
  const ctx = useContext(PayNavContext);
  if (!ctx) throw new Error('usePayNavState must be used inside PayNavProvider');
  return ctx.state;
}

/**
 * Register this screen's nav config. Call it with a config object; re-runs
 * whenever deps change (pass your own deps array like useEffect).
 *
 *   usePayNav({
 *     back: { label: 'Cancel', onClick: () => nav(-1) },
 *     next: { label: 'Link Card', onClick: submit, loading: submitting },
 *   }, [submitting]);
 */
export function usePayNav(config, deps = []) {
  const ctx = useContext(PayNavContext);
  if (!ctx) throw new Error('usePayNav must be used inside PayNavProvider');
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    ctx.setState({
      back: config?.back || { label: 'Back' },
      next: config?.next || { label: 'Next' },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
