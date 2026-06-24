import express from "express";
import { supabaseAuth } from "../supabase.js";

export const router = express.Router();

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Tidak ada endpoint registrasi publik. Hanya akun master (dibuat dari
// MASTER_EMAIL/MASTER_PASSWORD saat server start) yang bisa login, lalu
// master mendaftarkan client lewat /api/admin/clients (lihat routes/admin.js).
router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== "string") {
    return res.status(400).json({ error: "Email dan password wajib diisi" });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: "Email atau password salah" });

  res.json({ access_token: data.session.access_token });
});
