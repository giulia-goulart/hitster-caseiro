// Hitster caseiro — escaneia QR de carta, toca 15 s de uma faixa do Spotify sem mostrar o nome.
'use strict';

// Cole aqui o Client ID do app criado em developer.spotify.com/dashboard.
// Se ficar vazio, o site pede o Client ID na tela de login.
const CLIENT_ID_FIXO = '48b2d19cc9ac40878fb5879ea734b1f2';

const SNIPPET_MS = 15000;
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state';
const REDIRECT_URI = location.origin + location.pathname;
const $ = (id) => document.getElementById(id);

// ---------- armazenamento seguro ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const clientId = () => CLIENT_ID_FIXO || store.get('hc_client_id') || '';

// ---------- UI ----------
function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  $('btn-logout').hidden = id === 's-login';
}
function erro(msg) {
  const e = $('err');
  if (!msg) { e.hidden = true; return; }
  e.textContent = msg; e.hidden = false;
  console.error('[hitster]', msg);
}

// ---------- OAuth PKCE ----------
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function randomStr(n = 64) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return Array.from(a, (x) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[x % 62]).join('');
}
async function login() {
  const id = clientId() || $('clientid').value.trim();
  if (!id) { erro('Cole o Client ID do app Spotify.'); return; }
  store.set('hc_client_id', id);
  const verifier = randomStr();
  store.set('hc_verifier', verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const p = new URLSearchParams({
    response_type: 'code', client_id: id, scope: SCOPES, redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256', code_challenge: challenge,
  });
  location.href = 'https://accounts.spotify.com/authorize?' + p;
}
async function tokenRequest(params) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...params }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Falha no login: ' + (j.error_description || j.error || r.status));
  store.set('hc_access', j.access_token);
  store.set('hc_expires', String(Date.now() + (j.expires_in - 60) * 1000));
  if (j.refresh_token) store.set('hc_refresh', j.refresh_token);
  return j.access_token;
}
async function handleCallback() {
  const q = new URLSearchParams(location.search);
  if (q.get('error')) { history.replaceState(null, '', REDIRECT_URI); throw new Error('Spotify recusou o login: ' + q.get('error')); }
  const code = q.get('code');
  if (!code) return false;
  history.replaceState(null, '', REDIRECT_URI);
  await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: store.get('hc_verifier') || '' });
  store.del('hc_verifier');
  return true;
}
async function getToken() {
  const t = store.get('hc_access');
  if (t && Date.now() < Number(store.get('hc_expires') || 0)) return t;
  const rt = store.get('hc_refresh');
  if (!rt) throw new Error('Sessão expirada. Entre de novo.');
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: rt });
}
function logout() {
  ['hc_access', 'hc_expires', 'hc_refresh'].forEach(store.del);
  if (player) player.disconnect();
  location.reload();
}

// ---------- Web API ----------
async function api(path, opts = {}) {
  const r = await fetch('https://api.spotify.com/v1' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + (await getToken()), 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (r.status === 204) return null;
  const txt = await r.text();
  const j = txt ? JSON.parse(txt) : null;
  if (!r.ok) throw new Error(`Spotify API ${r.status}: ${j?.error?.message || txt}`);
  return j;
}

// ---------- Player (Web Playback SDK) ----------
let player = null, deviceId = null;
let sdkReady = false, wantPlayer = false;
window.onSpotifyWebPlaybackSDKReady = () => { sdkReady = true; if (wantPlayer) initPlayer(); };

function initPlayer() {
  if (player) return;
  player = new Spotify.Player({
    name: 'Hitster caseiro',
    getOAuthToken: (cb) => getToken().then(cb).catch((e) => erro(e.message)),
    volume: 0.9,
  });
  player.addListener('ready', ({ device_id }) => {
    deviceId = device_id;
    $('start-status').textContent = 'Conectado. Toque em Começar.';
    $('btn-start').disabled = false;
  });
  player.addListener('not_ready', () => { deviceId = null; $('start-status').textContent = 'Player desconectou. Recarregue a página.'; });
  player.addListener('initialization_error', ({ message }) => erro('Este navegador não suporta o player do Spotify: ' + message));
  player.addListener('authentication_error', ({ message }) => { erro('Erro de autenticação: ' + message); });
  player.addListener('account_error', () => erro('O player do Spotify exige conta Premium.'));
  player.addListener('playback_error', ({ message }) => erro('Erro ao tocar: ' + message));
  player.addListener('autoplay_failed', () => erro('O navegador bloqueou o som. Toque em "Tocar de novo".'));
  player.addListener('player_state_changed', hideMediaSession);
  player.connect().then((ok) => { if (!ok) erro('Não consegui conectar o player do Spotify.'); });
}

// Tenta esconder o nome da faixa da notificação/tela de bloqueio do Android.
function hideMediaSession() {
  try {
    if ('mediaSession' in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: '🎵 ???', artist: 'Hitster caseiro' });
    }
  } catch {}
}

// ---------- Rodada ----------
let current = null; // { id, start, track }
let watchTimer = null, stopAt = 0, playing = false;

function parseTrackId(text) {
  const m = String(text).match(/(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/);
  return m ? m[1] : null;
}

async function novaCarta(trackId) {
  erro(null);
  show('s-play');
  $('reveal').hidden = true;
  $('play-status').textContent = 'Carregando…';
  try {
    const track = await api('/tracks/' + trackId);
    const dur = track.duration_ms;
    // trecho aleatório no "miolo": entre 25% e 70% da música
    const min = Math.floor(dur * 0.25), max = Math.max(min, Math.floor(dur * 0.70) - SNIPPET_MS);
    const start = Math.floor(min + Math.random() * (max - min));
    current = { id: trackId, start, track };
    await tocar();
  } catch (e) { erro(e.message); $('play-status').textContent = 'Não deu para tocar.'; }
}

async function tocar() {
  if (!current) return;
  erro(null);
  clearInterval(watchTimer);
  if (!deviceId) { erro('Player não está pronto. Recarregue a página.'); return; }
  $('play-status').textContent = 'Tocando…';
  setRing(0); $('count').textContent = '15';
  await api('/me/player/play?device_id=' + encodeURIComponent(deviceId), {
    method: 'PUT', body: JSON.stringify({ uris: ['spotify:track:' + current.id], position_ms: current.start }),
  });
  hideMediaSession();
  // Conta os 15 s a partir do momento em que o player realmente começa a tocar.
  let began = 0;
  const t0 = Date.now();
  watchTimer = setInterval(async () => {
    const st = await player.getCurrentState().catch(() => null);
    const isPlaying = st && !st.paused;
    if (!began) {
      if (isPlaying) { began = Date.now(); $('play-disc').classList.add('on'); }
      else if (Date.now() - t0 > 8000) { clearInterval(watchTimer); $('play-status').textContent = 'Não começou a tocar. Tente "Tocar de novo".'; }
      return;
    }
    const el = Date.now() - began;
    setRing(Math.min(1, el / SNIPPET_MS));
    $('count').textContent = String(Math.max(0, Math.ceil((SNIPPET_MS - el) / 1000)));
    if (el >= SNIPPET_MS) {
      clearInterval(watchTimer);
      await player.pause().catch(() => {});
      $('play-disc').classList.remove('on');
      $('play-status').textContent = 'Fim do trecho. Onde essa carta entra na sua linha do tempo?';
    }
  }, 200);
}

function setRing(frac) { $('ring').style.strokeDashoffset = String(339.3 * (1 - frac)); }

function revelar() {
  if (!current) return;
  const t = current.track;
  const box = $('reveal');
  box.innerHTML = '';
  const year = document.createElement('div'); year.className = 'year'; year.textContent = (t.album?.release_date || '').slice(0, 4);
  const name = document.createElement('b'); name.textContent = t.name;
  const art = document.createElement('span'); art.className = 'muted'; art.textContent = t.artists.map((a) => a.name).join(', ');
  box.append(year, name, art);
  box.hidden = !box.hidden;
}

// ---------- Scanner ----------
let stream = null, scanning = false, detector = null;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function abrirScanner() {
  erro(null);
  await player?.pause().catch(() => {});
  clearInterval(watchTimer);
  $('play-disc').classList.remove('on');
  show('s-scan');
  try {
    if ('BarcodeDetector' in window) {
      try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; }
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    const v = $('video'); v.srcObject = stream; await v.play();
    scanning = true; requestAnimationFrame(loopScan);
  } catch (e) { erro('Não consegui abrir a câmera: ' + e.message + '. Dá para colar o link manualmente.'); }
}
function fecharScanner() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop()); stream = null;
}
async function loopScan() {
  if (!scanning) return;
  const v = $('video');
  if (v.readyState >= 2) {
    let text = null;
    try {
      if (detector) {
        const codes = await detector.detect(v);
        text = codes[0]?.rawValue || null;
      } else if (window.jsQR) {
        const w = v.videoWidth, h = v.videoHeight, s = Math.min(1, 640 / Math.max(w, h));
        canvas.width = w * s; canvas.height = h * s;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
      }
    } catch {}
    if (text) {
      const id = parseTrackId(text);
      if (id) { navigator.vibrate?.(80); fecharScanner(); novaCarta(id); return; }
      erro('QR lido, mas não é um link de música do Spotify: ' + text.slice(0, 80));
    }
  }
  setTimeout(() => requestAnimationFrame(loopScan), 120);
}

// ---------- Eventos ----------
$('btn-login').onclick = login;
$('btn-logout').onclick = logout;
$('btn-start').onclick = async () => {
  try { await player.activateElement(); } catch {}
  abrirScanner();
};
$('btn-again').onclick = () => tocar().catch((e) => erro(e.message));
$('btn-reveal').onclick = revelar;
$('btn-next').onclick = abrirScanner;
$('manual-form').onsubmit = (ev) => {
  ev.preventDefault();
  const id = parseTrackId($('manual').value);
  if (!id) { erro('Link inválido. Use um link open.spotify.com/track/…'); return; }
  fecharScanner(); novaCarta(id);
};

// ---------- Início ----------
(async function boot() {
  $('clientid-box').hidden = !!clientId();
  try {
    await handleCallback();
    if (store.get('hc_refresh') || store.get('hc_access')) {
      await getToken();
      show('s-start');
      wantPlayer = true;
      if (sdkReady) initPlayer();
    } else {
      show('s-login');
    }
  } catch (e) {
    show('s-login');
    erro(e.message);
  }
})();
