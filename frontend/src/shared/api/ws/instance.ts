import { WS_URL, getAuthToken } from "@/shared/config";
import { WsClient, type WebSocketLike } from "./client";
import { BackendSocket } from "./backend/backend-socket";
import { MockSocket, dropMockConnections } from "./mock/socket";

/** Real backend when `VITE_WS_URL` is set, otherwise the in-browser mock server. */
export const isMockTransport = !WS_URL;

export const wsClient = new WsClient(() =>
  WS_URL ? (new BackendSocket(WS_URL, getAuthToken) as WebSocketLike) : new MockSocket(),
);

/** Only meaningful with the mock transport. */
export const simulateDisconnect = () => dropMockConnections();
