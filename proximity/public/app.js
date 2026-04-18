/* NearMatch – frontend logic */
'use strict';

const API = '';
let token = localStorage.getItem('nm_token');
let me = null;
let socket = null;
let watchId = null;
let currentMatchId = null;
let currentPartnerId = null;
let nearbyUsers = [];
let likedSet = new Set(JSON.parse(localStorage.getItem('nm_liked') || '[]'));

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (el) => { if (typeof el === 'string') el = $(el); el.style.display = ''; };
const hide = (el) => { if (typeof el === 'string') el = $(el); el.style.display = 'none'; };

function toast(msg, duration = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function saveLiked() {
  localStorage.setItem('nm_liked', JSON.stringify([...likedSet]));
}

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// ── Auth ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    $('login-form').style.display = tab.dataset.tab === 'login' ? '' : 'none';
    $('register-form').style.display = tab.dataset.tab === 'register' ? '' : 'none';
  });
});

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user, token: t } = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email: $('login-email').value, password: $('login-password').value }),
    });
    token = t;
    localStorage.setItem('nm_token', t);
    me = user;
    startApp();
  } catch (err) {
    toast(err.message);
  }
});

$('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { user, token: t } = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        name: $('reg-name').value,
        username: $('reg-username').value,
        email: $('reg-email').value,
        password: $('reg-password').value,
        age: Number($('reg-age').value),
        gender: $('reg-gender').value,
        looking_for: $('reg-looking').value,
        bio: $('reg-bio').value,
      }),
    });
    token = t;
    localStorage.setItem('nm_token', t);
    me = user;
    startApp();
  } catch (err) {
    toast(err.message);
  }
});

$('logout-btn').addEventListener('click', () => {
  localStorage.removeItem('nm_token');
  token = null;
  me = null;
  if (watchId) navigator.geolocation.clearWatch(watchId);
  if (socket) socket.disconnect();
  hide('app');
  show('auth-screen');
});

// ── Start app ─────────────────────────────────────────────────────────────────
async function startApp() {
  hide('auth-screen');
  $('app').style.display = 'flex';
  if (!me) me = await api('/api/me');
  fillProfile();
  connectSocket();
  startGeolocation();
  loadNearby();
  loadMatches();
}

// ── Geolocation ───────────────────────────────────────────────────────────────
function startGeolocation() {
  if (!navigator.geolocation) {
    $('radar-status').textContent = 'Geolocation not supported';
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      $('radar-status').textContent = `GPS active · ±${Math.round(pos.coords.accuracy)}m`;
      api('/api/location', {
        method: 'POST',
        body: JSON.stringify({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      }).catch(() => {});
      loadNearby();
    },
    (err) => {
      $('radar-status').textContent = 'Location access denied';
    },
    { enableHighAccuracy: true, maximumAge: 10000 }
  );
}

// ── Socket.io ─────────────────────────────────────────────────────────────────
function connectSocket() {
  socket = io({ auth: { token } });

  socket.on('nearby_update', () => loadNearby());

  socket.on('new_match', ({ matchId }) => {
    loadMatches();
    showMatchFlash(matchId);
    vibrate([200, 100, 200, 100, 400]);
  });

  socket.on('new_message', (msg) => {
    if (currentMatchId === msg.match_id) appendMessage(msg);
    else {
      loadMatches();
      toast('New message 💜');
      vibrate([100]);
    }
  });
}

function vibrate(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

// ── Nearby ────────────────────────────────────────────────────────────────────
let prevNearbyIds = new Set();

async function loadNearby() {
  try {
    nearbyUsers = await api('/api/nearby');
    renderRadar(nearbyUsers);
    renderNearbyList(nearbyUsers);

    const newIds = new Set(nearbyUsers.map((u) => u.id));
    const appeared = nearbyUsers.filter((u) => !prevNearbyIds.has(u.id));
    if (prevNearbyIds.size > 0 && appeared.length) {
      toast(`${appeared[0].name} is nearby! 📡`);
      vibrate([150, 80, 150]);
    }
    prevNearbyIds = newIds;

    const badge = $('nearby-badge');
    badge.textContent = nearbyUsers.length || '';
    badge.style.display = nearbyUsers.length ? '' : 'none';
  } catch {}
}

function renderRadar(users) {
  const radar = $('radar');
  radar.querySelectorAll('.radar-dot').forEach((d) => d.remove());
  const cx = 130, cy = 130, maxDist = 150;

  users.forEach((u) => {
    const angle = Math.random() * 2 * Math.PI;
    const r = (u.distance / maxDist) * 105;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const dot = document.createElement('div');
    dot.className = 'radar-dot';
    dot.style.left = x + 'px';
    dot.style.top = y + 'px';
    dot.innerHTML = `<span class="dot-tip">${u.name}, ${u.distance}m</span>`;
    dot.addEventListener('click', () => switchScreen('nearby-screen'));
    radar.appendChild(dot);
  });
}

function renderNearbyList(users) {
  const el = $('nearby-list');
  if (!users.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📡</div>No one within 150m right now</div>';
    return;
  }
  el.innerHTML = users
    .map(
      (u) => `
    <div class="user-card">
      <div class="avatar">${u.avatar_url ? `<img src="${u.avatar_url}" />` : initials(u.name)}</div>
      <div class="user-info">
        <div class="user-name">${u.name}${u.age ? `, ${u.age}` : ''}</div>
        <div class="user-meta">${u.bio || ''}</div>
      </div>
      <span class="distance-badge">${u.distance}m</span>
      <button class="like-btn${likedSet.has(u.id) ? ' liked' : ''}" data-uid="${u.id}" title="Like">💜</button>
    </div>`
    )
    .join('');

  el.querySelectorAll('.like-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.classList.contains('liked')) return;
      const uid = btn.dataset.uid;
      btn.classList.add('liked');
      likedSet.add(uid);
      saveLiked();
      try {
        const { match } = await api(`/api/match/${uid}`, { method: 'POST' });
        if (match) {
          toast("It's a match! 💜");
          vibrate([200, 100, 200, 100, 400]);
          loadMatches();
        } else {
          toast('Like sent!');
        }
      } catch (err) {
        toast(err.message);
      }
    });
  });
}

// ── Matches ───────────────────────────────────────────────────────────────────
async function loadMatches() {
  try {
    const matches = await api('/api/matches');
    const el = $('matches-list');
    const badge = $('matches-badge');
    badge.textContent = matches.length || '';
    badge.style.display = matches.length ? '' : 'none';

    if (!matches.length) {
      el.innerHTML = '<div class="empty"><div class="empty-icon">💜</div>No matches yet — keep exploring!</div>';
      return;
    }
    el.innerHTML = matches
      .map(
        (m) => `
      <div class="match-card" data-match="${m.match_id}" data-partner="${m.partner_id}" data-name="${m.name}">
        <div class="avatar">${initials(m.name)}</div>
        <div class="user-info">
          <div class="user-name">${m.name}${m.age ? `, ${m.age}` : ''}</div>
          <div class="match-last-msg">${m.last_message || 'Say hello!'}</div>
        </div>
      </div>`
      )
      .join('');

    el.querySelectorAll('.match-card').forEach((card) => {
      card.addEventListener('click', () =>
        openChat(card.dataset.match, card.dataset.partner, card.dataset.name)
      );
    });
  } catch {}
}

// ── Chat ──────────────────────────────────────────────────────────────────────
async function openChat(matchId, partnerId, partnerName) {
  currentMatchId = matchId;
  currentPartnerId = partnerId;
  $('chat-partner-name').textContent = partnerName;
  $('chat-avatar').textContent = initials(partnerName);
  $('chat-messages').innerHTML = '';
  switchScreen('chat-screen');

  try {
    const messages = await api(`/api/chat/${partnerId}`);
    messages.forEach(appendMessage);
    scrollChat();
  } catch {}
}

function appendMessage(msg) {
  const wrap = document.createElement('div');
  const mine = msg.sender_id === me?.id;
  wrap.innerHTML = `
    <div class="msg-bubble ${mine ? 'mine' : 'theirs'}">
      ${escHtml(msg.content)}
      <div class="msg-time">${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>`;
  $('chat-messages').appendChild(wrap);
  scrollChat();
}

function scrollChat() {
  const el = $('chat-messages');
  el.scrollTop = el.scrollHeight;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

$('send-btn').addEventListener('click', sendMessage);
$('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

function sendMessage() {
  const content = $('chat-input').value.trim();
  if (!content || !socket || !currentMatchId) return;
  socket.emit('send_message', { matchId: currentMatchId, content });
  $('chat-input').value = '';
}

$('chat-back').addEventListener('click', () => switchScreen('matches-screen'));

// ── Match flash ───────────────────────────────────────────────────────────────
let flashMatchId = null;

function showMatchFlash(matchId) {
  flashMatchId = matchId;
  $('match-flash').classList.add('show');
}

$('match-flash-close').addEventListener('click', () => $('match-flash').classList.remove('show'));
$('match-flash-chat').addEventListener('click', async () => {
  $('match-flash').classList.remove('show');
  if (flashMatchId) {
    const matches = await api('/api/matches');
    const m = matches.find((x) => x.match_id === flashMatchId);
    if (m) openChat(m.match_id, m.partner_id, m.name);
  }
});

// ── Profile ───────────────────────────────────────────────────────────────────
function fillProfile() {
  if (!me) return;
  $('prof-name').value = me.name || '';
  $('prof-age').value = me.age || '';
  $('prof-gender').value = me.gender || '';
  $('prof-looking').value = me.looking_for || 'everyone';
  $('prof-bio').value = me.bio || '';
  $('profile-avatar').textContent = initials(me.name);
}

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  toast('Profile saved ✓');
});

// ── Toggle visibility ─────────────────────────────────────────────────────────
$('toggle-visible').addEventListener('click', async () => {
  const btn = $('toggle-visible');
  const isOn = btn.classList.contains('on');
  btn.classList.toggle('on', !isOn);
  btn.textContent = isOn ? 'Hidden' : 'Visible';
  // persist via API if needed
});

// ── Navigation ────────────────────────────────────────────────────────────────
function switchScreen(screenId) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(screenId).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.screen === screenId);
  });
}

document.querySelectorAll('.nav-btn[data-screen]').forEach((btn) => {
  btn.addEventListener('click', () => {
    switchScreen(btn.dataset.screen);
    if (btn.dataset.screen === 'nearby-screen') loadNearby();
    if (btn.dataset.screen === 'matches-screen') loadMatches();
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
if (token) {
  api('/api/me')
    .then((user) => { me = user; startApp(); })
    .catch(() => { localStorage.removeItem('nm_token'); token = null; });
}
