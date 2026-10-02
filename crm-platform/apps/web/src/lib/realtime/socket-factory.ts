import { io } from 'socket.io-client';
import type { SocketFactory } from './realtime-client';

/**
 * The real socket. WebSocket only: the API's other pods hold no session for a long-polling request, and every browser the staff
 * app supports speaks WebSocket. `reconnection` is socket.io's own, for a dropped transport; the client adds the retry for what
 * socket.io gives up on (a refused handshake, a server-side disconnect). Not connected until `start()` says so.
 */
export const createIoSocket: SocketFactory = (url, { auth }) =>
  io(url, {
    auth,
    transports: ['websocket'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15_000,
  });
