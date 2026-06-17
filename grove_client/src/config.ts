export const API_BASE = import.meta.env.DEV ? "http://localhost:8080" : "";
export const WS_BASE  = import.meta.env.DEV
  ? "ws://localhost:8081"
  : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
