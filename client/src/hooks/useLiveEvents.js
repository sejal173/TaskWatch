import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { connectSocket, disconnectSocket } from '../realtime/socket';

/**
 * Custom hook to subscribe to live WebSocket events from the API server.
 * Connects when the user is authenticated, invalidates relevant React Query caches,
 * tracks connection status, and surfaces SLA breach notifications.
 */
export function useLiveEvents() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (!token) {
      setIsConnected(false);
      disconnectSocket();
      return;
    }

    const socket = connectSocket(token);

    const onConnect = () => {
      setIsConnected(true);
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      console.warn('[Socket connect_error]', err.message);
      setIsConnected(false);
    };

    // When jobs change, invalidate jobs and dashboard count queries
    const onJobUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['jobCount'] });
      queryClient.invalidateQueries({ queryKey: ['recentJobs'] });
    };

    // When queue pause/resume toggles, invalidate queueStats
    const onQueueUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['queueStats'] });
    };

    // When SLA deadline breaches, invalidate and trigger toast banner
    const onSlaBreached = (payload) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['jobCount'] });
      queryClient.invalidateQueries({ queryKey: ['recentJobs'] });

      const message = payload?.workflowName
        ? `SLA breached: ${payload.workflowName} job ${payload.jobId}`
        : `SLA breached: job ${payload?.jobId || 'unknown'}`;

      setToast(message);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('job.updated', onJobUpdated);
    socket.on('queue.updated', onQueueUpdated);
    socket.on('sla.breached', onSlaBreached);

    if (socket.connected) {
      setIsConnected(true);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('job.updated', onJobUpdated);
      socket.off('queue.updated', onQueueUpdated);
      socket.off('sla.breached', onSlaBreached);
    };
  }, [token, queryClient]);

  const clearToast = () => setToast(null);

  return { isConnected, toast, clearToast };
}

