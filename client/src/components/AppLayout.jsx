import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLiveEvents } from '../hooks/useLiveEvents';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { isConnected, toast, clearToast } = useLiveEvents();
  const location = useLocation();

  const getPageTitle = (pathname) => {
    if (pathname === '/') return 'Dashboard';
    if (pathname.startsWith('/workflows')) return 'Workflows';
    if (pathname.startsWith('/jobs')) return 'Jobs';
    if (pathname.startsWith('/queues')) return 'Queues';
    if (pathname.startsWith('/audit')) return 'Audit Trail';
    return 'Dashboard';
  };

  return (
    <div className="app-layout">
      {/* Fixed Left Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo" aria-hidden="true">⏱</span>
          <h2>TaskWatch</h2>
        </div>

        <nav className="sidebar-nav" aria-label="Main Navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">📊</span>
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/workflows"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">⚡</span>
            <span>Workflows</span>
          </NavLink>

          <NavLink
            to="/jobs"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">📋</span>
            <span>Jobs</span>
          </NavLink>

          {(user?.role === 'admin' || user?.role === 'operator') && (
            <NavLink
              to="/queues"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon" aria-hidden="true">⚙️</span>
              <span>Queues</span>
            </NavLink>
          )}

          {user?.role === 'admin' && (
            <NavLink
              to="/audit"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon" aria-hidden="true">🔍</span>
              <span>Audit</span>
            </NavLink>
          )}
        </nav>
      </aside>

      {/* Main Container */}
      <div className="main-container">
        {/* Top Navbar */}
        <header className="topbar">
          <div className="topbar-left">
            <h1 className="page-title">{getPageTitle(location.pathname)}</h1>
          </div>
          <div className="topbar-right">
            <div
              className={`live-indicator ${isConnected ? 'live' : 'reconnecting'}`}
              title={isConnected ? 'Socket.IO live' : 'Socket.IO disconnected'}
              aria-label={isConnected ? 'Connected to realtime updates' : 'Disconnected from realtime updates'}
            >
              <span className="live-dot" aria-hidden="true" />
              <span className="live-text">{isConnected ? 'Live' : 'Offline'}</span>
            </div>
            <div className="user-meta">
              <span className="user-name">{user?.name || 'User'}</span>
              <span className="user-role-badge">{user?.role || 'viewer'}</span>
            </div>
            <button type="button" onClick={logout} className="btn-secondary btn-logout">
              Log Out
            </button>
          </div>
        </header>

        {/* SLA Breach Alert Banner */}
        {toast && (
          <div className="sla-toast-banner" role="alert">
            <span className="sla-toast-icon" aria-hidden="true">⚠️</span>
            <span className="sla-toast-msg">{toast}</span>
            <button
              type="button"
              onClick={clearToast}
              className="sla-toast-close"
              aria-label="Dismiss alert"
            >
              ×
            </button>
          </div>
        )}

        {/* Dynamic Page Content */}
        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
