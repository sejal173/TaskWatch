import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLiveEvents } from '../hooks/useLiveEvents';

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { isConnected, toast, clearToast } = useLiveEvents();

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-logo">⏱</span>
          <h2>TaskWatch</h2>
        </div>

        <nav className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </NavLink>

          <NavLink
            to="/workflows"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">⚡</span>
            <span>Workflows</span>
          </NavLink>

          <NavLink
            to="/jobs"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">📋</span>
            <span>Jobs</span>
          </NavLink>

          {(user?.role === 'admin' || user?.role === 'operator') && (
            <NavLink
              to="/queues"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">⚙️</span>
              <span>Queues</span>
            </NavLink>
          )}

          {user?.role === 'admin' && (
            <NavLink
              to="/audit"
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">🔍</span>
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
            <span className="system-tag">Enterprise Workflow Engine</span>
          </div>
          <div className="topbar-right">
            <div className={`live-indicator ${isConnected ? 'live' : 'reconnecting'}`}>
              <span className="live-dot" />
              <span className="live-text">{isConnected ? 'Live' : 'Reconnecting'}</span>
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
          <div className="sla-toast-banner">
            <span className="sla-toast-icon">⚠️</span>
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

