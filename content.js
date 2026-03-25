/**
 * YT Analytics — Content Script
 * Tracks actual watch time per video, handles SPA navigation, pause/resume,
 * tab switches, and autoplay. Saves sessions to chrome.storage.local.
 */

(function () {
  'use strict';

  // ─── State ────────────────────────────────────────────────────────────────
  let currentVideoId    = null;
  let currentTitle      = null;
  let currentChannel    = null;
  let currentAvatar     = null;   // channel profile picture URL
  let previousTitle     = null;   // last confirmed title — to detect stale DOM reads
  let sessionStart      = null;   // epoch ms, null when not actively tracking
  let accumulatedSecs   = 0;      // seconds accumulated for the current video visit
  let flushInterval     = null;
  let urlObserver       = null;
  let videoEl           = null;

  const FLUSH_EVERY_MS  = 5000;   // write to storage every 5 s

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function nowISO() {
    return new Date().toISOString();
  }

  function todayDate() {
    return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  }

  function getVideoIdFromUrl(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get('v') || null;
    } catch {
      return null;
    }
  }

  function getTitle() {
    // document.title is updated by YouTube's router BEFORE the DOM elements
    // — making it the fastest and most reliable title source during SPA nav.
    const docTitle = document.title
      .replace(/^\(\d+\)\s*/, '') // Remove notification counts like (1) or (418)
      .replace(/ - YouTube$/, '')
      .trim();
    if (docTitle && docTitle !== 'YouTube' && docTitle.length > 0) return docTitle;

    return (
      document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
      document.querySelector('h1.title') ||
      document.querySelector('ytd-watch-metadata h1 yt-formatted-string')
    )?.textContent?.trim() || 'Unknown Video';
  }

  function getChannel() {
    return (
      document.querySelector('#owner #channel-name a') ||
      document.querySelector('ytd-channel-name a') ||
      document.querySelector('#owner-name a') ||
      document.querySelector('ytd-video-owner-renderer #channel-name a')
    )?.textContent?.trim() || 'Unknown Channel';
  }

  function getChannelAvatar() {
    // YouTube renders the channel avatar in several possible locations
    const img =
      document.querySelector('#owner #avatar img') ||
      document.querySelector('ytd-video-owner-renderer yt-img-shadow img') ||
      document.querySelector('#owner yt-img-shadow img') ||
      document.querySelector('ytd-video-owner-renderer #avatar img');

    const src = img?.src || img?.getAttribute('src') || '';
    // Reject placeholder grey boxes (data URIs or empty)
    if (!src || src.startsWith('data:') || src.length < 10) return null;
    return src;
  }

  function getThumbnail(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }

  // ─── Elapsed tracking ──────────────────────────────────────────────────────

  function startTracking() {
    if (sessionStart !== null) return; // already running
    if (!currentVideoId)        return;
    sessionStart = Date.now();
    console.debug('[YTA] Tracking started', currentVideoId);
  }

  function pauseTracking() {
    if (sessionStart === null) return;
    accumulatedSecs += (Date.now() - sessionStart) / 1000;
    sessionStart = null;
    console.debug('[YTA] Tracking paused, accumulated:', accumulatedSecs.toFixed(1));
    flushSession(); // write immediately on pause
  }

  function liveSeconds() {
    const base = accumulatedSecs;
    return sessionStart ? base + (Date.now() - sessionStart) / 1000 : base;
  }

  // ─── Storage ───────────────────────────────────────────────────────────────

  function makeEntryKey(videoId, date) {
    return `session_${date}_${videoId}`;
  }

  async function flushSession() {
    if (!currentVideoId) return;
    // Don't flush if we have no confirmed title yet — prevents saving stale data
    if (!currentTitle || currentTitle === 'Unknown Video') return;
    const secs = Math.round(liveSeconds());
    if (secs < 1) return;

    const date = todayDate();
    const key  = makeEntryKey(currentVideoId, date);

    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        const existing = result[key] || {
          videoId:   currentVideoId,
          title:     currentTitle,
          channel:   currentChannel,
          thumbnail: getThumbnail(currentVideoId),
          date:      date,
          totalSecs: 0,
          startTime: nowISO(),
          endTime:   nowISO(),
          synced:    false,
        };

        existing.totalSecs = Math.max(existing.totalSecs, secs);
        existing.endTime   = nowISO();
        if (currentTitle && currentTitle !== 'Unknown Video') {
          existing.title   = currentTitle;
        }
        if (currentChannel && currentChannel !== 'Unknown Channel') {
          existing.channel = currentChannel;
        }
        // Always update avatar when we have a real one
        if (currentAvatar) {
          existing.channelAvatar = currentAvatar;
        }

        chrome.storage.local.set({ [key]: existing }, () => {
          console.debug('[YTA] Flushed', key, existing.totalSecs, 's');
          chrome.runtime.sendMessage({ type: 'SESSION_UPDATED', key, entry: existing })
            .catch(() => { /* Background script might be sleeping or updating, ignore */ });
          resolve();
        });
      });
    });
  }

  function startFlushLoop() {
    stopFlushLoop();
    flushInterval = setInterval(flushSession, FLUSH_EVERY_MS);
  }

  function stopFlushLoop() {
    if (flushInterval) { clearInterval(flushInterval); flushInterval = null; }
  }

  // ─── Video element listeners ────────────────────────────────────────────────

  function onPlay()  { startTracking(); }
  function onPause() { pauseTracking(); }
  function onEnded() { pauseTracking(); }

  function attachVideoListeners(el) {
    if (!el) return;
    el.addEventListener('play',   onPlay);
    el.addEventListener('pause',  onPause);
    el.addEventListener('ended',  onEnded);
  }

  function detachVideoListeners(el) {
    if (!el) return;
    el.removeEventListener('play',   onPlay);
    el.removeEventListener('pause',  onPause);
    el.removeEventListener('ended',  onEnded);
  }

  // ─── Tab / window visibility ────────────────────────────────────────────────

  // Visibility tracking removed to allow background watch time recording.
  // We rely solely on video element play/pause/ended events.

  // ─── Video / URL change detection (SPA) ───────────────────────────────────

  /** Reset all state and start fresh for a new video */
  async function onVideoChange(newVideoId) {
    // Flush old session before switching
    if (currentVideoId && currentVideoId !== newVideoId) {
      pauseTracking();
      await flushSession();
    }

    stopFlushLoop();
    detachVideoListeners(videoEl);

    // Save previous title so we can detect stale DOM reads
    previousTitle   = currentTitle;

    // Reset — MUST happen before polling so stale values don't get flushed
    currentVideoId  = newVideoId;
    currentTitle    = null;
    currentChannel  = null;
    currentAvatar   = null;
    accumulatedSecs = 0;
    sessionStart    = null;

    let retries = 20;
    const pollMeta = setInterval(() => {
      const t = getTitle();
      const c = getChannel();
      const a = getChannelAvatar();

      const titleOk   = t && t !== 'Unknown Video' && t !== previousTitle;
      const channelOk = c && c !== 'Unknown Channel';

      if (titleOk)   currentTitle   = t;
      if (channelOk) currentChannel = c;
      if (a)         currentAvatar  = a;   // capture as soon as available

      if ((titleOk && channelOk) || --retries <= 0) {
        clearInterval(pollMeta);
        if (!currentTitle)   currentTitle   = t !== 'Unknown Video' ? t : `Video (${newVideoId})`;
        if (!currentChannel) currentChannel = c !== 'Unknown Channel' ? c : 'Unknown Channel';
        console.debug('[YTA] Meta resolved:', currentTitle, '/', currentChannel, '/ avatar:', !!currentAvatar);
      }
    }, 500);

    // Attach to video element
    videoEl = document.querySelector('video');
    if (!videoEl) {
      const obs = new MutationObserver(() => {
        videoEl = document.querySelector('video');
        if (videoEl) {
          obs.disconnect();
          attachVideoListeners(videoEl);
          if (videoEl && !videoEl.paused) startTracking();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    } else {
      attachVideoListeners(videoEl);
      if (videoEl && !videoEl.paused) startTracking();
    }

    startFlushLoop();
    console.debug('[YTA] New video:', newVideoId);
  }

  /** Handle non-video pages (home, search, etc.) */
  function onNonVideoPage() {
    pauseTracking();
    flushSession();
    stopFlushLoop();
    detachVideoListeners(videoEl);
    videoEl        = null;
    currentVideoId = null;
    accumulatedSecs = 0;
    sessionStart   = null;
  }

  /** Monitor URL changes (YouTube is an SPA, no full-page navigations) */
  let lastUrl = location.href;
  function checkUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    const vid = getVideoIdFromUrl(location.href);
    if (vid) {
      onVideoChange(vid);
    } else {
      onNonVideoPage();
    }
  }

  // Use both MutationObserver (for pushState) and popstate
  urlObserver = new MutationObserver(checkUrlChange);
  urlObserver.observe(document.querySelector('head') || document.documentElement, {
    childList: true, subtree: false,
  });
  window.addEventListener('popstate', checkUrlChange);

  // Also poll every second as a fallback for YouTube's router
  setInterval(checkUrlChange, 1000);

  // ─── Init ─────────────────────────────────────────────────────────────────

  const initVideoId = getVideoIdFromUrl(location.href);
  if (initVideoId) {
    onVideoChange(initVideoId);
  }

  // Flush before the page unloads
  window.addEventListener('beforeunload', () => {
    pauseTracking();
    // Synchronous storage write isn't possible, but we've been flushing regularly
  });

  // Support forced flushes from popup or background script
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FORCE_FLUSH') {
      flushSession().then(() => sendResponse({ ok: true }));
      return true; // async
    }
  });

})();
