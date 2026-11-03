import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>TaskWatch</h1>
        <div className="user-controls">
          <span className="user-email">{user?.email}</span>
          <button type="button" onClick={logout} className="btn-secondary">
            Log Out
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="welcome-card">
          <h2>Welcome, {user?.name || 'User'}</h2>
          <p>Role: <strong>{user?.role || 'viewer'}</strong></p>
          <p className="placeholder-text">
            Workflow automation and job monitoring dashboard will be built here in subsequent steps.
          </p>
        </div>
      </main>
    </div>
  );
}

