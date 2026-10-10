// ============================================================
//  auth.js — MEL NLR Indonesia v4 (Supabase Auth)
//  Autentikasi via Supabase Auth
//  JWT custom claims: app_metadata.role, app_metadata.scn_id
// ============================================================

const AUTH = (() => {

  // ── SUPABASE CONFIG ───────────────────────────────────────
  // GANTI dengan anon key kamu (bukan service_role!)
  const SUPABASE_URL  = 'https://wajimecqdeqjljcavzmk.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndhamltZWNxZGVxamxqY2F2em1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MjQ0NTMsImV4cCI6MjEwNzIwMDQ1M30.GwG2R-2u1XmMxy8JHreGF_4UbSMCPhuEhGQ-ldzeE3I';

  // ── SCN LIST ──────────────────────────────────────────────
  const SCN_LIST = [
    { id:'manggarai',  label:'SCN Manggarai'            },
    { id:'banyuwangi', label:'SCN Banyuwangi'           },
    { id:'jember',     label:'SCN Jember'               },
    { id:'situbondo',  label:'SCN Situbondo'            },
    { id:'kupang',     label:'SCN Kupang'               },
    { id:'tts',        label:'SCN Timor Tengah Selatan' },
    { id:'palu',       label:'SCN Palu'                 },
    { id:'sigi',       label:'SCN Sigi'                 },
  ];

  const SCN_KEY = 'mel_v4_active_scn';

  // ── SUPABASE CLIENT (minimal, tanpa SDK besar) ────────────
  // Pakai fetch langsung ke Supabase Auth REST API
  async function _authRequest(path, body) {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
      method : 'POST',
      headers: {
        'Content-Type' : 'application/json',
        'apikey'       : SUPABASE_ANON,
      },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error_description || json.msg || 'Auth error');
    return json;
  }

  // ── LOGIN ─────────────────────────────────────────────────
  async function login(username, password) {
    if (!username || !password) {
      return { ok: false, message: 'Username dan password wajib diisi.' };
    }

    try {
      // username = email di Supabase Auth
      const email = username.includes('@') ? username.trim() : `${username.trim()}@mel-scn.id`;

      const result = await _authRequest('/token?grant_type=password', {
        email   : email,
        password: password.trim(),
      });

      // Ambil custom claims dari JWT
      const payload  = _parseJwt(result.access_token);
      const role     = payload?.app_metadata?.role   || 'scn_admin';
      const scn_id   = payload?.app_metadata?.scn_id || null;
      const scnFound = SCN_LIST.find(x => x.id === scn_id);

      const session = {
        access_token : result.access_token,
        refresh_token: result.refresh_token,
        username     : payload?.email?.split('@')[0] || username,
        role,
        scn_id,
        scn_label    : scnFound ? scnFound.label : 'Semua SCN',
        expiredAt    : new Date(Date.now() + result.expires_in * 1000).toISOString(),
        loggedAt     : Date.now(),
      };

      sessionStorage.setItem('mel_v4_session', JSON.stringify(session));
      sessionStorage.removeItem(SCN_KEY);

      return { ok: true, session };

    } catch(e) {
      return { ok: false, message: e.message || 'Login gagal. Periksa username dan password.' };
    }
  }

  // ── LOGOUT ────────────────────────────────────────────────
  async function logout() {
    const s = getSession();
    if (s?.access_token) {
      fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method : 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${s.access_token}` },
      }).catch(() => {});
    }
    sessionStorage.removeItem('mel_v4_session');
    sessionStorage.removeItem(SCN_KEY);
    window.location.href = '../index.html';
  }

  // ── PARSE JWT (tanpa library) ─────────────────────────────
  function _parseJwt(token) {
    try {
      const base64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
      return JSON.parse(atob(base64));
    } catch { return null; }
  }

  // ── GET SESSION ───────────────────────────────────────────
  function getSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem('mel_v4_session'));
      if (!s || !s.access_token) return null;
      if (s.expiredAt && new Date(s.expiredAt) < new Date()) {
        sessionStorage.removeItem('mel_v4_session');
        return null;
      }
      return s;
    } catch { return null; }
  }

  // ── REQUIRE AUTH ──────────────────────────────────────────
  function requireAuth(redirectTo = '../index.html') {
    const s = getSession();
    if (!s) { window.location.href = redirectTo; return null; }
    return s;
  }

  // ── GET TOKEN (untuk header Authorization ke Supabase) ────
  function getToken() {
    const s = getSession();
    return s ? s.access_token : null;
  }

  // ── ROLE CHECKS ───────────────────────────────────────────
  function isSuperAdmin() {
    const s = getSession();
    return s && s.role === 'nlr_admin';
  }

  function isScnAdmin() {
    const s = getSession();
    return s && (s.role === 'nlr_admin' || s.role === 'scn_admin');
  }

  function isCoordOrAbove() {
    const s = getSession();
    return s && ['nlr_admin','scn_admin','coord','worker'].includes(s.role);
  }

  function canAccessMel() {
    const s = getSession();
    return s && (s.role === 'nlr_admin' || s.role === 'scn_admin');
  }

  // ── SCN FILTER ────────────────────────────────────────────
  function getScnFilter() {
    const s = getSession();
    if (!s) return null;
    if (s.role !== 'nlr_admin') return s.scn_id;
    return sessionStorage.getItem(SCN_KEY) || null;
  }

  function setScnFilter(scnId) {
    if (scnId) sessionStorage.setItem(SCN_KEY, scnId);
    else sessionStorage.removeItem(SCN_KEY);
  }

  function updateScnBadge(scnId) {
    const badge = document.getElementById('scn-badge');
    if (!badge) return;
    if (!scnId) { badge.textContent = 'Semua SCN'; return; }
    const found = SCN_LIST.find(x => x.id === scnId);
    badge.textContent = found ? found.label : scnId;
  }

  function applySession(opts = {}) {
    const s = getSession();
    if (!s) return;
    if (opts.onScnSwitch) window.__onScnSwitch = opts.onScnSwitch;
    const q = sel => document.querySelector(sel);
    if (q('#user-av'))     q('#user-av').textContent   = s.username.charAt(0).toUpperCase();
    if (q('#user-name'))   q('#user-name').textContent = s.username.toUpperCase();
    if (q('#user-role'))   q('#user-role').textContent = s.role === 'nlr_admin' ? 'NLR Admin' : 'SCN Admin';
    if (q('#topbar-date')) q('#topbar-date').textContent = new Date().toLocaleDateString('id-ID', {
      weekday:'long', day:'numeric', month:'long', year:'numeric'
    });

    const currentScn = getScnFilter();
    updateScnBadge(currentScn);

    const wrap = q('#scn-switcher-wrap');
    if (wrap && s.role === 'nlr_admin') {
      const sel = document.createElement('select');
      sel.className = 'scn-switcher';
      sel.innerHTML = `<option value="">— Semua SCN —</option>` +
        SCN_LIST.map(x => `<option value="${x.id}">${x.label}</option>`).join('');
      sel.value = currentScn || '';
      sel.addEventListener('change', () => {
        const scnId = sel.value || null;
        setScnFilter(scnId);
        updateScnBadge(scnId);
        if (window.API && API.clearCache) API.clearCache(scnId);
        if (typeof window.__onScnSwitch === 'function') {
          window.__onScnSwitch(scnId);
        } else {
          location.reload();
        }
      });
      wrap.appendChild(sel);
    }
  }

  function initSidebar(activeGroup, activePage) {
    document.querySelectorAll('.nav-sub-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === activePage);
    });
    document.querySelectorAll('.nav-group').forEach(g => {
      const hasActive = g.querySelector('.nav-sub-item.active');
      if (hasActive) g.classList.remove('collapsed');
      else g.classList.add('collapsed');
    });
    document.querySelectorAll('.nav-group-header').forEach(h => {
      const groupId = h.dataset.group;
      const sub     = document.getElementById('sub-' + groupId);
      if (!sub) return;
      h.addEventListener('click', () => {
        const isOpen = h.classList.contains('open');
        document.querySelectorAll('.nav-group-header').forEach(x => x.classList.remove('open'));
        document.querySelectorAll('.nav-sub').forEach(x => x.classList.remove('open'));
        if (!isOpen) { h.classList.add('open'); sub.classList.add('open'); }
      });
    });
    setTimeout(() => {
      if (window.API) {
        const scnId = getScnFilter();
        API.get(scnId).catch(() => {});
      }
    }, 300);
    window.__currentPageId = activePage;
    if (typeof buildBottomNav === 'function') buildBottomNav();
    if (typeof setBottomNavActive === 'function') setBottomNavActive(activePage);
  }

  return {
    login, logout, getSession, requireAuth,
    getToken, isSuperAdmin, isScnAdmin, isCoordOrAbove, canAccessMel,
    getScnFilter, setScnFilter,
    applySession, updateScnBadge, initSidebar,
    SCN_LIST, SUPABASE_URL, SUPABASE_ANON,
  };

})();
