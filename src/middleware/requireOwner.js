import { supabase } from "../supabase.js";

// Memverifikasi JWT Supabase asli dari header Authorization, lalu memetakan
// user yang login ke baris owners miliknya. Tidak pernah percaya owner_id
// yang dikirim langsung oleh client.
export async function requireOwner(req, res, next) {
  const authHeader = req.header("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authorization Bearer token wajib diisi" });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: "Token tidak valid atau sudah kedaluwarsa" });
  }

  const { data: owner, error: ownerError } = await supabase
    .from("owners")
    .select("id, name, business_name, is_master, notify_wa_number")
    .eq("user_id", userData.user.id)
    .single();
  if (ownerError || !owner) {
    return res.status(403).json({ error: "Akun ini belum terdaftar sebagai owner" });
  }

  req.ownerId = owner.id;
  req.owner = owner;
  req.user = userData.user;
  next();
}
