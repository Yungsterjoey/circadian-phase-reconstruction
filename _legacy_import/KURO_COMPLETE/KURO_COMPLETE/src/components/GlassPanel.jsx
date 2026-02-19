import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Search, Settings, Power, LogOut, User, Plus, FileText, FolderOpen, 
  Archive, Download, Upload, Trash2, Pin, PinOff, Info, ExternalLink,
  MessageSquare, Globe, Code, Shield, Cpu, Image, Zap, Clock, ChevronRight,
  X, MoreHorizontal, Circle, Check, AlertCircle
} from 'lucide-react';
import { useOSStore } from '../stores/osStore';

// ═══════════════════════════════════════════════════════════════════════════
// GLASS PANEL - Full OS Start Menu
// ═══════════════════════════════════════════════════════════════════════════

// Artifact Storage Manager
const ArtifactManager = {
  STORAGE_KEY: 'kuro_artifacts',
  
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch { return []; }
  },
  
  save(artifact) {
    const artifacts = this.getAll();
    const newArtifact = {
      id: `artifact_${Date.now()}`,
      ...artifact,
      created: new Date().toISOString(),
    };
    artifacts.unshift(newArtifact);
    // Keep last 50
    if (artifacts.length > 50) artifacts.pop();
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(artifacts));
    return newArtifact;
  },
  
  delete(id) {
    const artifacts = this.getAll().filter(a => a.id !== id);
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(artifacts));
  },
  
  export(artifact) {
    const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.name || 'kuro-artifact'}-${Date.now()}.kuro`;
    a.click();
    URL.revokeObjectURL(url);
  },
  
  async import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const artifact = JSON.parse(e.target.result);
          const saved = this.save(artifact);
          resolve(saved);
        } catch (err) {
          reject(new Error('Invalid artifact file'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }
};

// Recent Files Manager
const RecentFilesManager = {
  STORAGE_KEY: 'kuro_recent_files',
  
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
    } catch { return []; }
  },
  
  add(file) {
    const files = this.getAll().filter(f => f.path !== file.path);
    files.unshift({ ...file, accessed: new Date().toISOString() });
    if (files.length > 20) files.pop();
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(files));
  },
  
  clear() {
    localStorage.setItem(this.STORAGE_KEY, '[]');
  }
};

// Context Menu Component
const ContextMenu = ({ x, y, items, onClose }) => {
  const menuRef = useRef(null);
  
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };
  }, [onClose]);
  
  return (
    <div 
      ref={menuRef}
      className="context-menu"
      style={{ 
        position: 'fixed', 
        left: Math.min(x, window.innerWidth - 180),
        top: Math.min(y, window.innerHeight - 200),
        zIndex: 10000 
      }}
    >
      {items.map((item, i) => 
        item.divider ? (
          <div key={i} className="context-divider" />
        ) : (
          <button
            key={i}
            className={`context-item ${item.danger ? 'danger' : ''}`}
            onClick={() => { item.onClick?.(); onClose(); }}
            disabled={item.disabled}
          >
            {item.icon && <item.icon size={14} />}
            <span>{item.label}</span>
            {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
          </button>
        )
      )}
    </div>
  );
};

// App Tile Component with Long Press Context Menu
const AppTile = ({ app, isPinned, onOpen, onPin, onUnpin, onInfo }) => {
  const [contextMenu, setContextMenu] = useState(null);
  const longPressRef = useRef(null);
  const [pressing, setPressing] = useState(false);
  
  const handleTouchStart = (e) => {
    setPressing(true);
    longPressRef.current = setTimeout(() => {
      const touch = e.touches[0];
      setContextMenu({ x: touch.clientX, y: touch.clientY });
      setPressing(false);
    }, 500);
  };
  
  const handleTouchEnd = () => {
    setPressing(false);
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };
  
  const handleContextMenu = (e) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };
  
  const Icon = app.icon || Circle;
  
  return (
    <>
      <button
        className={`app-tile ${pressing ? 'pressing' : ''}`}
        onClick={onOpen}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div className="tile-icon">
          <Icon size={28} />
        </div>
        <span className="tile-name">{app.name}</span>
        {isPinned && <Pin size={10} className="pinned-badge" />}
      </button>
      
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Open', icon: ExternalLink, onClick: onOpen },
            { divider: true },
            isPinned
              ? { label: 'Unpin from Dock', icon: PinOff, onClick: onUnpin }
              : { label: 'Pin to Dock', icon: Pin, onClick: onPin },
            { label: 'App Info', icon: Info, onClick: onInfo },
            { divider: true },
            { label: 'Uninstall', icon: Trash2, danger: true, disabled: app.system }
          ]}
        />
      )}
    </>
  );
};

// Artifact Tile Component
const ArtifactTile = ({ artifact, onExport, onDelete }) => {
  const [contextMenu, setContextMenu] = useState(null);
  
  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };
  
  return (
    <>
      <div 
        className="artifact-tile"
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}
      >
        <Archive size={16} className="artifact-icon" />
        <div className="artifact-info">
          <span className="artifact-name">{artifact.name || 'Untitled Artifact'}</span>
          <span className="artifact-time">{timeAgo(artifact.created)}</span>
        </div>
        <button className="artifact-action" onClick={() => onExport(artifact)}>
          <Download size={14} />
        </button>
      </div>
      
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: 'Export', icon: Download, onClick: () => onExport(artifact) },
            { divider: true },
            { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete(artifact.id) }
          ]}
        />
      )}
    </>
  );
};

// Main GlassPanel Component
export default function GlassPanel() {
  const { 
    apps, 
    glassPanelOpen, 
    toggleGlassPanel, 
    openApp, 
    pinnedApps, 
    togglePin 
  } = useOSStore();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('apps'); // 'apps' | 'artifacts' | 'files'
  const [artifacts, setArtifacts] = useState([]);
  const [recentFiles, setRecentFiles] = useState([]);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [notification, setNotification] = useState(null);
  const importRef = useRef(null);
  
  // Load artifacts and recent files
  useEffect(() => {
    if (glassPanelOpen) {
      setArtifacts(ArtifactManager.getAll());
      setRecentFiles(RecentFilesManager.getAll());
    }
  }, [glassPanelOpen]);
  
  // Filter apps by search
  const filteredApps = apps.filter(app => 
    app.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  const pinnedAppsList = pinnedApps.map(id => apps.find(a => a.id === id)).filter(Boolean);
  const unpinnedApps = filteredApps.filter(app => !pinnedApps.includes(app.id));
  
  // Handlers
  const handleOpenApp = (app) => {
    openApp(app.id);
    toggleGlassPanel();
  };
  
  const handleLogout = () => {
    // Clear session data
    localStorage.removeItem('kuro_token');
    localStorage.removeItem('exe_convs');
    localStorage.removeItem('exe_settings');
    // Reload to lock screen
    window.location.reload();
  };
  
  const handleExportArtifact = (artifact) => {
    ArtifactManager.export(artifact);
    setNotification({ type: 'success', message: 'Artifact exported' });
    setTimeout(() => setNotification(null), 2000);
  };
  
  const handleDeleteArtifact = (id) => {
    ArtifactManager.delete(id);
    setArtifacts(ArtifactManager.getAll());
    setNotification({ type: 'success', message: 'Artifact deleted' });
    setTimeout(() => setNotification(null), 2000);
  };
  
  const handleImportArtifact = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    try {
      await ArtifactManager.import(file);
      setArtifacts(ArtifactManager.getAll());
      setNotification({ type: 'success', message: 'Artifact imported' });
    } catch (err) {
      setNotification({ type: 'error', message: err.message });
    }
    setTimeout(() => setNotification(null), 2000);
    e.target.value = '';
  };
  
  const handleCreateArtifact = () => {
    const artifact = ArtifactManager.save({
      name: `New Artifact ${new Date().toLocaleDateString()}`,
      type: 'kuro-artifact',
      version: '1.0',
      content: '',
      metadata: {}
    });
    setArtifacts(ArtifactManager.getAll());
    setNotification({ type: 'success', message: 'Artifact created' });
    setTimeout(() => setNotification(null), 2000);
  };
  
  if (!glassPanelOpen) return null;
  
  return (
    <>
      {/* Backdrop */}
      <div className="panel-backdrop" onClick={toggleGlassPanel} />
      
      {/* Main Panel */}
      <div className="glass-panel">
        {/* Header */}
        <div className="panel-header">
          <div className="header-user">
            <div className="user-avatar">
              <User size={20} />
            </div>
            <div className="user-info">
              <span className="user-name">KURO OS</span>
              <span className="user-status">Sovereign Mode</span>
            </div>
          </div>
          <div className="header-actions">
            <button className="header-btn" onClick={() => openApp('kuro.settings')} title="Settings">
              <Settings size={18} />
            </button>
            <button className="header-btn danger" onClick={() => setShowLogoutConfirm(true)} title="Logout">
              <Power size={18} />
            </button>
          </div>
        </div>
        
        {/* Search */}
        <div className="panel-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search apps, files, commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>
        
        {/* Quick Actions */}
        <div className="quick-actions">
          <button className="quick-btn" onClick={() => { openApp('kuro.executioner'); toggleGlassPanel(); }}>
            <MessageSquare size={18} />
            <span>New Chat</span>
          </button>
          <button className="quick-btn" onClick={handleCreateArtifact}>
            <Archive size={18} />
            <span>Artifact</span>
          </button>
          <button className="quick-btn" onClick={() => { openApp('kuro.files'); toggleGlassPanel(); }}>
            <FolderOpen size={18} />
            <span>Files</span>
          </button>
          <button className="quick-btn" onClick={() => { openApp('kuro.settings'); toggleGlassPanel(); }}>
            <Settings size={18} />
            <span>Settings</span>
          </button>
        </div>
        
        {/* Tabs */}
        <div className="panel-tabs">
          <button className={`tab ${activeTab === 'apps' ? 'active' : ''}`} onClick={() => setActiveTab('apps')}>
            Apps
          </button>
          <button className={`tab ${activeTab === 'artifacts' ? 'active' : ''}`} onClick={() => setActiveTab('artifacts')}>
            Artifacts
            {artifacts.length > 0 && <span className="tab-badge">{artifacts.length}</span>}
          </button>
          <button className={`tab ${activeTab === 'files' ? 'active' : ''}`} onClick={() => setActiveTab('files')}>
            Recent
          </button>
        </div>
        
        {/* Content */}
        <div className="panel-content">
          {activeTab === 'apps' && (
            <>
              {/* Pinned Apps */}
              {pinnedAppsList.length > 0 && (
                <div className="section">
                  <div className="section-header">
                    <span>Pinned</span>
                  </div>
                  <div className="apps-grid">
                    {pinnedAppsList.map(app => (
                      <AppTile
                        key={app.id}
                        app={app}
                        isPinned={true}
                        onOpen={() => handleOpenApp(app)}
                        onUnpin={() => togglePin(app.id)}
                        onInfo={() => console.log('Info:', app)}
                      />
                    ))}
                  </div>
                </div>
              )}
              
              {/* All Apps */}
              <div className="section">
                <div className="section-header">
                  <span>All Apps</span>
                </div>
                <div className="apps-grid">
                  {unpinnedApps.map(app => (
                    <AppTile
                      key={app.id}
                      app={app}
                      isPinned={false}
                      onOpen={() => handleOpenApp(app)}
                      onPin={() => togglePin(app.id)}
                      onInfo={() => console.log('Info:', app)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
          
          {activeTab === 'artifacts' && (
            <div className="section">
              <div className="section-header">
                <span>KURO Artifacts</span>
                <div className="section-actions">
                  <button className="section-btn" onClick={handleCreateArtifact}>
                    <Plus size={14} />
                  </button>
                  <button className="section-btn" onClick={() => importRef.current?.click()}>
                    <Upload size={14} />
                  </button>
                  <input
                    ref={importRef}
                    type="file"
                    accept=".kuro,.json"
                    hidden
                    onChange={handleImportArtifact}
                  />
                </div>
              </div>
              
              {artifacts.length === 0 ? (
                <div className="empty-state">
                  <Archive size={32} />
                  <span>No artifacts yet</span>
                  <button onClick={handleCreateArtifact}>Create your first artifact</button>
                </div>
              ) : (
                <div className="artifacts-list">
                  {artifacts.map(artifact => (
                    <ArtifactTile
                      key={artifact.id}
                      artifact={artifact}
                      onExport={handleExportArtifact}
                      onDelete={handleDeleteArtifact}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          
          {activeTab === 'files' && (
            <div className="section">
              <div className="section-header">
                <span>Recent Files</span>
                {recentFiles.length > 0 && (
                  <button className="section-btn" onClick={() => { RecentFilesManager.clear(); setRecentFiles([]); }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              
              {recentFiles.length === 0 ? (
                <div className="empty-state">
                  <FileText size={32} />
                  <span>No recent files</span>
                </div>
              ) : (
                <div className="files-list">
                  {recentFiles.map((file, i) => (
                    <div key={i} className="file-item">
                      <FileText size={16} />
                      <div className="file-info">
                        <span className="file-name">{file.name}</span>
                        <span className="file-path">{file.path}</span>
                      </div>
                      <Clock size={12} className="file-time" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="panel-footer">
          <span className="footer-info">KURO OS v3.1 • 5.9.83.244</span>
          <button className="footer-logout" onClick={() => setShowLogoutConfirm(true)}>
            <LogOut size={14} />
            <span>Logout</span>
          </button>
        </div>
        
        {/* Notification Toast */}
        {notification && (
          <div className={`notification ${notification.type}`}>
            {notification.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>{notification.message}</span>
          </div>
        )}
      </div>
      
      {/* Logout Confirmation */}
      {showLogoutConfirm && (
        <div className="logout-modal-backdrop" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-modal" onClick={e => e.stopPropagation()}>
            <Power size={32} className="logout-icon" />
            <h3>Logout?</h3>
            <p>Your session data will be cleared.</p>
            <div className="logout-actions">
              <button className="btn-cancel" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="btn-logout" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        .panel-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
          backdrop-filter: blur(4px);
          z-index: 1999;
          animation: fadeIn 0.2s ease;
        }
        
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        
        .glass-panel {
          position: fixed;
          bottom: 80px;
          left: 50%;
          transform: translateX(-50%);
          width: 420px;
          max-width: calc(100vw - 24px);
          max-height: calc(100vh - 120px);
          max-height: calc(100dvh - 120px);
          background: rgba(16, 16, 20, 0.95);
          backdrop-filter: blur(40px) saturate(1.5);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          z-index: 2000;
          animation: panelSlideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05) inset;
        }
        
        @keyframes panelSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(20px) scale(0.95); }
          to { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        
        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .header-user { display: flex; align-items: center; gap: 12px; }
        
        .user-avatar {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: linear-gradient(135deg, #6366f1, #a855f7);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        
        .user-info { display: flex; flex-direction: column; }
        .user-name { font-weight: 600; font-size: 14px; color: #fff; }
        .user-status { font-size: 11px; color: rgba(255, 255, 255, 0.4); }
        
        .header-actions { display: flex; gap: 6px; }
        
        .header-btn {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.05);
          border: none;
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }
        
        .header-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
        .header-btn.danger:hover { background: rgba(239, 68, 68, 0.2); color: #ef4444; }
        
        .panel-search {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 12px 16px;
          padding: 10px 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 12px;
          color: rgba(255, 255, 255, 0.4);
        }
        
        .panel-search input {
          flex: 1;
          background: transparent;
          border: none;
          color: #fff;
          font-size: 14px;
          outline: none;
        }
        
        .panel-search input::placeholder { color: rgba(255, 255, 255, 0.3); }
        
        .search-clear {
          padding: 4px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
        }
        
        .quick-actions {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          padding: 0 16px 12px;
        }
        
        .quick-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 12px 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          color: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          font-size: 10px;
          transition: all 0.2s ease;
        }
        
        .quick-btn:hover {
          background: rgba(168, 85, 247, 0.1);
          border-color: rgba(168, 85, 247, 0.2);
          color: #a855f7;
          transform: translateY(-2px);
        }
        
        .panel-tabs {
          display: flex;
          gap: 4px;
          padding: 0 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .tab {
          position: relative;
          padding: 10px 16px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.5);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .tab:hover { color: rgba(255, 255, 255, 0.8); }
        
        .tab.active {
          color: #a855f7;
        }
        
        .tab.active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 0;
          right: 0;
          height: 2px;
          background: #a855f7;
          border-radius: 1px;
        }
        
        .tab-badge {
          margin-left: 6px;
          padding: 2px 6px;
          background: rgba(168, 85, 247, 0.2);
          border-radius: 10px;
          font-size: 10px;
          color: #a855f7;
        }
        
        .panel-content {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 12px 0;
          -webkit-overflow-scrolling: touch;
        }
        
        .section { padding: 0 16px 16px; }
        
        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .section-actions { display: flex; gap: 4px; }
        
        .section-btn {
          padding: 6px;
          background: rgba(255, 255, 255, 0.05);
          border: none;
          border-radius: 6px;
          color: rgba(255, 255, 255, 0.5);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .section-btn:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
        
        .apps-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
        }
        
        .app-tile {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 12px 8px;
          background: transparent;
          border: none;
          border-radius: 12px;
          color: rgba(255, 255, 255, 0.8);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .app-tile:hover {
          background: rgba(255, 255, 255, 0.06);
          transform: scale(1.05);
        }
        
        .app-tile:active, .app-tile.pressing {
          transform: scale(0.95);
          background: rgba(168, 85, 247, 0.15);
        }
        
        .tile-icon {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2));
          border: 1px solid rgba(255, 255, 255, 0.08);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .tile-name {
          font-size: 10px;
          text-align: center;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .pinned-badge {
          position: absolute;
          top: 8px;
          right: 8px;
          color: #a855f7;
        }
        
        .artifacts-list, .files-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        
        .artifact-tile, .file-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          transition: all 0.2s ease;
        }
        
        .artifact-tile:hover, .file-item:hover {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(168, 85, 247, 0.2);
        }
        
        .artifact-icon { color: #a855f7; flex-shrink: 0; }
        
        .artifact-info, .file-info { flex: 1; min-width: 0; }
        
        .artifact-name, .file-name {
          display: block;
          font-size: 13px;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        
        .artifact-time, .file-path {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
        }
        
        .artifact-action {
          padding: 8px;
          background: transparent;
          border: none;
          color: rgba(255, 255, 255, 0.4);
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.2s ease;
        }
        
        .artifact-action:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
        
        .file-time { color: rgba(255, 255, 255, 0.3); }
        
        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 40px 20px;
          color: rgba(255, 255, 255, 0.3);
          text-align: center;
        }
        
        .empty-state button {
          padding: 10px 20px;
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid rgba(168, 85, 247, 0.2);
          border-radius: 10px;
          color: #a855f7;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s ease;
        }
        
        .empty-state button:hover { background: rgba(168, 85, 247, 0.2); }
        
        .panel-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          background: rgba(0, 0, 0, 0.2);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
        }
        
        .footer-info { font-size: 10px; color: rgba(255, 255, 255, 0.3); }
        
        .footer-logout {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 8px;
          color: #ef4444;
          cursor: pointer;
          font-size: 11px;
          transition: all 0.2s ease;
        }
        
        .footer-logout:hover { background: rgba(239, 68, 68, 0.2); }
        
        .notification {
          position: absolute;
          bottom: 70px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: rgba(34, 197, 94, 0.15);
          border: 1px solid rgba(34, 197, 94, 0.3);
          border-radius: 10px;
          color: #22c55e;
          font-size: 12px;
          animation: notifIn 0.3s ease;
        }
        
        .notification.error {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.3);
          color: #ef4444;
        }
        
        @keyframes notifIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } }
        
        .context-menu {
          background: rgba(20, 20, 24, 0.98);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 6px;
          min-width: 160px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
          animation: ctxIn 0.15s ease;
        }
        
        @keyframes ctxIn { from { opacity: 0; transform: scale(0.95); } }
        
        .context-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: none;
          border-radius: 8px;
          color: rgba(255, 255, 255, 0.8);
          font-size: 12px;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s ease;
        }
        
        .context-item:hover { background: rgba(255, 255, 255, 0.08); }
        .context-item:disabled { opacity: 0.4; cursor: not-allowed; }
        .context-item.danger { color: #ef4444; }
        .context-item.danger:hover { background: rgba(239, 68, 68, 0.15); }
        .context-item .shortcut { margin-left: auto; color: rgba(255, 255, 255, 0.3); font-size: 10px; }
        
        .context-divider { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 4px 0; }
        
        .logout-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          z-index: 3000;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: fadeIn 0.2s ease;
        }
        
        .logout-modal {
          background: rgba(20, 20, 24, 0.98);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 20px;
          padding: 32px;
          text-align: center;
          max-width: 300px;
          animation: modalIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        
        @keyframes modalIn { from { opacity: 0; transform: scale(0.9); } }
        
        .logout-icon { color: #ef4444; margin-bottom: 16px; }
        .logout-modal h3 { margin: 0 0 8px; font-size: 18px; color: #fff; }
        .logout-modal p { margin: 0 0 24px; font-size: 13px; color: rgba(255, 255, 255, 0.5); }
        
        .logout-actions { display: flex; gap: 12px; }
        
        .btn-cancel, .btn-logout {
          flex: 1;
          padding: 12px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .btn-cancel {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
        }
        
        .btn-cancel:hover { background: rgba(255, 255, 255, 0.1); }
        
        .btn-logout {
          background: #ef4444;
          border: none;
          color: #fff;
        }
        
        .btn-logout:hover { background: #dc2626; }
        
        @media (max-width: 480px) {
          .glass-panel {
            bottom: 70px;
            width: calc(100vw - 16px);
            max-height: calc(100vh - 100px);
            max-height: calc(100dvh - 100px);
            border-radius: 16px;
          }
          
          .apps-grid { grid-template-columns: repeat(4, 1fr); gap: 4px; }
          .app-tile { padding: 8px 4px; }
          .tile-icon { width: 40px; height: 40px; border-radius: 10px; }
          .tile-icon svg { width: 20px; height: 20px; }
          .tile-name { font-size: 9px; }
          .quick-actions { grid-template-columns: repeat(4, 1fr); gap: 6px; }
          .quick-btn { padding: 10px 6px; font-size: 9px; }
        }
        
        @supports (padding-bottom: env(safe-area-inset-bottom)) {
          .glass-panel { bottom: calc(80px + env(safe-area-inset-bottom)); }
          .panel-footer { padding-bottom: max(12px, env(safe-area-inset-bottom)); }
        }
      `}</style>
    </>
  );
}
