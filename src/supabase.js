import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    "[FaiAudit] SUPABASE_SERVICE_ROLE_KEY belum diisi di .env — server tidak bisa membaca/menulis ke database.",
  );
}

// Service-role client: dipakai server untuk operasi tepercaya (ingest chat dari
// Baileys, tulis hasil analisis AI). Tidak pernah dipakai langsung untuk
// melayani request HTTP tanpa melalui middleware requireOwner.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Anon-key client: dipakai khusus untuk alur auth (signUp/signInWithPassword)
// supaya password user tidak pernah melalui jalur service-role.
export const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);
