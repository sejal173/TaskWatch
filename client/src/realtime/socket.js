import { io } from 'socket.io-client';

let socket = null;

/**
 * Connects to the Socket.IO server using the provided JWT token.
 * Proxied via Vite to http://localhost:5000/socket.io
 *
 * @param {string} token - JWT authentication token
 * @returns {import('socket.io-client').Socket}
 */
export function connectSocket(token) {
  if (socket) {
    if (socket.connected) {
      return socket;
    }
    socket.disconnect();
  }

  socket = io(window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  return socket;
}

/**
 * Disconnects the active Socket.IO connection.
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}

