/**
 * KuroToolbar — shared navigation bar across all KURO surfaces.
 * Renders the GlassCube logomark + "KURO" brand word with consistent
 * glass-blur treatment. Used by HomePage, NeuroPage, and any future
 * public-facing page that needs the cross-site nav.
 *
 * Props:
 *   showBack  — renders "← KURO" as a Link to "/" instead of a plain span
 *   right     — ReactNode rendered in the right slot (links, badges, etc.)
 */
import React from 'react';
import { Link } from 'react-router-dom';
import GlassCube from './ui/GlassCube';

export default function KuroToolbar({ showBack = false, right = null }) {
  const brand = showBack ? (
    <Link to="/" className="kg-brand kg-brand-back">
      <GlassCube size="nav" />
      <span className="kg-brand-word">← KURO</span>
    </Link>
  ) : (
    <span className="kg-brand">
      <GlassCube size="nav" />
      <span className="kg-brand-word">KURO</span>
    </span>
  );

  return (
    <nav className="kg-nav">
      {brand}
      {right && <div className="kg-nav-right">{right}</div>}
    </nav>
  );
}
