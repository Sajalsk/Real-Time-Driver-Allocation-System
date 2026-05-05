# Real-Time Driver Allocation System

A backend service that simulates driver allocation in a ride-hailing platform. Built with NestJS, PostgreSQL, and Redis.

## Tech Stack

- **NestJS** — Backend framework
- **PostgreSQL** — Persistent storage (via Prisma ORM)
- **Redis** — GEO queries, atomic ride assignment (Lua script), job queues
- **BullMQ** — Timeout and retry handling
- **Socket.io** — Real-time WebSocket notifications to drivers
- **Docker** — Containerized database setup

## Setup

### Prerequisites

- Node.js 18+
- Docker & Docker Compose

### Installation

```bash
npm install
sudo docker-compose up -d
npx prisma db push
npm run start:dev
```

Server runs at `http://localhost:3000`.

### Run Tests

In a separate terminal:

```bash
npx ts-node test/concurrency-simulation.ts
```

## System Design

### How a Ride Gets Allocated

1. Rider sends `POST /rides/request` with pickup coordinates.
2. Server creates a ride in Postgres and sets the state to `SEARCHING` in Redis.
3. Redis `GEOSEARCH` finds nearby drivers. Results are filtered by a `drivers:available` SET.
4. Found drivers are notified via WebSocket (`ride-request` event).
5. A BullMQ delayed job is queued (15s timeout).
6. Drivers hit `PATCH /rides/:id/accept` to claim the ride.
7. A Redis Lua script atomically checks the state and assigns the first driver. All subsequent requests get rejected.
8. If no one accepts within 15s, the BullMQ worker expands the radius (+3km) and retries (max 3 attempts before marking as `TIMEOUT`).

### Ride States

```
SEARCHING → ASSIGNED → COMPLETED
    ↓
  TIMEOUT (after 3 retries)
```

## Concurrency Approach

The critical requirement — preventing double assignment — is handled with a **Redis Lua script**.

Redis is single-threaded. Lua scripts execute atomically without interruption. So when 100 drivers call accept simultaneously:

- Driver 1's script sees `status = SEARCHING`, flips it to `ASSIGNED`, returns `SUCCESS`.
- Drivers 2–100 see `status = ASSIGNED`, get `RIDE_ALREADY_TAKEN`.

No distributed locks needed. No race conditions possible.

### Idempotency

If the same driver retries (e.g., bad network), the Lua script checks `existing_driver == incoming_driver` and returns `SUCCESS_IDEMPOTENT` instead of failing.

## API Endpoints

### Rides

| Method | Endpoint                | Description           |
| ------ | ----------------------- | --------------------- |
| POST   | `/rides/request`        | Request a new ride    |
| PATCH  | `/rides/:rideId/accept` | Driver accepts a ride |

### Drivers

| Method | Endpoint                | Description                      |
| ------ | ----------------------- | -------------------------------- |
| POST   | `/drivers/register`     | Register driver with initial GPS |
| PATCH  | `/drivers/:id/location` | Update driver GPS (heartbeat)    |
| PATCH  | `/drivers/:id/status`   | Toggle AVAILABLE / OFFLINE       |

### WebSocket Events

| Event             | Direction       | Purpose                             |
| ----------------- | --------------- | ----------------------------------- |
| `register-driver` | Client → Server | Driver registers socket identity    |
| `ride-request`    | Server → Client | Push new ride to nearby drivers     |
| `ride-assigned`   | Server → Client | Notify drivers of assignment result |

## Project Structure

```
src/
├── app.module.ts              # Root module
├── main.ts                    # Entry point
├── prisma.service.ts          # DB connection
├── redis.service.ts           # Redis client, Lua script, GEO ops
├── ride.controller.ts         # Ride API
├── ride.service.ts            # Core allocation logic
├── ride.gateway.ts            # WebSocket gateway
├── ride-timeout.processor.ts  # BullMQ timeout worker
└── driver.controller.ts       # Driver management API
```

## Simulation Results

The test script seeds 10 drivers with real GPS coordinates and runs 4 tests:

```
Test 1: Geo-Based Driver Search       — PASS
Test 2: 100 Concurrent Accepts        — 1 assigned, 99 rejected (47ms)
Test 3: Idempotency                   — SUCCESS_IDEMPOTENT on retry
Test 4: Dynamic Location Update       — PASS
```

## Assumptions & Trade-offs

- Redis acts as the real-time source of truth during allocation. Postgres is updated once a final state is reached.
- Lua scripts block Redis briefly during execution — acceptable since our scripts are lightweight (5-6 commands).
- Auth is out of scope. In production, JWT would protect all endpoints.
- WebSocket notifications are implemented but the simulation tests acceptance via HTTP for deterministic concurrency testing.
- Docker Compose is used for portable database setup. Evaluator just needs `docker-compose up -d`.

## Environment Variables

```
DATABASE_URL=postgresql://root:rootpassword@localhost:5433/cabs_db?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
```



<img width="1916" height="1009" alt="image" src="https://github.com/user-attachments/assets/423866a5-eab8-4608-a794-bda4765e121b" />




<img width="1916" height="1009" alt="image" src="https://github.com/user-attachments/assets/1f45140a-89fe-4c58-8229-c1ac24aeaed0" />


