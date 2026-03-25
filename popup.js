/**
 * YT Analytics — Popup UI Script
 * Reads from chrome.storage.local and renders stats for the selected period.
 */

'use strict';

// ─── Utilities ─────────────────────────────────────────────────────────────

function formatTime(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = Math.floor(totalSecs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function dateWithOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toLocaleDateString('en-CA');
}

function dateRangeSet(period) {
  const dates = new Set();
  const today = new Date();
  if (period === 'today') {
    dates.add(dateWithOffset(0));
  } else if (period === 'week') {
    for (let i = 0; i < 7; i++) dates.add(dateWithOffset(i));
  } else if (period === 'month') {
    for (let i = 0; i < 30; i++) dates.add(dateWithOffset(i));
  }
  // 'all' → empty set means include everything
  return dates;
}

function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), duration);
}

// ─── State ─────────────────────────────────────────────────────────────────

let currentPeriod = 'today';
let currentTab = 'videos';

// ─── Data loading ───────────────────────────────────────────────────────────

function loadAndRender() {
  chrome.storage.local.get(null, (all) => {
    const sessions = [];
    for (const [key, val] of Object.entries(all)) {
      if (!key.startsWith('session_')) continue;
      sessions.push(val);
    }
    render(sessions);
  });
}

function render(sessions) {
  const dateSet = dateRangeSet(currentPeriod);
  const filtered = currentPeriod === 'all'
    ? sessions
    : sessions.filter(s => dateSet.has(s.date));

  // ── Aggregates
  const totalSecs = filtered.reduce((a, s) => a + (s.totalSecs || 0), 0);
  const uniqueVideos = new Set(filtered.map(s => s.videoId)).size;
  const channelMap = {};
  for (const s of filtered) {
    const ch = s.channel || 'Unknown';
    if (!channelMap[ch]) channelMap[ch] = { name: ch, secs: 0, count: 0, avatar: null };
    channelMap[ch].secs += s.totalSecs || 0;
    channelMap[ch].count += 1;
    // Prefer a real avatar URL over null
    if (s.channelAvatar && !channelMap[ch].avatar) {
      channelMap[ch].avatar = s.channelAvatar;
    }
  }
  const channelList = Object.values(channelMap).sort((a, b) => b.secs - a.secs);

  // ── Hero ring  (r=50, circumference = 2π×50 ≈ 314)
  const maxGoalSecs = 3600;
  const pct = Math.min(totalSecs / maxGoalSecs, 1);
  const circumference = 314;
  const offset = circumference - pct * circumference;
  document.getElementById('heroTime').textContent = formatTime(totalSecs);
  document.getElementById('heroVideos').textContent = uniqueVideos;
  document.getElementById('heroChannels').textContent = channelList.length;
  document.getElementById('ringProgress').style.strokeDashoffset = offset;

  // ── Aggregate per-video (latest entry per videoId)
  const videoMap = {};
  for (const s of filtered) {
    if (!videoMap[s.videoId] || s.totalSecs > videoMap[s.videoId].totalSecs) {
      videoMap[s.videoId] = s;
    }
  }
  const videoList = Object.values(videoMap).sort((a, b) => b.totalSecs - a.totalSecs);

  // ── Render lists
  if (currentTab === 'videos') {
    renderVideoList(videoList);
  } else {
    renderChannelList(channelList);
  }
}

// ─── Video list ─────────────────────────────────────────────────────────────

function renderVideoList(videos) {
  const emptyEl = document.getElementById('emptyState');
  const listEl = document.getElementById('videoList');

  if (currentTab !== 'videos') return;

  if (videos.length === 0) {
    emptyEl.hidden = false;
    listEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  listEl.hidden = false;
  listEl.innerHTML = '';

  for (const v of videos) {
    const li = document.createElement('li');
    li.className = 'video-item';

    const thumbUrl = v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`;

    li.innerHTML = `
      <img class="video-thumb" src="${thumbUrl}" alt="" loading="lazy"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
      <div class="video-thumb-placeholder" style="display:none">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5a5a6e" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
      <div class="video-info">
        <div class="video-title" title="${escHtml(v.title)}">${escHtml(v.title)}</div>
        <div class="video-channel">${escHtml(v.channel)}</div>
      </div>
      <span class="video-time">${formatTime(v.totalSecs || 0)}</span>
    `;
    listEl.appendChild(li);
  }
}

// ─── Channel list ────────────────────────────────────────────────────────────

// Deterministic colour from channel name (always same colour per channel)
const AVATAR_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1',
  '#1e88e5', '#039be5', '#00897b', '#43a047',
  '#f4511e', '#fb8c00', '#fdd835', '#6d4c41',
];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

function renderChannelList(channels) {
  const emptyEl = document.getElementById('emptyState');
  const channelEl = document.getElementById('channelList');
  const videoEl = document.getElementById('videoList');

  if (currentTab !== 'channels') return;

  videoEl.hidden = true;

  if (channels.length === 0) {
    emptyEl.hidden = false;
    channelEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  channelEl.hidden = false;
  channelEl.innerHTML = '';

  for (const c of channels) {
    const initial = (c.name || '?').charAt(0).toUpperCase();
    const color = avatarColor(c.name || '');
    const li = document.createElement('li');
    li.className = 'channel-item';

    // Build avatar: real image when available, letter circle as fallback
    const avatarHtml = c.avatar
      ? `<div class="channel-avatar" style="background:${color};padding:0;overflow:hidden">
           <img class="channel-avatar-img" src="${escHtml(c.avatar)}" alt=""
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
           <span class="channel-avatar-letter" style="display:none">${initial}</span>
         </div>`
      : `<div class="channel-avatar" style="background:${color}">${initial}</div>`;

    li.innerHTML = `
      ${avatarHtml}
      <div class="channel-info">
        <div class="channel-name" title="${escHtml(c.name)}">${escHtml(c.name)}</div>
        <div class="channel-vid-count">${c.count} video${c.count !== 1 ? 's' : ''}</div>
      </div>
      <span class="channel-time">${formatTime(c.secs)}</span>
    `;
    channelEl.appendChild(li);
  }
}


// ─── Helpers ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function switchContent(tab) {
  currentTab = tab;
  document.querySelectorAll('.content-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  const videoListEl = document.getElementById('videoList');
  const channelListEl = document.getElementById('channelList');
  const emptyEl = document.getElementById('emptyState');

  // Explicitly manage visibility — can't rely solely on hidden attr
  // because render functions only update the ACTIVE tab's list
  videoListEl.hidden = (tab !== 'videos');
  channelListEl.hidden = (tab !== 'channels');
  emptyEl.hidden = true;

  loadAndRender();
}

// ─── Event bindings ─────────────────────────────────────────────────────────

// Period buttons
document.querySelectorAll('.period-btn[data-period]').forEach(btn => {
  btn.addEventListener('click', () => {
    currentPeriod = btn.dataset.period;
    // Only remove active from other period buttons
    document.querySelectorAll('.period-btn[data-period]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadAndRender();
  });
});

// Content tabs
document.querySelectorAll('.content-tab').forEach(btn => {
  btn.addEventListener('click', () => switchContent(btn.dataset.tab));
});

// Settings open / close
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('closeSettings').addEventListener('click', closeSettings);
document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettings();
});

function openSettings() {
  const overlay = document.getElementById('settingsOverlay');
  overlay.hidden = false;
  // Load stored spreadsheetId
  chrome.runtime.sendMessage({ type: 'GET_SPREADSHEET_ID' }, (res) => {
    if (res?.id) {
      document.getElementById('spreadsheetInput').value = res.id;
      setStatus('connected', 'Connected');
    } else {
      setStatus('', 'Not connected');
    }
  });
}

function closeSettings() {
  document.getElementById('settingsOverlay').hidden = true;
}

function setStatus(state, text) {
  const dot = document.getElementById('statusDot');
  const span = document.getElementById('statusText');
  dot.className = `status-dot ${state}`;
  span.textContent = text;
}

// Connect Google Sheets
document.getElementById('connectSheetsBtn').addEventListener('click', () => {
  const id = document.getElementById('spreadsheetInput').value.trim();
  if (!id) { showToast('Please paste a Spreadsheet ID'); return; }

  setStatus('', 'Connecting…');

  chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN_INTERACTIVE' }, (res) => {
    if (!res?.token) {
      setStatus('error', 'Auth failed');
      showToast('Google sign-in failed');
      return;
    }
    chrome.runtime.sendMessage({ type: 'SET_SPREADSHEET_ID', id }, () => {
      setStatus('connected', 'Connected');
      showToast('✓ Sheets connected!');
    });
  });
});

// Reload button
document.getElementById('reloadBtn').addEventListener('click', () => {
  const btn = document.getElementById('reloadBtn');
  const icon = btn.querySelector('.nav-icon');
  
  icon.classList.add('spinning');
  loadAndRender();
  
  setTimeout(() => {
    icon.classList.remove('spinning');
    showToast('✓ Data Refreshed');
  }, 700);
});

// Clear data
document.getElementById('clearDataBtn').addEventListener('click', () => {
  if (!confirm('Clear ALL tracking data? This cannot be undone.')) return;
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all).filter(k => k.startsWith('session_') || k === 'pendingSync');
    chrome.storage.local.remove(keys, () => {
      closeSettings();
      loadAndRender();
      showToast('Data cleared');
    });
  });
});

// ─── Init ────────────────────────────────────────────────────────────────────

loadAndRender();

// Live-update every 5 s while popup is open
setInterval(loadAndRender, 5000);

// Listen for storage changes (from content script)
chrome.storage.onChanged.addListener((changes) => {
  const hasSessionChange = Object.keys(changes).some(k => k.startsWith('session_'));
  if (hasSessionChange) loadAndRender();
});
