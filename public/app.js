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

function getToken() {
  return localStorage.getItem("faiaudit_token") || "";
}

function setToken(token) {
  localStorage.setItem("faiaudit_token", token);
}

function clearToken() {
  localStorage.removeItem("faiaudit_token");
}

function authHeaders() {
  return { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` };
}

function showView(view) {
  authView.hidden = view !== "auth";
  appView.hidden = view !== "app";
  settingsView.hidden = view !== "settings";
}

async function showApp() {
  showView("app");
  await loadMe();
  await loadDashboard();
}

function showAuth(message) {
  showView("auth");
  authError.textContent = message || "";
}

async function loadMe() {
  const res = await fetch("/api/me", { headers: authHeaders() });
  if (!res.ok) return;
  const me = await res.json();
  openSettingsBtn.hidden = !me.is_master;
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
    setToken(data.access_token);
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
  const res = await fetch("/api/dashboard", { headers: authHeaders() });
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
        const res = await fetch(`/api/leads/${r.lead_id}/analyze`, {
          method: "POST",
          headers: authHeaders(),
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

async function addStaff() {
  const name = prompt("Nama sales/staff?");
  if (!name) return;
  const wa_number = prompt("Nomor WhatsApp (format 62xxxxxxxxxx, tanpa +)?");
  if (!wa_number) return;

  const res = await fetch("/api/staff", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name, wa_number }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Gagal menambah sales");
  alert(`Sales ditambahkan. Pairing code WhatsApp: ${data.pairing_code || "(cek log server)"}`);
  loadDashboard();
}

document.getElementById("refresh").addEventListener("click", loadDashboard);
document.getElementById("addStaff").addEventListener("click", addStaff);

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
  const res = await fetch("/api/admin/clients", { headers: authHeaders() });
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
      const delRes = await fetch(`/api/admin/clients/${c.id}`, {
        method: "DELETE",
        headers: authHeaders(),
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

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clientError.textContent = "";
  const name = document.getElementById("clientName").value.trim();
  const email = document.getElementById("clientEmail").value.trim();
  const business_name = document.getElementById("clientBusiness").value.trim();
  const plan = document.getElementById("clientPlan").value.trim();

  try {
    const res = await fetch("/api/admin/clients", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name, email, business_name, plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal mendaftarkan client");
    alert(`Client "${data.name}" terdaftar.\nEmail: ${data.email}\nPassword sementara: ${data.temp_password}\n\nSampaikan password ini ke client lalu sarankan mereka segera login.`);
    clientForm.reset();
    loadClients();
  } catch (err) {
    clientError.textContent = err.message;
  }
});

if (getToken()) {
  showApp();
} else {
  showAuth();
}
