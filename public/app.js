const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const settingsView = document.getElementById("settingsView");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const sheetBody = document.getElementById("sheetBody");
const openSettingsBtn = document.getElementById("openSettings");
const clientForm = document.getElementById("clientForm");
const clientError = document.getElementById("clientError");
const clientTableBody = document.getElementById("clientTableBody");
const passwordForm = document.getElementById("passwordForm");
const passwordError = document.getElementById("passwordError");
const passwordSuccess = document.getElementById("passwordSuccess");
const clientPanel = document.getElementById("clientPanel");
const modalOverlay = document.getElementById("modalOverlay");
const modalContent = document.getElementById("modalContent");
const modalClose = document.getElementById("modalClose");
const introCard = document.getElementById("introCard");
const introClose = document.getElementById("introClose");

function getToken() {
  return localStorage.getItem("faiaudit_token") || "";
}

function getRefreshToken() {
  return localStorage.getItem("faiaudit_refresh") || "";
}

function setToken(token, refresh) {
  localStorage.setItem("faiaudit_token", token);
  if (refresh) localStorage.setItem("faiaudit_refresh", refresh);
}

function clearToken() {
  localStorage.removeItem("faiaudit_token");
  localStorage.removeItem("faiaudit_refresh");
  localStorage.removeItem("faiaudit_view");
}

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

// Tukar refresh_token dengan access_token baru. Mengembalikan true kalau sukses.
async function tryRefreshToken() {
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setToken(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// Pembungkus fetch untuk panggilan API ber-auth: kalau token kedaluwarsa (401),
// coba refresh sekali lalu ulangi request. Tanpa ini, access_token Supabase
// (umur ~1 jam) habis di tengah sesi dan semua aksi gagal "Token tidak valid"
// sampai user login ulang manual.
async function apiFetch(url, options = {}) {
  const opts = { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } };
  let res = await fetch(url, opts);
  if (res.status === 401) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      opts.headers = { ...authHeaders(), ...(options.headers || {}) };
      res = await fetch(url, opts);
    }
  }
  return res;
}

function showView(view) {
  authView.hidden = view !== "auth";
  appView.hidden = view !== "app";
  settingsView.hidden = view !== "settings";
  // Ingat halaman terakhir supaya reload (Ctrl+R) / restart server tidak
  // melempar user kembali ke dashboard. Layar auth tidak disimpan.
  if (view === "app" || view === "settings") {
    localStorage.setItem("faiaudit_view", view);
  }
}

async function showApp() {
  showView("app");
  await loadMe();
  await loadDashboard();
  maybeShowIntro();
}

const INTRO_SEEN_KEY = "faiaudit_intro_seen";

// Kartu kecil pojok kiri bawah berisi penjelasan singkat fitur — muncul
// sekali saja saat pertama kali masuk dashboard, lalu diingat lewat
// localStorage supaya tidak mengganggu di reload/login berikutnya.
function maybeShowIntro() {
  if (localStorage.getItem(INTRO_SEEN_KEY)) return;
  introCard.hidden = false;
}

introClose.addEventListener("click", () => {
  introCard.hidden = true;
  localStorage.setItem(INTRO_SEEN_KEY, "1");
});

function showAuth(message) {
  showView("auth");
  authError.textContent = message || "";
}

async function loadMe() {
  const res = await apiFetch("/api/me");
  if (!res.ok) return;
  const me = await res.json();
  clientPanel.hidden = !me.is_master;
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;

  authError.textContent = "";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal masuk");
    setToken(data.access_token, data.refresh_token);
    showApp();
  } catch (err) {
    authError.textContent = err.message;
  }
});

function logout() {
  clearToken();
  showAuth();
}

document.getElementById("logout").addEventListener("click", logout);
document.getElementById("logoutSettings").addEventListener("click", logout);

function stageBadge(stage) {
  const span = document.createElement("span");
  span.className = `stage stage-${stage}`;
  span.textContent = stage;
  return span;
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text ?? "-";
  return td;
}

async function loadDashboard() {
  const res = await apiFetch("/api/dashboard");
  if (res.status === 401 || res.status === 403) {
    clearToken();
    return showAuth("Sesi berakhir, silakan masuk kembali.");
  }

  const rows = await res.json();
  sheetBody.innerHTML = "";

  if (!res.ok) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
    td.textContent = rows.error || "Gagal memuat data";
    tr.appendChild(td);
    sheetBody.appendChild(tr);
    return;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 10;
    td.textContent = "Belum ada lead. Tambahkan sales dan tunggu chat masuk.";
    tr.appendChild(td);
    sheetBody.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.append(
      cell(r.staff_name),
      cell(r.lead_name),
      cell(r.wa_status),
      cell(r.previous_stage),
    );

    const stageTd = document.createElement("td");
    stageTd.appendChild(stageBadge(r.funnel_stage));
    tr.appendChild(stageTd);

    tr.append(
      cell(r.score),
      cell(r.analysis_notes),
      cell(r.evaluation),
      cell(r.analyzed_at ? new Date(r.analyzed_at).toLocaleString("id-ID") : "-"),
    );

    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Analisis";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const res = await apiFetch(`/api/leads/${r.lead_id}/analyze`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) alert(data.error || "Gagal analisis");
      } finally {
        await loadDashboard();
      }
    });
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    sheetBody.appendChild(tr);
  }
}

// ---- Modal helpers ----
let pairPollTimer = null;

function stopPairPolling() {
  if (pairPollTimer) clearInterval(pairPollTimer);
  pairPollTimer = null;
}

function openModal() {
  modalOverlay.hidden = false;
}

function closeModal() {
  stopPairPolling();
  modalOverlay.hidden = true;
  modalContent.innerHTML = "";
}

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

// Field read-only dengan tombol Salin. navigator.clipboard hanya tersedia di
// konteks aman (https/localhost); di http://IP biasa ia tidak ada, jadi
// sediakan fallback execCommand("copy") lewat select().
function copyableField(labelText, value) {
  const wrap = document.createElement("div");
  wrap.className = "copy-field";
  const label = document.createElement("label");
  label.textContent = labelText;
  const row = document.createElement("div");
  row.className = "copy-row";
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = value;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Salin";
  btn.addEventListener("click", async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        input.select();
        document.execCommand("copy");
      }
      btn.textContent = "Tersalin ✓";
    } catch {
      input.select();
      document.execCommand("copy");
      btn.textContent = "Tersalin ✓";
    }
    setTimeout(() => (btn.textContent = "Salin"), 1500);
  });
  row.append(input, btn);
  wrap.append(label, row);
  return wrap;
}

function renderPairing(result, staffId) {
  const area = document.getElementById("pairArea");
  if (!area) return;
  area.innerHTML = "";

  if (result.error) {
    area.innerHTML = `<p class="error">${result.error}</p>`;
    return;
  }
  if (result.connected) {
    area.innerHTML = '<p class="success">Nomor sudah terhubung ✓</p>';
    loadDashboard();
    return;
  }

  if (result.method === "code") {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Di WhatsApp HP sales: Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon, lalu masukkan kode ini:";
    area.appendChild(hint);
    if (result.pairing_code) {
      area.appendChild(copyableField("Kode pairing", result.pairing_code));
    } else {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Menyiapkan kode…";
      area.appendChild(p);
    }
  } else {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      "Di WhatsApp HP sales: Perangkat tertaut → Tautkan perangkat, lalu scan QR ini:";
    if (result.qr) {
      const img = document.createElement("img");
      img.className = "qr-img";
      img.src = result.qr;
      img.alt = "QR pairing WhatsApp";
      area.append(img, hint);
    } else {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = "Menyiapkan QR…";
      area.appendChild(p);
    }
  }

  startPairPolling(staffId);
}

function startPairPolling(staffId) {
  stopPairPolling();
  pairPollTimer = setInterval(async () => {
    const res = await apiFetch(`/api/staff/${staffId}/pair-status`);
    if (!res.ok) return;
    const st = await res.json();
    const area = document.getElementById("pairArea");
    if (!area) {
      stopPairPolling();
      return;
    }
    if (st.status === "connected") {
      stopPairPolling();
      area.innerHTML = '<p class="success">Berhasil terhubung ✓</p>';
      loadDashboard();
      setTimeout(closeModal, 1500);
      return;
    }
    // QR di-refresh berkala oleh WhatsApp; perbarui gambar kalau berubah.
    if (st.qr) {
      const img = area.querySelector("img.qr-img");
      if (img && img.src !== st.qr) img.src = st.qr;
    }
  }, 3000);
}

function openAddSalesModal() {
  stopPairPolling();
  modalContent.innerHTML = "";

  const h = document.createElement("h2");
  h.textContent = "Tambah Sales / Staff";

  const form = document.createElement("form");
  form.className = "modal-form";
  form.innerHTML = `
    <input id="salesName" type="text" placeholder="Nama sales/staff" required />
    <input id="salesNumber" type="text" placeholder="Nomor WA (62xxxxxxxxxx, tanpa +)" required />
    <div class="method-row">
      <label><input type="radio" name="pairMethod" value="qr" checked /> QR Code</label>
      <label><input type="radio" name="pairMethod" value="code" /> Kode pairing</label>
    </div>
    <button type="submit">Mulai Pairing</button>
  `;

  const err = document.createElement("p");
  err.className = "error";
  const area = document.createElement("div");
  area.id = "pairArea";
  area.className = "pair-area";

  modalContent.append(h, form, err, area);
  openModal();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    err.textContent = "";
    const name = document.getElementById("salesName").value.trim();
    const wa_number = document.getElementById("salesNumber").value.trim();
    const method = form.querySelector("input[name=pairMethod]:checked").value;
    area.innerHTML = '<p class="hint">Memproses…</p>';

    const res = await apiFetch("/api/staff", {
      method: "POST",
      body: JSON.stringify({ name, wa_number, method }),
    });
    const data = await res.json();

    if (res.status === 409 && data.staff_id) {
      area.innerHTML = "";
      const msg = document.createElement("p");
      msg.className = "hint";
      msg.textContent = `${data.error} Hubungkan ulang nomor ini?`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Hubungkan ulang";
      btn.addEventListener("click", async () => {
        area.innerHTML = '<p class="hint">Memproses…</p>';
        const r2 = await apiFetch(`/api/staff/${data.staff_id}/pair`, {
          method: "POST",
          body: JSON.stringify({ method }),
        });
        const d2 = await r2.json();
        if (!r2.ok) {
          area.innerHTML = `<p class="error">${d2.error || "Gagal"}</p>`;
          return;
        }
        renderPairing(d2, data.staff_id);
      });
      area.append(msg, btn);
      return;
    }

    if (!res.ok) {
      area.innerHTML = "";
      err.textContent = data.error || "Gagal menambah sales";
      return;
    }

    renderPairing(data, data.id);
  });
}

document.getElementById("refresh").addEventListener("click", loadDashboard);
document.getElementById("addStaff").addEventListener("click", openAddSalesModal);

openSettingsBtn.addEventListener("click", async () => {
  showView("settings");
  await loadClients();
});
document.getElementById("closeSettings").addEventListener("click", () => showApp());

function clientCell(text) {
  const td = document.createElement("td");
  td.textContent = text ?? "-";
  return td;
}

async function loadClients() {
  const res = await apiFetch("/api/admin/clients");
  const rows = await res.json();
  clientTableBody.innerHTML = "";

  if (!res.ok) {
    clientError.textContent = rows.error || "Gagal memuat client";
    return;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "Belum ada client.";
    tr.appendChild(td);
    clientTableBody.appendChild(tr);
    return;
  }

  for (const c of rows) {
    const tr = document.createElement("tr");
    tr.append(
      clientCell(c.name),
      clientCell(c.business_name),
      clientCell(c.plan),
      clientCell(new Date(c.created_at).toLocaleDateString("id-ID")),
    );
    const actionTd = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Hapus";
    btn.addEventListener("click", async () => {
      if (!confirm(`Hapus client "${c.name}"?`)) return;
      const delRes = await apiFetch(`/api/admin/clients/${c.id}`, {
        method: "DELETE",
      });
      const delData = await delRes.json();
      if (!delRes.ok) return alert(delData.error || "Gagal menghapus client");
      loadClients();
    });
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);
    clientTableBody.appendChild(tr);
  }
}

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  passwordError.textContent = "";
  passwordSuccess.hidden = true;
  const current_password = document.getElementById("currentPassword").value;
  const new_password = document.getElementById("newPassword").value;

  try {
    const res = await apiFetch("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal mengganti password");
    passwordForm.reset();
    passwordSuccess.hidden = false;
  } catch (err) {
    passwordError.textContent = err.message;
  }
});

function showClientCreated(data) {
  stopPairPolling();
  modalContent.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = `Client "${data.name}" terdaftar`;
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent =
    "Salin & sampaikan kredensial ini ke client. Password hanya ditampilkan sekali — setelah modal ditutup tidak bisa dilihat lagi.";
  modalContent.append(
    h,
    p,
    copyableField("Email", data.email),
    copyableField("Password sementara", data.temp_password),
  );
  openModal();
}

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clientError.textContent = "";
  const name = document.getElementById("clientName").value.trim();
  const email = document.getElementById("clientEmail").value.trim();
  const business_name = document.getElementById("clientBusiness").value.trim();
  const plan = document.getElementById("clientPlan").value.trim();

  try {
    const res = await apiFetch("/api/admin/clients", {
      method: "POST",
      body: JSON.stringify({ name, email, business_name, plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal mendaftarkan client");
    showClientCreated(data);
    clientForm.reset();
    loadClients();
  } catch (err) {
    clientError.textContent = err.message;
  }
});

// Pulihkan sesi saat halaman dibuka/di-reload: kalau ada token, kembalikan ke
// halaman terakhir (dashboard atau pengaturan). loadMe() lewat apiFetch akan
// otomatis refresh token kalau sudah kedaluwarsa; kalau token benar-benar mati
// (refresh gagal), lempar ke layar login.
async function restoreSession() {
  if (!getToken()) {
    showAuth();
    return;
  }
  const res = await apiFetch("/api/me");
  if (!res.ok) {
    clearToken();
    showAuth("Sesi berakhir, silakan masuk kembali.");
    return;
  }
  const me = await res.json();
  clientPanel.hidden = !me.is_master;

  if (localStorage.getItem("faiaudit_view") === "settings") {
    showView("settings");
    await loadClients();
  } else {
    showView("app");
    await loadDashboard();
  }
}

restoreSession();
