import { WsClient, type WebSocketLike } from "./client";
import { MockSocket, dropMockConnections } from "./mock/socket";

const url = import.meta.env.VITE_WS_URL;

export const isMockTransport = !url;

export const wsClient = new WsClient(() => (url ? (new WebSocket(url) as WebSocketLike) : new MockSocket()));

/** Only meaningful with the mock transport. */
export const simulateDisconnect = () => dropMockConnections();
