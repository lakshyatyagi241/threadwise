/**
 * Realtime for the staff web app: one socket per session (`RealtimeProvider`), rooms and events as hooks. See docs/api/realtime.md.
 */
export {
  RealtimeProvider,
  useRealtimeClient,
  type RealtimeProviderProps,
} from './realtime-provider';
export { useRealtimeStatus, useRoom, useRealtimeEvent, useResync } from './hooks';
export {
  RealtimeClient,
  type RealtimeStatus,
  type ResyncReason,
  type ResyncRequest,
  type RoomState,
  type SocketFactory,
  type SocketLike,
} from './realtime-client';
