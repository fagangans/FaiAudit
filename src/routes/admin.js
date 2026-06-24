import express from "express";
import crypto from "node:crypto";
import { supabase } from "../supabase.js";
import { requireOwner } from "../middleware/requireOwner.js";

export const router = express.Router();

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireMaster(req, res, next) {
  if (!req.owner?.is_master) {
    return res.status(403).json({ error: "Hanya master yang boleh mengelola client" });
  }
  next();
}

router.use(requireOwner, requireMaster);

router.get("/clients", async (req, res) => {
  const { data, error } = await supabase
    .from("owners")
    .select("id, name, business_name, plan, created_at")
    .eq("is_master", false)
    .order("created_at", { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post("/clients", async (req, res) => {
  const { email, name, business_name, plan } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: "Email valid wajib diisi" });
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Nama client wajib diisi" });
  }

  const tempPassword = crypto.randomBytes(9).toString("base64url");

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (createError) return res.status(400).json({ error: createError.message });

  const { data: owner, error: ownerError } = await supabase
    .from("owners")
    .insert({
      user_id: created.user.id,
      name: name.trim(),
      business_name: business_name || null,
      plan: plan || "trial",
      is_master: false,
    })
    .select("id, name, business_name, plan, created_at")
    .single();
  if (ownerError) {
    await supabase.auth.admin.deleteUser(created.user.id);
    return res.status(400).json({ error: ownerError.message });
  }

  res.json({ ...owner, email, temp_password: tempPassword });
});

router.delete("/clients/:id", async (req, res) => {
  const { data: owner, error: findError } = await supabase
    .from("owners")
    .select("id, user_id")
    .eq("id", req.params.id)
    .eq("is_master", false)
    .single();
  if (findError || !owner) return res.status(404).json({ error: "Client tidak ditemukan" });

  const { error } = await supabase.from("owners").delete().eq("id", owner.id);
  if (error) return res.status(400).json({ error: error.message });
  await supabase.auth.admin.deleteUser(owner.user_id);
  res.json({ ok: true });
});
