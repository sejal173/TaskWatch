import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function WorkflowsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formError, setFormError] = useState('');
  const [actionMessage, setActionMessage] = useState({ type: '', text: '' });
  const [page, setPage] = useState(1);
  const limit = 10;

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [slaMinutes, setSlaMinutes] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [backoff, setBackoff] = useState('exponential');
  const [delayMs, setDelayMs] = useState(5000);
  const [steps, setSteps] = useState([
    { name: '', simulateFailure: false },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const canCreateOrRun = user?.role === 'admin' || user?.role === 'operator';
  const canDeactivate = user?.role === 'admin';

  // Fetch workflows
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['workflows', page, user?.role],
    queryFn: async () => {
      let url = `/workflows?page=${page}&limit=${limit}`;
      if (user?.role === 'admin') {
        url += '&includeInactive=true';
      }
      const res = await api.get(url);
      return res.data;
    },
  });

  const workflows = data?.items || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  // Step Management in Form
  const addStep = () => {
    setSteps((prev) => [...prev, { name: '', simulateFailure: false }]);
  };

  const removeStep = (index) => {
    if (steps.length <= 1) return;
    setSteps((prev) => prev.filter((_, idx) => idx !== index));
  };

  const updateStep = (index, field, value) => {
    setSteps((prev) =>
      prev.map((step, idx) => (idx === index ? { ...step, [field]: value } : step))
    );
  };

  // Submit New Workflow
  const handleCreateWorkflow = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!name.trim()) {
      setFormError('Workflow name is required');
      return;
    }

    const invalidStep = steps.some((s) => !s.name.trim());
    if (invalidStep) {
      setFormError('All steps must have a valid name');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        slaMinutes: slaMinutes !== '' && !isNaN(Number(slaMinutes)) ? Number(slaMinutes) : null,
        retryPolicy: {
          maxAttempts: Number(maxAttempts) || 3,
          backoff,
          delayMs: Number(delayMs) || 5000,
        },
        steps: steps.map((s, idx) => ({
          name: s.name.trim(),
          order: idx + 1,
          config: s.simulateFailure ? { simulateFailure: true } : {},
        })),
      };

      await api.post('/workflows', payload);
      setActionMessage({
        type: 'success',
        text: `Workflow "${name}" created successfully`,
      });

      // Reset form
      setName('');
      setDescription('');
      setSlaMinutes('');
      setMaxAttempts(3);
      setBackoff('exponential');
      setDelayMs(5000);
      setSteps([{ name: '', simulateFailure: false }]);
      setShowCreateModal(false);

      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      refetch();
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to create workflow');
    } finally {
      setSubmitting(false);
    }
  };

  // Run Workflow
  const handleRunWorkflow = async (workflowId, workflowName) => {
    setActionMessage({ type: '', text: '' });
    try {
      const res = await api.post('/jobs', { workflow: workflowId });
      setActionMessage({
        type: 'success',
        text: `Job triggered for "${workflowName}" (Job ID: ${res.data._id})`,
      });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['jobCount'] });
      await queryClient.invalidateQueries({ queryKey: ['recentJobs'] });
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to trigger job',
      });
    }
  };

  // Deactivate Workflow (Admin only)
  const handleDeactivate = async (workflowId, workflowName) => {
    if (!window.confirm(`Are you sure you want to deactivate workflow "${workflowName}"?`)) {
      return;
    }
    setActionMessage({ type: '', text: '' });
    try {
      await api.delete(`/workflows/${workflowId}`);
      setActionMessage({
        type: 'success',
        text: `Workflow "${workflowName}" deactivated`,
      });
      await queryClient.invalidateQueries({ queryKey: ['workflows'] });
      refetch();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.response?.data?.error || err.message || 'Failed to deactivate workflow',
      });
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h2>Workflows</h2>
          <p className="subtitle">Configured multi-step automated pipelines</p>
        </div>

        {canCreateOrRun && (
          <button
            type="button"
            className="btn-primary btn-new"
            onClick={() => setShowCreateModal((prev) => !prev)}
          >
            {showCreateModal ? 'Cancel' : '+ New Workflow'}
          </button>
        )}
      </div>

      {/* Global Action Messages */}
      {actionMessage.text && (
        <div
          className={
            actionMessage.type === 'error' ? 'error-message' : 'success-message'
          }
        >
          {actionMessage.text}
        </div>
      )}

      {/* New Workflow Form Container */}
      {showCreateModal && (
        <div className="section-card form-card">
          <div className="form-card-header">
            <h3>Define New Workflow</h3>
            <p>Configure automated pipeline parameters, retry behavior, and SLA</p>
          </div>

          {formError && <div className="error-message">{formError}</div>}

          <form onSubmit={handleCreateWorkflow}>
            <div className="form-row">
              <div className="form-group flex-2">
                <label htmlFor="wf-name">Workflow Name *</label>
                <input
                  id="wf-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Data Sync Pipeline"
                />
              </div>

              <div className="form-group flex-1">
                <label htmlFor="wf-sla">SLA Deadline (Minutes)</label>
                <input
                  id="wf-sla"
                  type="number"
                  min="1"
                  value={slaMinutes}
                  onChange={(e) => setSlaMinutes(e.target.value)}
                  placeholder="Optional (e.g. 15)"
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="wf-desc">Description</label>
              <input
                id="wf-desc"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of pipeline execution"
              />
            </div>

            {/* Retry Policy Sub-section */}
            <div className="form-fieldset">
              <legend>Retry & Resilience Policy</legend>
              <div className="form-row">
                <div className="form-group flex-1">
                  <label htmlFor="wf-attempts">Max Attempts (1-10)</label>
                  <input
                    id="wf-attempts"
                    type="number"
                    min="1"
                    max="10"
                    required
                    value={maxAttempts}
                    onChange={(e) => setMaxAttempts(e.target.value)}
                  />
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="wf-backoff">Backoff Type</label>
                  <select
                    id="wf-backoff"
                    value={backoff}
                    onChange={(e) => setBackoff(e.target.value)}
                    className="select-input"
                  >
                    <option value="exponential">Exponential</option>
                    <option value="fixed">Fixed</option>
                  </select>
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="wf-delay">Delay (ms)</label>
                  <input
                    id="wf-delay"
                    type="number"
                    min="0"
                    step="500"
                    required
                    value={delayMs}
                    onChange={(e) => setDelayMs(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Steps Section */}
            <div className="form-fieldset">
              <div className="steps-header">
                <legend>Execution Steps ({steps.length})</legend>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={addStep}
                >
                  + Add Step
                </button>
              </div>

              <div className="steps-list">
                {steps.map((step, idx) => (
                  <div key={idx} className="step-row">
                    <span className="step-badge">Step {idx + 1}</span>
                    <input
                      type="text"
                      required
                      placeholder={`Step ${idx + 1} Name`}
                      value={step.name}
                      onChange={(e) => updateStep(idx, 'name', e.target.value)}
                      className="step-name-input"
                    />
                    <label className="checkbox-label" title="Simulate an execution error at this step">
                      <input
                        type="checkbox"
                        checked={step.simulateFailure}
                        onChange={(e) =>
                          updateStep(idx, 'simulateFailure', e.target.checked)
                        }
                      />
                      <span>Simulate Failure</span>
                    </label>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        className="btn-icon btn-remove"
                        onClick={() => removeStep(idx)}
                        title="Remove Step"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting}
              >
                {submitting ? 'Creating...' : 'Create Workflow'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Workflows Table */}
      <div className="section-card">
        {isLoading ? (
          <div className="table-state-message">
            <div className="spinner" />
            <span>Loading workflows...</span>
          </div>
        ) : isError ? (
          <div className="table-state-message error">Error loading workflows</div>
        ) : workflows.length === 0 ? (
          <div className="table-state-message empty">
            <span className="empty-icon">⚡</span>
            <p>No workflows created yet.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Steps</th>
                  <th>SLA</th>
                  <th>Status</th>
                  <th>Created</th>
                  {canCreateOrRun && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {workflows.map((wf) => (
                  <tr key={wf._id}>
                    <td>
                      <div className="workflow-info-cell">
                        <span className="workflow-title">{wf.name}</span>
                        {wf.description && (
                          <span className="workflow-subtext">{wf.description}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="steps-count-badge">
                        {wf.steps?.length || 0} step{wf.steps?.length === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td>
                      {wf.slaMinutes != null ? (
                        <span className="sla-pill">{wf.slaMinutes} min</span>
                      ) : (
                        <span className="text-muted">None</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          wf.isActive ? 'badge-green' : 'badge-gray'
                        }`}
                      >
                        {wf.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="date-cell">{formatDate(wf.createdAt)}</td>
                    {canCreateOrRun && (
                      <td className="actions-cell">
                        <div className="btn-group">
                          {wf.isActive && (
                            <button
                              type="button"
                              className="btn-action btn-run"
                              onClick={() => handleRunWorkflow(wf._id, wf.name)}
                              title="Trigger immediate execution"
                            >
                              ▶ Run
                            </button>
                          )}
                          {canDeactivate && wf.isActive && (
                            <button
                              type="button"
                              className="btn-action btn-deactivate"
                              onClick={() => handleDeactivate(wf._id, wf.name)}
                              title="Deactivate this workflow"
                            >
                              Deactivate
                            </button>
                          )}
                          {!wf.isActive && <span className="text-muted">—</span>}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="pagination-bar">
          <span className="pagination-info">
            Showing page {page} of {totalPages} ({total} total workflows)
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

