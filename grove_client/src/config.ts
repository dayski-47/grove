export const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : "";
export const WS_BASE  = import.meta.env.DEV
  ? "ws://localhost:8081"
  : `wss://${window.location.host}/ws`;
