const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const sheetBody = document.getElementById("sheetBody");

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

function showApp() {
  authView.hidden = true;
  appView.hidden = false;
  loadDashboard();
}

function showAuth(message) {
  authView.hidden = false;
  appView.hidden = true;
  authError.textContent = message || "";
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mode = event.submitter?.dataset.mode || "login";
  const email = document.getElementById("authEmail").value.trim();
  const password = document.getElementById("authPassword").value;
  const name = document.getElementById("authName").value.trim();

  authError.textContent = "";
  const body = mode === "register" ? { email, password, name } : { email, password };

  try {
    const res = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal autentikasi");
    setToken(data.access_token);
    showApp();
  } catch (err) {
    authError.textContent = err.message;
  }
});

document.getElementById("logout").addEventListener("click", () => {
  clearToken();
  showAuth();
});

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

if (getToken()) {
  showApp();
} else {
  showAuth();
}
