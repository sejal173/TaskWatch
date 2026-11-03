import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import WorkflowsPage from './pages/WorkflowsPage';
import JobsPage from './pages/JobsPage';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Protected routes wrapped in AppLayout */}
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/workflows" element={<WorkflowsPage />} />
        <Route path="/jobs" element={<JobsPage />} />
      </Route>

      {/* Catch-all route */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
