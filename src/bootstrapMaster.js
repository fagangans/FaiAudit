import { supabase } from "./supabase.js";

// Memastikan akun master (env MASTER_EMAIL/MASTER_PASSWORD) selalu ada di Supabase Auth
// dan punya baris owners sendiri, supaya master juga bisa diaudit bisnisnya sendiri.
export async function bootstrapMasterAccount() {
  const email = (process.env.MASTER_EMAIL || "").trim();
  const password = process.env.MASTER_PASSWORD;
  if (!email || !password) {
    console.warn(
      "[FaiAudit] MASTER_EMAIL/MASTER_PASSWORD belum diisi di .env — tidak ada akun yang bisa login.",
    );
    return;
  }

  // 1. Pastikan user master ada di Supabase Auth. createUser idempoten:
  //    kalau sudah ada, abaikan error "already registered" dan cari id-nya.
  let userId;
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError && !createError.message.includes("already been registered")) {
    console.error(`[FaiAudit] Gagal membuat akun master: ${createError.message}`);
    return;
  }
  userId = created?.user?.id;
  if (!userId) {
    const { data: list } = await supabase.auth.admin.listUsers();
    userId = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  }
  if (!userId) {
    console.error("[FaiAudit] Tidak bisa menemukan user master di Supabase Auth.");
    return;
  }

  // 2. Pastikan baris owners untuk user master ada dan ditandai is_master.
  //    Pakai check-then-insert (bukan onConflict) supaya tidak bergantung pada
  //    nama constraint tertentu.
  const { data: existing } = await supabase
    .from("owners")
    .select("id, is_master")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    if (!existing.is_master) {
      const { error: updErr } = await supabase
        .from("owners")
        .update({ is_master: true })
        .eq("id", existing.id);
      if (updErr) {
        console.error(`[FaiAudit] Gagal menandai owner master: ${updErr.message}`);
        return;
      }
    }
    console.log(`[FaiAudit] Akun master siap: ${email}`);
    return;
  }

  const { error: insertErr } = await supabase
    .from("owners")
    .insert({ user_id: userId, name: "Master", is_master: true });
  if (insertErr) {
    console.error(`[FaiAudit] Gagal membuat baris owner master: ${insertErr.message}`);
    return;
  }

  console.log(`[FaiAudit] Akun master siap: ${email}`);
}
