import express from "express";
import { supabaseAuth } from "../supabase.js";
import { logger } from "../logger.js";

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
  if (error) {
    logger.warn({ event: "auth.login_failed", email }, "Login attempt failed");
    return res.status(401).json({ error: "Email atau password salah" });
  }

  logger.info({ event: "auth.login_success", email, user_id: data.user?.id }, "Login successful");

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});

// Tukar refresh_token dengan access_token baru. Tanpa ini, access_token
// Supabase (umur ~1 jam) kedaluwarsa di tengah sesi dan semua panggilan API
// gagal "Token tidak valid" sampai user login ulang manual.
router.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body || {};
  if (typeof refresh_token !== "string" || !refresh_token) {
    return res.status(400).json({ error: "refresh_token wajib diisi" });
  }

  const { data, error } = await supabaseAuth.auth.refreshSession({ refresh_token });
  if (error || !data?.session) {
    return res.status(401).json({ error: "Sesi sudah berakhir, silakan login ulang" });
  }

  res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
});
