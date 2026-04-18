require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Haversine distance (metres) ──────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Register
app.post('/api/register', async (req, res) => {
  const { username, email, password, name, age, gender, looking_for, bio } = req.body;
  if (!username || !email || !password || !name)
    return res.status(400).json({ error: 'Missing required fields' });
  try {
    const hash = await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 12);
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, name, age, gender, looking_for, bio)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, username, name, age, gender, bio`,
      [username, email, hash, name, age, gender, looking_for, bio]
    );
    const token = jwt.sign({ id: rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
    res.json({ user: rows[0], token });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username or email taken' });
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
    const { password_hash, ...user } = rows[0];
    res.json({ user, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Me
app.get('/api/me', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id,username,name,age,gender,looking_for,bio,avatar_url,is_visible FROM users WHERE id=$1',
    [req.user.id]
  );
  res.json(rows[0]);
});

// Update location
app.post('/api/location', auth, async (req, res) => {
  const { latitude, longitude, accuracy } = req.body;
  await pool.query(
    `INSERT INTO locations (user_id, latitude, longitude, accuracy)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE
     SET latitude=$2, longitude=$3, accuracy=$4, updated_at=NOW()`,
    [req.user.id, latitude, longitude, accuracy]
  );

  // Notify nearby users via socket
  const nearby = await getNearby(req.user.id, latitude, longitude);
  nearby.forEach((u) => {
    const sock = userSockets.get(u.id);
    if (sock) io.to(sock).emit('nearby_update');
  });

  res.json({ ok: true });
});

// Nearby users (150 m radius)
app.get('/api/nearby', auth, async (req, res) => {
  const me = await pool.query('SELECT * FROM locations WHERE user_id=$1', [req.user.id]);
  if (!me.rows.length) return res.json([]);
  const { latitude, longitude } = me.rows[0];
  const users = await getNearby(req.user.id, latitude, longitude);
  res.json(users);
});

async function getNearby(userId, lat, lon) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.age, u.gender, u.bio, u.avatar_url,
            l.latitude, l.longitude, l.updated_at
     FROM locations l JOIN users u ON u.id = l.user_id
     WHERE u.id != $1 AND u.is_visible = TRUE
       AND l.updated_at > NOW() - INTERVAL '10 minutes'`,
    [userId]
  );
  return rows
    .map((u) => ({ ...u, distance: Math.round(haversine(lat, lon, u.latitude, u.longitude)) }))
    .filter((u) => u.distance <= 150)
    .sort((a, b) => a.distance - b.distance);
}

// Like / match
app.post('/api/match/:userId', auth, async (req, res) => {
  const [a, b] = [req.user.id, req.params.userId].sort();
  const existing = await pool.query('SELECT * FROM matches WHERE user_a=$1 AND user_b=$2', [a, b]);

  if (!existing.rows.length) {
    await pool.query(
      'INSERT INTO matches (user_a, user_b, liked_by_a, liked_by_b) VALUES ($1,$2,$3,$4)',
      [a, b, a === req.user.id, b === req.user.id]
    );
    return res.json({ match: false });
  }

  const row = existing.rows[0];
  const isA = row.user_a === req.user.id;
  const field = isA ? 'liked_by_a' : 'liked_by_b';
  const otherLiked = isA ? row.liked_by_b : row.liked_by_a;
  const isMatch = otherLiked;

  await pool.query(`UPDATE matches SET ${field}=TRUE, is_match=$1 WHERE id=$2`, [
    isMatch,
    row.id,
  ]);

  if (isMatch) {
    [row.user_a, row.user_b].forEach((uid) => {
      const sock = userSockets.get(uid);
      if (sock) io.to(sock).emit('new_match', { matchId: row.id });
    });
  }

  res.json({ match: isMatch });
});

// Matches list
app.get('/api/matches', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT m.id as match_id,
            CASE WHEN m.user_a=$1 THEN m.user_b ELSE m.user_a END as partner_id,
            u.name, u.age, u.avatar_url,
            (SELECT content FROM messages WHERE match_id=m.id ORDER BY created_at DESC LIMIT 1) as last_message,
            (SELECT created_at FROM messages WHERE match_id=m.id ORDER BY created_at DESC LIMIT 1) as last_message_at
     FROM matches m
     JOIN users u ON u.id = CASE WHEN m.user_a=$1 THEN m.user_b ELSE m.user_a END
     WHERE (m.user_a=$1 OR m.user_b=$1) AND m.is_match=TRUE
     ORDER BY last_message_at DESC NULLS LAST`,
    [req.user.id]
  );
  res.json(rows);
});

// Chat history
app.get('/api/chat/:userId', auth, async (req, res) => {
  const [a, b] = [req.user.id, req.params.userId].sort();
  const match = await pool.query(
    'SELECT id FROM matches WHERE user_a=$1 AND user_b=$2 AND is_match=TRUE',
    [a, b]
  );
  if (!match.rows.length) return res.status(403).json({ error: 'No match' });
  const { rows } = await pool.query(
    'SELECT * FROM messages WHERE match_id=$1 ORDER BY created_at ASC',
    [match.rows[0].id]
  );
  res.json(rows);
});

// ── Socket.io ────────────────────────────────────────────────────────────────
const userSockets = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  userSockets.set(socket.user.id, socket.id);

  socket.on('send_message', async ({ matchId, content }) => {
    if (!content?.trim()) return;
    const { rows } = await pool.query(
      `SELECT * FROM matches WHERE id=$1 AND (user_a=$2 OR user_b=$2) AND is_match=TRUE`,
      [matchId, socket.user.id]
    );
    if (!rows.length) return;
    const msg = await pool.query(
      'INSERT INTO messages (match_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *',
      [matchId, socket.user.id, content.trim()]
    );
    const partnerId = rows[0].user_a === socket.user.id ? rows[0].user_b : rows[0].user_a;
    const partnerSocket = userSockets.get(partnerId);
    if (partnerSocket) io.to(partnerSocket).emit('new_message', msg.rows[0]);
    socket.emit('new_message', msg.rows[0]);
  });

  socket.on('disconnect', () => userSockets.delete(socket.user.id));
});

// ── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`NearMatch running on port ${PORT}`));
