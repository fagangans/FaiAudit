// One-off CLI: reset the FaiAudit master account's password in Supabase Auth.
// Usage: node reset-master-password.js <email> <newPassword>
import "dotenv/config";
import { supabase } from "./src/supabase.js";

const [, , email, newPassword] = process.argv;
if (!email || !newPassword || newPassword.length < 8) {
  console.error("Usage: node reset-master-password.js <email> <newPassword (min 8 chars)>");
  process.exit(1);
}

const { data: list, error: listError } = await supabase.auth.admin.listUsers();
if (listError) {
  console.error(`Gagal memuat daftar user: ${listError.message}`);
  process.exit(1);
}

const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`Tidak ada user dengan email '${email}' di Supabase Auth.`);
  process.exit(1);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
if (updateError) {
  console.error(`Gagal reset password: ${updateError.message}`);
  process.exit(1);
}

console.log(`Password untuk '${email}' berhasil direset.`);
