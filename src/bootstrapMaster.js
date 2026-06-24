import { supabase } from "./supabase.js";

function isMasterEmail(email) {
  const masterEmail = (process.env.MASTER_EMAIL || "").trim().toLowerCase();
  return masterEmail && typeof email === "string" && email.trim().toLowerCase() === masterEmail;
}

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

  const { data: existingOwner } = await supabase
    .from("owners")
    .select("id, user_id")
    .eq("is_master", true)
    .maybeSingle();
  if (existingOwner) return;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError && !createError.message.includes("already been registered")) {
    console.error(`[FaiAudit] Gagal membuat akun master: ${createError.message}`);
    return;
  }

  let userId = created?.user?.id;
  if (!userId) {
    const { data: list } = await supabase.auth.admin.listUsers();
    userId = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
  }
  if (!userId) return;

  const { error: ownerError } = await supabase
    .from("owners")
    .upsert({ user_id: userId, name: "Master", is_master: true }, { onConflict: "user_id" });
  if (ownerError) {
    console.error(`[FaiAudit] Gagal membuat baris owner master: ${ownerError.message}`);
    return;
  }

  console.log(`[FaiAudit] Akun master siap: ${email}`);
}

export { isMasterEmail };
