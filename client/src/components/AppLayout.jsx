import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth();

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
            <div className="user-meta">
              <span className="user-name">{user?.name || 'User'}</span>
              <span className="user-role-badge">{user?.role || 'viewer'}</span>
            </div>
            <button type="button" onClick={logout} className="btn-secondary btn-logout">
              Log Out
            </button>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="content-area">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

