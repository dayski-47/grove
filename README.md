# Grove

A low-latency chat + voice app for gaming and dev sessions. Darkwood aesthetic — dark OLED minimal meets dark fantasy forest.

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust · Axum · SQLx · PostgreSQL · Redis · Tokio |
| Realtime | Custom binary WebSocket protocol (Tokio-tungstenite) |
| Voice | WebRTC (browser-native, STUN only for now) |
| Frontend | React 18 · TypeScript · Vite |
| Infra | Docker Compose (backend + frontend + postgres + redis + nginx) |

## Repo layout

```
chat_server/    Rust backend — REST (8080) + WebSocket (8081)
grove_client/   React/Vite frontend
```

## Running locally

```bash
# Everything via Docker
docker compose -f docker-compose.prod.yml up --build

# Frontend dev server (hot reload)
cd grove_client && npm install && npm run dev

# Backend only
cd chat_server && cargo run

# Postgres + Redis only
docker compose up postgres redis
```

- Frontend: http://localhost:5173 (dev) or http://localhost (Docker)
- REST API: http://localhost:8080
- WebSocket: ws://localhost:8081

Required backend env vars: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (must be ≥32 bytes — the server refuses to start otherwise).

## Branching

`main` is production. Work flows `feature/*` → `dev` → `staging` → `main`.

## Development

```bash
# Backend — format, lint, test before committing
cd chat_server && cargo fmt && cargo clippy --all-targets

# Frontend — type-check and lint before committing
cd grove_client && npm run build && npm run lint
```

See `grove_client/README.md` for Vite/ESLint template notes.
