/**
 * Tiny singleton for globally opening/closing the LegalModal.
 * Any component can call openLegalModal('terms') without prop-drilling.
 */
import { useEffect, useState } from 'react';

let current = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(current);
}

export function openLegalModal(id) {
  current = id;
  emit();
}

export function closeLegalModal() {
  current = null;
  emit();
}

export function useLegalModalState() {
  const [state, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => listeners.delete(setState);
  }, []);
  return state;
}
