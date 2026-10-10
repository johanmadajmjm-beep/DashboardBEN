// ============================================================
// Supabase Edge Function: kobo-webhook
// Menerima POST dari KoboToolbox REST Service
// → Parsing payload → INSERT ke tabel yang sesuai
//
// Deploy: supabase functions deploy kobo-webhook
// URL:    https://wajimecqdeqjljcavzmk.supabase.co/functions/v1/kobo-webhook
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Map form_id Kobo B ke nama tabel Supabase
// GANTI nilai ini dengan form_id aktual dari KoboToolbox kamu
// Cara cek: buka form di Kobo → Settings → Form ID (uid)
const FORM_TABLE_MAP: Record<string, string> = {
  // form_id (uid)          : nama tabel Supabase
  "FORM_ID_PENDATAAN_AWAL"  : "data_awal",
  "FORM_ID_EVAL_MENENGAH"   : "data_eval_menengah",
  "FORM_ID_EVAL_AKHIR"      : "data_eval_akhir",
  "FORM_ID_BUKU_HARIAN"     : "data_diary",
  "FORM_ID_OBSERVASI"       : "data_obs",
  "FORM_ID_PERENCANAAN"     : "data_rencana",
};

// Map Provinsi → scn_id (untuk RLS)
// Sesuaikan dengan nilai pilihan di form Kobo
const PROVINSI_SCN_MAP: Record<string, string> = {
  "ntt"              : "manggarai",   // default NTT = Manggarai
  "manggarai"        : "manggarai",
  "kupang"           : "kupang",
  "tts"              : "tts",
  "jawa_timur"       : "jatim",
  "banyuwangi"       : "banyuwangi",
  "jember"           : "jember",
  "situbondo"        : "situbondo",
  "sulawesi_tengah"  : "sulteng",
  "palu"             : "palu",
  "sigi"             : "sigi",
};

// ----------------------------------------------------------------
// Helper: ekstrak scn_id dari payload Kobo
// Kobo menyimpan nilai select_one sebagai string (nama opsi)
// ----------------------------------------------------------------
function extractScnId(data: Record<string, unknown>): string {
  // Coba ambil dari Kabupaten dulu (lebih spesifik)
  const kabupaten = (
    (data["Kabupaten"] as string) ||
    (data["Kabupaten_002"] as string) ||
    (data["Kabupaten_001"] as string) ||
    ""
  ).toLowerCase().replace(/\s+/g, "_");

  if (kabupaten && PROVINSI_SCN_MAP[kabupaten]) {
    return PROVINSI_SCN_MAP[kabupaten];
  }

  // Fallback ke Provinsi
  const provinsi = ((data["Provinsi"] as string) || "").toLowerCase().replace(/\s+/g, "_");
  return PROVINSI_SCN_MAP[provinsi] || "unknown";
}

// ----------------------------------------------------------------
// Helper: parse geopoint "lat lon alt acc" → lat, lon
// ----------------------------------------------------------------
function parseGeopoint(raw: unknown): { lat: number | null; lon: number | null } {
  if (!raw || typeof raw !== "string") return { lat: null, lon: null };
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 2) return { lat: null, lon: null };
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  return {
    lat: isNaN(lat) ? null : lat,
    lon: isNaN(lon) ? null : lon,
  };
}

// ----------------------------------------------------------------
// Helper: tambah kolom metadata ke payload sebelum INSERT
// ----------------------------------------------------------------
function enrichPayload(
  data: Record<string, unknown>,
  formTable: string
): Record<string, unknown> {
  const enriched = { ...data };

  // Metadata
  enriched["kobo_submission_id"] = String(data["_id"] || data["id"] || "");
  enriched["submitted_at"] = data["_submission_time"] || new Date().toISOString();
  enriched["scn_id"] = extractScnId(data);

  // Parse geopoint sesuai form
  const geopointField =
    formTable === "data_obs"     ? "Lokasi_kunjungan" :
    formTable === "data_rencana" ? "Lokasi_penyusunan_rencana" :
    "Lokasi";

  if (data[geopointField]) {
    const { lat, lon } = parseGeopoint(data[geopointField]);
    enriched["lokasi_lat"] = lat;
    enriched["lokasi_lon"] = lon;
  }

  // Hapus field internal Kobo yang tidak ada di skema tabel
  const koboInternalFields = [
    "_id", "_uuid", "_submission_time", "_submitted_by",
    "_xform_id_string", "_version", "_status", "_tags",
    "_notes", "_validation_status", "_bamboo_dataset_id",
    "formhub/uuid", "meta/instanceID", "meta/deprecatedID",
    "__version__",
  ];
  for (const f of koboInternalFields) {
    delete enriched[f];
  }

  return enriched;
}

// ----------------------------------------------------------------
// MAIN HANDLER
// ----------------------------------------------------------------
Deno.serve(async (req: Request) => {
  // Hanya terima POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verifikasi token keamanan dari header
  // Kobo REST Service bisa mengirim custom header
  const authHeader = req.headers.get("Authorization") || "";
  const webhookSecret = Deno.env.get("KOBO_WEBHOOK_SECRET") || "";
  if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse JSON payload dari Kobo
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Identifikasi form dari payload
  const formId: string =
    (payload["_xform_id_string"] as string) ||
    (payload["formhub/uuid"] as string) ||
    "";

  const formTable = FORM_TABLE_MAP[formId];

  if (!formTable) {
    // Form tidak dikenali — log tapi kembalikan 200 agar Kobo tidak retry terus
    console.warn(`Unknown form_id: ${formId}. Payload ignored.`);
    return new Response(
      JSON.stringify({ status: "ignored", reason: "unknown_form_id", form_id: formId }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // Buat Supabase client dengan service_role key (bypass RLS untuk INSERT)
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  // Enrich payload dengan metadata
  const enrichedData = enrichPayload(payload, formTable);

  // INSERT ke tabel yang sesuai
  // ON CONFLICT (kobo_submission_id) → UPDATE (handle resubmit/edit di Kobo)
  const { error } = await supabase
    .from(formTable)
    .upsert(enrichedData, {
      onConflict: "kobo_submission_id",
      ignoreDuplicates: false,
    });

  if (error) {
    console.error(`Insert error to ${formTable}:`, error);
    return new Response(
      JSON.stringify({ error: error.message, table: formTable }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  console.log(`✅ Submission saved to ${formTable}, scn_id: ${enrichedData["scn_id"]}`);

  return new Response(
    JSON.stringify({
      status: "ok",
      table: formTable,
      submission_id: enrichedData["kobo_submission_id"],
      scn_id: enrichedData["scn_id"],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
