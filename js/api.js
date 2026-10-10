// ============================================================
//  api.js — MEL NLR Indonesia v4 (Supabase)
//  Koneksi ke Supabase PostgreSQL menggantikan Google Apps Script
//  Fungsi publik API.get(scnId) tetap sama → semua halaman bekerja
// ============================================================

const API = (() => {

  // ── SUPABASE CONFIG ───────────────────────────────────────
  // anon key diambil dari AUTH agar satu tempat saja
  function _headers() {
    const token = AUTH.getToken();
    return {
      'apikey'       : AUTH.SUPABASE_ANON,
      'Authorization': token ? `Bearer ${token}` : `Bearer ${AUTH.SUPABASE_ANON}`,
      'Content-Type' : 'application/json',
    };
  }

  const BASE = () => `${AUTH.SUPABASE_URL}/rest/v1`;

  // ── CACHE ─────────────────────────────────────────────────
  const CACHE_TTL_MS = 2 * 60 * 1000; // 2 menit

  function getCached(key) {
    try {
      const raw = sessionStorage.getItem('mel_cache_' + key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(e) { return null; }
  }

  function setCached(key, data) {
    try {
      sessionStorage.setItem('mel_cache_' + key, JSON.stringify({ data, ts: Date.now() }));
    } catch(e) {}
  }

  function isStale(cached) {
    if (!cached) return true;
    return (Date.now() - cached.ts) > CACHE_TTL_MS;
  }

  function clearCache(scnId) {
    try {
      const prefix = 'mel_cache_';
      if (scnId) {
        sessionStorage.removeItem(prefix + scnId);
        sessionStorage.removeItem(prefix + 'all');
      } else {
        Object.keys(sessionStorage)
          .filter(k => k.startsWith(prefix))
          .forEach(k => sessionStorage.removeItem(k));
      }
      _activeScnId = undefined;
    } catch(e) {}
  }

  // ── LOADING MODAL ─────────────────────────────────────────
  function showLoading(scnLabel) {
    let el = document.getElementById('_api_loading_modal');
    if (!el) {
      el = document.createElement('div');
      el.id = '_api_loading_modal';
      el.innerHTML = `
        <div id="_api_loading_backdrop" style="
          position:fixed;inset:0;background:rgba(15,23,42,.45);
          z-index:9999;display:flex;align-items:center;justify-content:center;
          backdrop-filter:blur(2px);animation:_fadeIn .15s ease
        ">
          <div style="
            background:#fff;border-radius:16px;padding:28px 36px;
            display:flex;flex-direction:column;align-items:center;gap:16px;
            box-shadow:0 20px 60px rgba(0,0,0,.18);min-width:220px;
          ">
            <div style="position:relative;width:44px;height:44px">
              <svg style="animation:_spin 1s linear infinite;width:44px;height:44px"
                viewBox="0 0 44 44" fill="none">
                <circle cx="22" cy="22" r="18" stroke="#f1f5f9" stroke-width="4"/>
                <path d="M22 4a18 18 0 0 1 18 18" stroke="#F97316" stroke-width="4"
                  stroke-linecap="round"/>
              </svg>
            </div>
            <div style="text-align:center">
              <div id="_api_loading_label" style="
                font-size:.85rem;font-weight:700;color:#1e293b;margin-bottom:4px
              ">Memuat data...</div>
              <div id="_api_loading_sub" style="font-size:.72rem;color:#94a3b8">
                Mengambil data dari Supabase
              </div>
            </div>
          </div>
        </div>
        <style>
          @keyframes _fadeIn { from{opacity:0} to{opacity:1} }
          @keyframes _spin   { to{transform:rotate(360deg)} }
        </style>`;
      document.body.appendChild(el);
    }
    const label = document.getElementById('_api_loading_label');
    const sub   = document.getElementById('_api_loading_sub');
    if (label) label.textContent = scnLabel ? `Memuat ${scnLabel}...` : 'Memuat data...';
    if (sub)   sub.textContent   = 'Mengambil 6 tabel dari Supabase';
    el.style.display = 'block';
  }

  function hideLoading() {
    const el = document.getElementById('_api_loading_modal');
    if (el) el.style.display = 'none';
  }

  // ── FETCH DARI SUPABASE REST API ──────────────────────────
  // RLS otomatis filter by scn_id sesuai JWT user
  // scnId hanya dipakai untuk nlr_admin yang pilih filter manual
  async function fetchTable(table, scnId, select = '*') {
    let url = `${BASE()}/${table}?select=${encodeURIComponent(select)}&order=submitted_at.desc`;
    if (scnId) url += `&scn_id=eq.${encodeURIComponent(scnId)}`;

    try {
      const resp = await fetch(url, { headers: _headers() });
      if (!resp.ok) {
        console.warn(`[API] ${table} HTTP ${resp.status}`);
        return [];
      }
      return await resp.json();
    } catch(e) {
      console.warn(`[API] Gagal fetch ${table}:`, e.message);
      return [];
    }
  }

  // ── NORMALIZE DATA AWAL ────────────────────────────────────
  // Mapping kolom Supabase → field yang dipakai dashboard
  function normalizeDataAwal(rows) {
    if (!rows || !rows.length) return [];
    return rows.map(r => {
      const usia = r.Usia ? parseInt(r.Usia) : 0;
      const gu =
        usia <= 0  ? '' :
        usia <= 5  ? '0-5 th' :
        usia <= 12 ? '6-12 th' :
        usia <= 17 ? '13-17 th' :
        usia <= 24 ? '18-24 th' : '25+ th';

      return {
        nama    : r.Nama_Anak        || '—',
        cbr     : r.CBR_Worker       || '—',
        ragam   : r.Ragam_Disabiltas || '—',
        rgd     : r.Ragam_Disabiltas || '',
        level   : r.Level_Disabilitas|| '—',
        kampung : r.Kampung_Dusun    || '—',
        desa    : r.Desa             || '—',
        gender  : (r.Jenis_Kelamin   || '').toLowerCase().includes('perempuan') ? 'P' : 'L',
        tl      : r.Tanggal_Lahir    || '',
        usia,
        gu,
        sp      : r.Skala_Pengasuh   != null ? parseFloat(r.Skala_Pengasuh) : null,
        sa      : r.Skala_Anak       != null ? parseFloat(r.Skala_Anak)     : null,
        ep      : (r.Epilepsi        || '').toLowerCase() === 'ya',
        ob      : (r.Layanan_Obat    || '').toLowerCase() === 'ya',
        obf     : r.Layanan_Obat_Fasilitas || '',
        obl     : r.Layanan_Obat_Lokasi    || '',
        tr      : (r.Layanan_Terapi  || '').toLowerCase() === 'ya',
        trj     : r.Layanan_Terapi_Jenis   || '',
        trs     : r.Layanan_Terapi_Sumber  || '',
        stp     : r.Status_Pengasuh        || '',
        stpl    : r.Status_Pengasuh_Lain   || '',
        np      : r.Nama_Pengasuh          || '',
        nka     : r.nama_anak_kobo         || '',
        tka     : r.Tanggal_Lahir          || '',
        nkp     : r.Nama_Pengasuh          || '',
        tkp     : r.Status_Pengasuh        || '',
        wk      : r.Waktu_kunjungan_staf_CBR || '',
        lat     : r.lokasi_lat  != null ? parseFloat(r.lokasi_lat) : null,
        lon     : r.lokasi_lon  != null ? parseFloat(r.lokasi_lon) : null,
        provinsi: r.Provinsi    || '',
        scn_id  : r.scn_id      || '',
        scn     : r.scn_id      || '',
        irp     : 'Aktif',
        hari    : 999,
        _tema   : null,
      };
    }).filter(a => a.nama && a.nama !== '—');
  }

  // ── NORMALIZE OBSERVASI ────────────────────────────────────
  function normalizeObs(rows) {
    if (!rows || !rows.length) return [];
    return rows.map(r => ({
      na      : r.Nama_Anak              || '—',
      cb      : r.CBR_Worker             || '—',
      tgl     : r.Tanggal_Kunjungan
                  ? String(r.Tanggal_Kunjungan).substring(0, 10)
                  : (r.submitted_at ? String(r.submitted_at).substring(0,10) : '—'),
      st      : r.Situasi_Keluarga       || '',
      kg      : r.Kondisi_Anak           || '',
      pf      : r.Perkembangan_Fungsi    || '',
      lg      : r.Langkah_Lanjut         || '',
      lat     : r.lokasi_lat  != null ? parseFloat(r.lokasi_lat) : null,
      lon     : r.lokasi_lon  != null ? parseFloat(r.lokasi_lon) : null,
      scn     : r.scn_id      || '',
      provinsi: r.Provinsi    || '',
    }));
  }

  // ── NORMALIZE BUKU HARIAN ─────────────────────────────────
  function normalizeDiary(rows) {
    if (!rows || !rows.length) return [];
    return rows.map(r => ({
      nama        : r.Nama_Anak    || '—',
      cbr_worker  : r.CBR_Worker   || '—',
      scn         : r.scn_id       || '',
      provinsi    : r.Provinsi     || '',
      submitted_at: r.submitted_at || '',
    }));
  }

  // ── NORMALIZE EVALUASI MENENGAH ───────────────────────────
  function normalizeEvalMenengah(rows) {
    if (!rows || !rows.length) return [];
    return rows.map(r => ({
      nama        : r.Nama_Anak    || '—',
      cbr_worker  : r.CBR_Worker   || '—',
      tujuan1_skor: r.Tujuan_1_Skor != null ? parseFloat(r.Tujuan_1_Skor) : null,
      tujuan2_skor: r.Tujuan_2_Skor != null ? parseFloat(r.Tujuan_2_Skor) : null,
      tujuan3_skor: r.Tujuan_3_Skor != null ? parseFloat(r.Tujuan_3_Skor) : null,
      scn         : r.scn_id       || '',
      provinsi    : r.Provinsi     || '',
      submitted_at: r.submitted_at || '',
    }));
  }

  // ── NORMALIZE EVALUASI AKHIR ──────────────────────────────
  function normalizeEvalAkhir(rows) {
    if (!rows || !rows.length) return [];
    return rows.map(r => ({
      nama        : r.Nama_Anak          || '—',
      cbr_worker  : r.CBR_Worker         || '—',
      tujuan1_cap : r.Tujuan_1_Tercapai  || '',
      tujuan2_cap : r.Tujuan_2_Tercapai  || '',
      tujuan3_cap : r.Tujuan_3_Tercapai  || '',
      scn         : r.scn_id             || '',
      provinsi    : r.Provinsi           || '',
      submitted_at: r.submitted_at       || '',
    }));
  }

  // ── HITUNG STATISTIK ───────────────────────────────────────
  function calcStats(anak, obs) {
    const lastVisit = {};
    obs.forEach(o => {
      if (!o.na || !o.tgl || o.tgl === '—') return;
      const key = o.na.toLowerCase();
      if (!lastVisit[key] || o.tgl > lastVisit[key]) lastVisit[key] = o.tgl;
    });
    anak.forEach(a => { a.hari = 999; });
    return { anak };
  }

  // ── BUILD WORKERS ──────────────────────────────────────────
  function buildWorkers(anak, obs, perencanaan, diary, evalMenengah, evalAkhir) {
    const now   = new Date();
    const bulan = now.getMonth();
    const tahun = now.getFullYear();
    const workerMap = {};

    function addWorker(cb) {
      if (!cb || cb === '—') return;
      const key = cb.toLowerCase().replace(/\s/g,'_').replace(/\./g,'');
      if (!workerMap[key]) {
        workerMap[key] = { id:key, nama:cb, anak:0, kunjungan_bulan:0, irp_aktif:0, late:0 };
      }
    }

    (anak||[]).forEach(a => addWorker(a.cbr));
    (obs||[]).forEach(o => addWorker(o.cb));
    (perencanaan||[]).forEach(r => addWorker(r.cbr_worker||r.cb));
    (diary||[]).forEach(r => addWorker(r.cbr_worker||r.cb));
    (evalMenengah||[]).forEach(r => addWorker(r.cbr_worker||r.cb));
    (evalAkhir||[]).forEach(r => addWorker(r.cbr_worker||r.cb));

    anak.forEach(a => {
      if (!a.cbr) return;
      const key = a.cbr.toLowerCase().replace(/\s/g,'_').replace(/\./g,'');
      if (workerMap[key]) workerMap[key].anak++;
    });

    obs.forEach(o => {
      if (!o.tgl || o.tgl === '—') return;
      const d = new Date(o.tgl);
      if (d.getMonth() === bulan && d.getFullYear() === tahun) {
        const key = o.cb?.toLowerCase().replace(/\s/g,'_').replace(/\./g,'');
        if (key && workerMap[key]) workerMap[key].kunjungan_bulan++;
      }
    });

    anak.forEach(a => {
      const key = a.cbr?.toLowerCase().replace(/\s/g,'_').replace(/\./g,'');
      const w   = key ? workerMap[key] : null;
      if (!w) return;
      if (a.irp === 'Aktif') w.irp_aktif++;
    });

    return Object.values(workerMap);
  }

  // ── HITUNG ITT ─────────────────────────────────────────────
  function calcITT(anak, obs) {
    const total    = anak.length || 1;
    const punyaObs = anak.filter(a => {
      const key = a.nama.toLowerCase();
      return obs.some(o => o.na && o.na.toLowerCase() === key);
    }).length;
    const terapi   = anak.filter(a => a.tr).length;
    const skorBaik = anak.filter(a => a.sp != null && a.sp >= 5).length;
    return {
      'O1-i1': { cap: skorBaik,              target_y1: 50,  target_total: 150 },
      'O1-i2': { cap: punyaObs,              target_y1: 30,  target_total: 100 },
      'O1-i3': { cap: total,                 target_y1: 200, target_total: 200 },
      'O1-i4': { cap: terapi,                target_y1: 40,  target_total: 120 },
      'O1-i5': { cap: terapi,                target_y1: 40,  target_total: 120 },
      'O1-i6': { cap: punyaObs,              target_y1: 35,  target_total: 100 },
      'O2-i1': { cap: Math.round(total*.65), target_y1: 100, target_total: 200 },
      'O2-i2': { cap: Math.round(total*.35), target_y1: 60,  target_total: 150 },
      'O2-i3': { cap: Math.round(total*.48), target_y1: 80,  target_total: 180 },
      'O2-i4': { cap: 5,                     target_y1: 8,   target_total: 20  },
      'O3-i1': { cap: 3,                     target_y1: 4,   target_total: 8   },
      'O3-i2': { cap: punyaObs,              target_y1: 40,  target_total: 120 },
      'O3-i3': { cap: 8,                     target_y1: 8,   target_total: 40  },
      'O3-i4': { cap: 8,                     target_y1: 8,   target_total: 40  },
      'O3-i5': { cap: 4,                     target_y1: 4,   target_total: 8   },
      'O4-i1': { cap: 3,                     target_y1: 5,   target_total: 15  },
      'O4-i2': { cap: 5,                     target_y1: 8,   target_total: 20  },
      'O4-i3': { cap: 15,                    target_y1: 20,  target_total: 60  },
      'O4-i4': { cap: 9,                     target_y1: 20,  target_total: 50  },
      'O4-i5': { cap: 12,                    target_y1: 30,  target_total: 80  },
      'O5-i1': { cap: Math.round(total*.35), target_y1: 50,  target_total: 120 },
      'O5-i2': { cap: Math.round(total*.22), target_y1: 40,  target_total: 100 },
      'O5-i3': { cap: 5,                     target_y1: 10,  target_total: 30  },
      'O5-i4': { cap: 4,                     target_y1: 8,   target_total: 20  },
      'O5-i5': { cap: 16,                    target_y1: 20,  target_total: 50  },
      'O6-i1': { cap: 5,                     target_y1: 20,  target_total: 60  },
      'O6-i2': { cap: 8,                     target_y1: 25,  target_total: 80  },
      'O6-i3': { cap: 1,                     target_y1: 2,   target_total: 5   },
      'O6-i4': { cap: 2,                     target_y1: 6,   target_total: 20  },
      'O7-i1': { cap: 1,                     target_y1: 3,   target_total: 10  },
      'O7-i2': { cap: 4,                     target_y1: 10,  target_total: 30  },
      'O7-i3': { cap: 1,                     target_y1: 2,   target_total: 8   },
      'O7-i4': { cap: 2,                     target_y1: 4,   target_total: 12  },
      'O7-i5': { cap: 0,                     target_y1: 0,   target_total: 0   },
    };
  }

  // ── UPDATE BADGE TOPBAR ────────────────────────────────────
  function setBadge(isReal, lastSync) {
    const badge  = document.getElementById('data-source-badge');
    const syncEl = document.getElementById('sync-time');
    if (badge) {
      badge.style.display = 'inline';
      if (isReal) {
        badge.textContent      = '● Live';
        badge.style.background = '#dcfce7';
        badge.style.color      = '#15803d';
        badge.style.border     = '1px solid #bbf7d0';
      } else {
        badge.textContent      = '◎ Tidak ada data';
        badge.style.background = '#fee2e2';
        badge.style.color      = '#991b1b';
        badge.style.border     = '1px solid #fecaca';
      }
    }
    if (syncEl && lastSync) {
      const d = new Date(lastSync);
      syncEl.style.display = 'inline';
      syncEl.textContent   = 'Sync: ' + d.toLocaleString('id-ID', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });
    }
  }

  // ── BUILD RESULT ───────────────────────────────────────────
  function buildResult(scnId, rawAwal, rawObs, rawRencana, rawDiary, rawEvalMenengah, rawEvalAkhir) {
    const anak         = normalizeDataAwal(rawAwal || []);
    const obs          = normalizeObs(rawObs || []);
    const perencanaan  = rawRencana      || [];
    const diary        = normalizeDiary(rawDiary || []);
    const evalMenengah = normalizeEvalMenengah(rawEvalMenengah || []);
    const evalAkhir    = normalizeEvalAkhir(rawEvalAkhir || []);

    // Waktu sync = submitted_at terbaru
    const lastSync = (rawAwal && rawAwal[0]) ? rawAwal[0].submitted_at : null;

    calcStats(anak, obs);
    const workers = buildWorkers(anak, obs, perencanaan, diary, evalMenengah, evalAkhir);
    const itt     = calcITT(anak, obs);

    const aktivitas = obs
      .filter(o => o.tgl && o.tgl !== '—')
      .sort((a, b) => b.tgl.localeCompare(a.tgl))
      .slice(0, 10)
      .map(o => ({
        tgl    : o.tgl,
        nama   : `Kunjungan CBR — ${o.na}`,
        outcome: 1,
        peserta: 1,
        lokasi : '—',
        scn    : o.scn || scnId || '',
      }));

    const stakeholder = {
      'CBR Worker'    : { total: workers.length, L: Math.ceil(workers.length*.4),  P: Math.floor(workers.length*.6) },
      'Pengasuh/Ortu' : { total: anak.length,    L: Math.round(anak.length*.3),    P: Math.round(anak.length*.7)   },
      'Guru'          : { total: 55, L: 25, P: 30 },
      'Nakes'         : { total: 8,  L: 3,  P: 5  },
      'Pemerintah'    : { total: 10, L: 7,  P: 3  },
      'Staff Mitra'   : { total: 7,  L: 5,  P: 2  },
    };

    const hasData = anak.length || obs.length || perencanaan.length ||
                    diary.length || evalMenengah.length || evalAkhir.length;
    setBadge(!!hasData, lastSync);

    const scnLabel = scnId
      ? `SCN ${scnId.charAt(0).toUpperCase() + scnId.slice(1)}`
      : 'Semua SCN';

    return {
      meta: {
        scn      : scnLabel,
        project  : 'BEN',
        provinsi : (rawAwal && rawAwal[0]) ? rawAwal[0].Provinsi || '' : '',
        tahun    : new Date().getFullYear(),
        lastSync,
        sumber   : 'Supabase',
      },
      workers, anak, obs, aktivitas, stakeholder,
      perencanaan, diary, evalMenengah, evalAkhir,
      cerita : [],
      itt    : { Y1_Q2: itt },
    };
  }

  // ── LOAD DATA (6 tabel paralel) ───────────────────────────
  async function load(scnId) {
    const [rawAwal, rawObs, rawRencana, rawDiary, rawEvalMenengah, rawEvalAkhir] =
      await Promise.all([
        fetchTable('data_awal',          scnId),
        fetchTable('data_obs',           scnId),
        fetchTable('data_rencana',       scnId),
        fetchTable('data_diary',         scnId),
        fetchTable('data_eval_menengah', scnId),
        fetchTable('data_eval_akhir',    scnId),
      ]);

    const hasAnyData = rawAwal.length || rawObs.length || rawRencana.length ||
                       rawDiary.length || rawEvalMenengah.length || rawEvalAkhir.length;

    if (!hasAnyData) {
      console.warn(`[API] Tidak ada data untuk SCN: ${scnId || 'semua'}`);
      setBadge(false, null);
      return null;
    }

    return buildResult(scnId, rawAwal, rawObs, rawRencana, rawDiary, rawEvalMenengah, rawEvalAkhir);
  }

  // ── ACTIVE SCN TRACKER ────────────────────────────────────
  let _activeScnId = undefined;

  // ── PUBLIC: get(scnId) ────────────────────────────────────
  async function get(scnId) {
    _activeScnId = scnId;

    const cacheKey = scnId || 'all';
    const cached   = getCached(cacheKey);

    if (cached && cached.data) {
      if (isStale(cached)) {
        const requestedScnId = scnId;
        setTimeout(async () => {
          try {
            const fresh = await load(requestedScnId);
            if (fresh) {
              setCached(requestedScnId || 'all', fresh);
              if (_activeScnId === requestedScnId && window.renderPage) {
                window.renderPage(fresh, requestedScnId);
              }
            }
          } catch(e) { console.warn('[API] Background revalidate gagal:', e.message); }
        }, 0);
      }
      return cached.data;
    }

    const scnLabel = scnId
      ? `SCN ${scnId.charAt(0).toUpperCase()+scnId.slice(1)}`
      : 'Semua SCN';
    showLoading(scnLabel);

    try {
      const result = await load(scnId);

      if (_activeScnId !== scnId) {
        console.warn('[API] SCN berubah saat fetch, abaikan response');
        return null;
      }

      if (result) setCached(cacheKey, result);

      if (!result) {
        setBadge(false, null);
        return {
          meta        : { scn: scnLabel, project: 'BEN', tahun: new Date().getFullYear() },
          workers     : [], anak: [], obs: [],
          aktivitas   : [], stakeholder: {}, cerita: [],
          perencanaan : [], diary: [], evalMenengah: [], evalAkhir: [],
          itt         : { Y1_Q2: {} },
        };
      }

      return result;
    } finally {
      hideLoading();
    }
  }

  // ── TEMA (placeholder — dulu dari Gemini via GAS) ─────────
  function getTema(anak, field) { return {}; }
  function hasTema(anak)        { return false; }

  return { get, getTema, hasTema, setBadge, clearCache };

})();
