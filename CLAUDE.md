# CLAUDE.md — NearMatch

AI guidance for working with the NearMatch codebase.

## What This App Is

**NearMatch** is a proximity-based dating PWA. It shows people within a **150-metre radius** in real time, lets them like each other, and unlocks a real-time chat when both sides like back (mutual match). The radar animation on the main screen visualises nearby users as dots orbiting the current user.

## Repository Structure

```
proximity/
├── server.js          # Express + Socket.io backend (all API routes + WS)
├── schema.sql         # PostgreSQL schema
├── package.json
├── .env.example
└── public/
    ├── index.html     # SPA shell — all screens in one file
    ├── app.js         # All frontend logic
    └── style.css      # Dark theme, purple-pink gradient, radar CSS
```

No build step. The frontend is vanilla JS served as static files from Express.

## Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js ≥ 18 |
| HTTP / WS | Express 4 + Socket.io 4 |
| Database | PostgreSQL (via `pg`) |
| Auth | JWT (`jsonwebtoken`) + `bcrypt` |
| Frontend | Vanilla JS PWA — no framework |
| Location | Browser Geolocation API (`watchPosition`) |
| Haptics | Vibration API |

## Database Schema

Four tables (`schema.sql`):

- **users** — id (UUID), username, email, password_hash, name, age, bio, gender, looking_for, avatar_url, is_visible
- **locations** — user_id (unique FK), latitude, longitude, accuracy, updated_at
- **matches** — user_a, user_b (sorted alphabetically), liked_by_a, liked_by_b, is_match
- **messages** — match_id, sender_id, content, is_read

## API Routes (`server.js`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/register` | — | Create account, returns JWT |
| POST | `/api/login` | — | Email + password login, returns JWT |
| GET | `/api/me` | ✓ | Current user profile |
| POST | `/api/location` | ✓ | Update GPS coordinates |
| GET | `/api/nearby` | ✓ | Users within 150 m (Haversine, active ≤10 min) |
| POST | `/api/match/:userId` | ✓ | Like a user; returns `{ match: bool }` |
| GET | `/api/matches` | ✓ | Mutual matches with last message |
| GET | `/api/chat/:userId` | ✓ | Message history for a match |

## Socket.io Events

| Direction | Event | Payload | Description |
|---|---|---|---|
| client → server | `send_message` | `{ matchId, content }` | Send a chat message |
| server → client | `new_message` | message row | Incoming message |
| server → client | `new_match` | `{ matchId }` | Mutual match just formed |
| server → client | `nearby_update` | — | Someone entered/left 150 m zone |

Authentication: JWT passed in `socket.handshake.auth.token`.

## Frontend Screens (`public/`)

All screens live in `index.html`; `app.js` switches them by toggling `.active`.

1. **Auth** — login / register tabs
2. **Radar** — animated sweep radar, dots = nearby users
3. **Nearby** — list with distance badges, like button
4. **Matches** — mutual matches with last message preview
5. **Chat** — real-time Socket.io chat
6. **Profile** — editable name / age / bio

Key `app.js` globals: `token`, `me`, `socket`, `nearbyUsers`, `likedSet` (persisted to `localStorage`).

## Proximity Logic

`haversine(lat1, lon1, lat2, lon2)` returns metres. Nearby query filters:
- `updated_at > NOW() - INTERVAL '10 minutes'` (stale locations ignored)
- `is_visible = TRUE`
- distance ≤ 150 m

## UX Patterns

- Vibration on new nearby person: `[150, 80, 150]`
- Vibration on new match: `[200, 100, 200, 100, 400]`
- Toast notifications for likes, new messages, new nearby
- Match flash overlay when mutual like occurs

## Environment Variables

```
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/nearmatch
JWT_SECRET=...
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12
```

## Development Workflow

```bash
# Install
cd proximity && npm install

# Database
psql $DATABASE_URL -f schema.sql

# Run
npm run dev   # nodemon
```

No test suite — test manually in browser. Use DevTools → Application → Geolocation override to simulate positions.

## Conventions

1. All business logic stays in `server.js`; keep it flat — no route split into sub-files.
2. Frontend uses vanilla `fetch` via the `api()` helper — never call `fetch` directly.
3. Never log JWTs or passwords.
4. Keep `style.css` variables (`--accent1`, `--accent2`, `--bg`, etc.) — do not hardcode colours.
5. Match pairs are stored with `user_a < user_b` (UUID sort) to avoid duplicates — never insert without sorting.
