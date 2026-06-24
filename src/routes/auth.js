import express from "express";
import { supabase, supabaseAuth } from "../supabase.js";

export const router = express.Router();

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post("/register", async (req, res) => {
  const { email, password, name, business_name } = req.body || {};
  if (!isValidEmail(email) || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Email valid dan password (min 8 karakter) wajib diisi" });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Nama owner wajib diisi" });
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) return res.status(400).json({ error: createError.message });

  const { error: ownerError } = await supabase.from("owners").insert({
    user_id: created.user.id,
    name,
    business_name: business_name || null,
  });
  if (ownerError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return res.status(400).json({ error: ownerError.message });
  }

  const { data: session, error: signInError } = await supabaseAuth.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) return res.status(400).json({ error: signInError.message });

  res.json({ access_token: session.session.access_token });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== "string") {
    return res.status(400).json({ error: "Email dan password wajib diisi" });
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: "Email atau password salah" });

  res.json({ access_token: data.session.access_token });
});
