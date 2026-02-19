/**
 * KURO::ADMIN Panel — read-only user list, admin whoami
 * Guarded by /api/admin/* server-side (403 for non-admins)
 */
import React, { useState, useEffect } from 'react';

export default function AdminApp() {
  const [whoami, setWhoami] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [wRes, uRes] = await Promise.all([
          fetch('/api/admin/whoami', { credentials: 'include' }),
          fetch('/api/admin/users', { credentials: 'include' }),
        ]);
        if (!wRes.ok) throw new Error(wRes.status === 403 ? 'Not an admin' : 'Auth failed');
        setWhoami(await wRes.json());
        if (uRes.ok) setUsers((await uRes.json()).users || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div style={S.center}>Loading...</div>;
  if (error) return <div style={S.center}><span style={{color:'#ff375f'}}>{error}</span></div>;

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <span style={S.badge}>ADMIN</span>
        <span style={S.email}>{whoami?.email}</span>
        <span style={S.tier}>{whoami?.tier}</span>
      </div>
      <div style={S.section}>Users ({users.length})</div>
      <div style={S.table}>
        <div style={S.row}>
          <span style={{...S.cell,fontWeight:600,color:'rgba(255,255,255,0.5)'}}>Email</span>
          <span style={{...S.cellSm,fontWeight:600,color:'rgba(255,255,255,0.5)'}}>Tier</span>
          <span style={{...S.cellSm,fontWeight:600,color:'rgba(255,255,255,0.5)'}}>Admin</span>
          <span style={{...S.cellSm,fontWeight:600,color:'rgba(255,255,255,0.5)'}}>Verified</span>
        </div>
        {users.map(u => (
          <div key={u.id} style={S.row}>
            <span style={S.cell}>{u.email}</span>
            <span style={S.cellSm}>{u.tier}</span>
            <span style={S.cellSm}>{u.is_admin ? '✓' : ''}</span>
            <span style={S.cellSm}>{u.email_verified ? '✓' : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const S = {
  wrap: { padding: 16, height: '100%', overflow: 'auto', fontFamily: 'inherit', color: '#fff' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'rgba(255,255,255,0.4)', fontSize: 14 },
  header: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' },
  badge: { fontSize: 10, fontWeight: 700, letterSpacing: 2, background: 'rgba(168,85,247,0.2)', color: '#a855f7', padding: '2px 8px', borderRadius: 6 },
  email: { fontSize: 13, color: 'rgba(255,255,255,0.7)', flex: 1 },
  tier: { fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' },
  section: { fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', marginBottom: 8, letterSpacing: 1 },
  table: { display: 'flex', flexDirection: 'column', gap: 1 },
  row: { display: 'flex', gap: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, fontSize: 12 },
  cell: { flex: 1, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellSm: { width: 60, textAlign: 'center', color: 'rgba(255,255,255,0.5)' },
};
