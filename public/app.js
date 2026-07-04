const authView = document.getElementById("authView");
const appView = document.getElementById("appView");
const salesView = document.getElementById("salesView");
const settingsView = document.getElementById("settingsView");
const kanbanView = document.getElementById("kanbanView");
const analyticsView = document.getElementById("analyticsView");
const staffTableBody = document.getElementById("staffTableBody");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const sheetBody = document.getElementById("sheetBody");
const riskBanner = document.getElementById("riskBanner");
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
const leadModalOverlay = document.getElementById("leadModalOverlay");
const leadModalContent = document.getElementById("leadModalContent");
const leadModalClose = document.getElementById("leadModalClose");
const kanbanBoard = document.getElementById("kanbanBoard");
const analyticsGrid = document.getElementById("analyticsGrid");
const filterSearch = document.getElementById("filterSearch");
const filterStage = document.getElementById("filterStage");
const filterRisk = document.getElementById("filterRisk");
const exportCsvBtn = document.getElementById("exportCsv");
const downloadDailyPdfBtn = document.getElementById("downloadDailyPdf");
const notifyForm = document.getElementById("notifyForm");
const notifyNumberInput = document.getElementById("notifyNumber");
const notifyError = document.getElementById("notifyError");
const notifySuccess = document.getElementById("notifySuccess");

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
  document.getElementById("shell").hidden = view === "auth";
  appView.hidden = view !== "app";
  salesView.hidden = view !== "sales";
  settingsView.hidden = view !== "settings";
  kanbanView.hidden = view !== "kanban";
  analyticsView.hidden = view !== "analytics";
  // Ingat halaman terakhir supaya reload (Ctrl+R) / restart server tidak
  // melempar user kembali ke dashboard. Layar auth tidak disimpan.
  if (view === "app" || view === "sales" || view === "settings" || view === "kanban" || view === "analytics") {
    localStorage.setItem("faiaudit_view", view);
  }
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => goToView(btn.dataset.view));
});

async function goToView(view) {
  if (view === "app") return showApp();
  if (view === "sales") return showSales();
  if (view === "settings") return showSettings();
  if (view === "kanban") return showKanban();
  if (view === "analytics") return showAnalytics();
}

async function showApp() {
  showView("app");
  await loadMe();
  await loadDashboard();
  maybeShowIntro();
}

async function showSales() {
  showView("sales");
  await loadStaff();
}

async function showSettings() {
  showView("settings");
  await loadClients();
  await loadNotifyNumber();
}

async function showKanban() {
  showView("kanban");
  await loadKanban();
}

async function showAnalytics() {
  showView("analytics");
  await loadAnalytics();
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

const legendToggle = document.getElementById("legendToggle");
const legendList = document.getElementById("legendList");
legendToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  legendList.hidden = !legendList.hidden;
  legendToggle.setAttribute("aria-expanded", String(!legendList.hidden));
});
document.addEventListener("click", (e) => {
  if (legendList.hidden) return;
  if (legendList.contains(e.target)) return;
  legendList.hidden = true;
  legendToggle.setAttribute("aria-expanded", "false");
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
document.getElementById("logoutKanban").addEventListener("click", logout);
document.getElementById("logoutAnalytics").addEventListener("click", logout);

function stageBadge(stage) {
  const span = document.createElement("span");
  span.className = `stage stage-${stage}`;
  span.textContent = stage;
  return span;
}

const FUNNEL_STAGES = ["new", "contacted", "interested", "negotiation", "closed_won", "closed_lost"];
const STAGE_LABEL = {
  new: "Baru",
  contacted: "Kontak",
  interested: "Tertarik",
  negotiation: "Negosiasi",
  closed_won: "Closing",
  closed_lost: "Hilang",
};

const RISK_LABEL = { rendah: "Rendah", sedang: "Sedang", tinggi: "Tinggi", selesai: "Selesai" };

// Isi <option> stage sekali saja dari FUNNEL_STAGES (single source of truth)
// supaya filter dashboard tidak perlu di-hardcode terpisah di HTML.
FUNNEL_STAGES.forEach((s) => {
  const opt = document.createElement("option");
  opt.value = s;
  opt.textContent = STAGE_LABEL[s] || s;
  filterStage.appendChild(opt);
});

function riskBadge(risk) {
  const span = document.createElement("span");
  const level = risk?.level || "rendah";
  span.className = `risk risk-${level}`;
  span.textContent = RISK_LABEL[level] || level;
  if (risk?.reason) span.title = risk.reason;
  return span;
}

// Render pesan error secara AMAN ke sebuah container: kosongkan lalu pasang
// <p class="error"> dengan textContent, tidak pernah innerHTML — supaya teks
// error dari server (yang bisa saja memuat nilai input) tidak pernah ditafsir
// sebagai HTML/JS oleh browser.
function showErrorIn(el, message) {
  if (!el) return;
  el.innerHTML = "";
  const p = document.createElement("p");
  p.className = "error";
  p.textContent = message || "Terjadi kesalahan";
  el.appendChild(p);
}

// data-label dipakai CSS (td::before) untuk tampilan "card" di mobile —
// setiap sel data perlu tahu nama kolomnya sendiri karena <thead> disembunyikan
// secara visual pada breakpoint sempit.
function cell(text, label) {
  const td = document.createElement("td");
  td.textContent = text ?? "-";
  if (label) td.dataset.label = label;
  return td;
}

// Reminder leads berisiko tinggi (heuristik: stage lanjut + lama tanpa
// balasan) supaya tidak terkubur di tabel besar — pakai data risk yang
// sudah dihitung backend, tidak ada query/AI call tambahan.
function renderRiskBanner(rows) {
  const highRisk = rows.filter((r) => r.risk?.level === "tinggi");
  if (!highRisk.length) {
    riskBanner.hidden = true;
    riskBanner.innerHTML = "";
    return;
  }

  riskBanner.hidden = false;
  riskBanner.innerHTML = "";
  const title = document.createElement("strong");
  title.textContent = `⚠️ ${highRisk.length} lead berisiko tinggi butuh tindak lanjut segera`;
  riskBanner.appendChild(title);

  const list = document.createElement("ul");
  for (const r of highRisk.slice(0, 5)) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = "#";
    link.textContent = `${r.lead_name || "-"} (${r.staff_name || "-"})`;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      openLeadDetail(r.lead_id);
    });
    li.appendChild(link);
    li.append(` — ${r.risk.reason}`);
    list.appendChild(li);
  }
  riskBanner.appendChild(list);
}

// Cache hasil fetch terakhir supaya filter/export tidak perlu fetch ulang —
// hanya re-render dari data yang sudah ada di memori.
let dashboardRows = [];

function matchesFilters(r) {
  const search = filterSearch.value.trim().toLowerCase();
  if (search && !(r.lead_name || "").toLowerCase().includes(search)) return false;
  if (filterStage.value && r.funnel_stage !== filterStage.value) return false;
  if (filterRisk.value && (r.risk?.level || "") !== filterRisk.value) return false;
  return true;
}

function renderDashboardRows(rows) {
  sheetBody.innerHTML = "";

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = dashboardRows.length
      ? "Tidak ada lead yang cocok dengan filter."
      : "Belum ada lead. Tambahkan sales dan tunggu chat masuk.";
    tr.appendChild(td);
    sheetBody.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.append(cell(r.staff_name, "Sales"));

    const leadTd = document.createElement("td");
    leadTd.dataset.label = "Lead";
    const leadLink = document.createElement("a");
    leadLink.href = "#";
    leadLink.className = "lead-link";
    leadLink.textContent = r.lead_name || "-";
    leadLink.addEventListener("click", (e) => {
      e.preventDefault();
      openLeadDetail(r.lead_id);
    });
    leadTd.appendChild(leadLink);
    tr.appendChild(leadTd);

    tr.append(cell(r.wa_status, "Status WA"), cell(r.previous_stage, "Stage Sebelumnya"));

    const stageTd = document.createElement("td");
    stageTd.dataset.label = "Funnel Stage";
    stageTd.appendChild(stageBadge(r.funnel_stage));
    tr.appendChild(stageTd);

    tr.append(cell(r.score, "Skor"));

    const riskTd = document.createElement("td");
    riskTd.dataset.label = "Risiko";
    riskTd.appendChild(riskBadge(r.risk));
    tr.appendChild(riskTd);

    tr.append(
      cell(r.analysis_notes, "Catatan Analisis"),
      cell(r.evaluation, "Evaluasi"),
      cell(r.analyzed_at ? new Date(r.analyzed_at).toLocaleString("id-ID") : "-", "Dianalisis"),
    );

    const actionTd = document.createElement("td");
    actionTd.dataset.label = "Aksi";
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
        if (!res.ok) {
          alert(data.error || "Gagal analisis");
          return;
        }
        // analyzeLead() sengaja skip panggilan AI kalau tidak ada chat baru
        // sejak analisis terakhir (hemat biaya token) — tanpa pesan ini,
        // klik tombol kelihatan "tidak terjadi apa-apa" padahal itu memang
        // perilaku yang diharapkan, bukan bug.
        if (data.skipped) {
          alert("Belum ada chat baru sejak analisis terakhir, jadi AI tidak dijalankan ulang (hemat biaya). Data di tabel sudah hasil analisis terakhir.");
        }
      } finally {
        await loadDashboard();
      }
    });
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    sheetBody.appendChild(tr);
  }
}

function applyDashboardFilters() {
  renderDashboardRows(dashboardRows.filter(matchesFilters));
}

filterSearch.addEventListener("input", applyDashboardFilters);
filterStage.addEventListener("change", applyDashboardFilters);
filterRisk.addEventListener("change", applyDashboardFilters);

// Endpoint PDF butuh header Authorization (Bearer token) sehingga tidak
// bisa dipakai langsung lewat <a href>; fetch sebagai blob dulu lalu trigger
// download lewat <a> sementara, sama seperti pola export CSV.
async function downloadAuthedFile(url, triggerBtn) {
  const original = triggerBtn?.textContent;
  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = "Membuat PDF…";
  }
  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Gagal membuat PDF");
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const filename = match ? match[1] : "FaiAudit.pdf";
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = original;
    }
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Export hanya baris yang sedang terlihat (sudah terfilter) — supaya export
// konsisten dengan apa yang dilihat user di tabel, tanpa endpoint baru.
exportCsvBtn.addEventListener("click", () => {
  const rows = dashboardRows.filter(matchesFilters);
  const headers = ["Sales", "Lead", "Status WA", "Stage Sebelumnya", "Funnel Stage", "Skor", "Risiko", "Catatan Analisis", "Evaluasi", "Dianalisis"];
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.staff_name,
        r.lead_name,
        r.wa_status,
        r.previous_stage,
        r.funnel_stage,
        r.score,
        r.risk?.level,
        r.analysis_notes,
        r.evaluation,
        r.analyzed_at ? new Date(r.analyzed_at).toLocaleString("id-ID") : "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `faiaudit-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

downloadDailyPdfBtn.addEventListener("click", () => downloadAuthedFile("/api/reports/daily/pdf", downloadDailyPdfBtn));

async function loadDashboard() {
  const res = await apiFetch("/api/dashboard");
  if (res.status === 401 || res.status === 403) {
    clearToken();
    return showAuth("Sesi berakhir, silakan masuk kembali.");
  }

  const rows = await res.json();

  if (!res.ok) {
    riskBanner.hidden = true;
    sheetBody.innerHTML = "";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 11;
    td.textContent = rows.error || "Gagal memuat data";
    tr.appendChild(td);
    sheetBody.appendChild(tr);
    return;
  }

  dashboardRows = rows;
  renderRiskBanner(rows);
  applyDashboardFilters();
}

// ---- Kanban ----
async function loadKanban() {
  kanbanBoard.innerHTML = '<p class="hint">Memuat…</p>';
  const res = await apiFetch("/api/dashboard");
  if (res.status === 401 || res.status === 403) {
    clearToken();
    return showAuth("Sesi berakhir, silakan masuk kembali.");
  }
  const rows = await res.json();
  if (!res.ok) {
    showErrorIn(kanbanBoard, rows.error || "Gagal memuat data");
    return;
  }
  renderKanban(rows);
}

function renderKanban(rows) {
  kanbanBoard.innerHTML = "";
  for (const stage of FUNNEL_STAGES) {
    const col = document.createElement("div");
    col.className = "kanban-column";
    col.dataset.stage = stage;

    const header = document.createElement("div");
    header.className = "kanban-column-header";
    const leadsInStage = rows.filter((r) => r.funnel_stage === stage);
    header.textContent = `${STAGE_LABEL[stage] || stage} (${leadsInStage.length})`;
    col.appendChild(header);

    const cardList = document.createElement("div");
    cardList.className = "kanban-card-list";

    for (const r of leadsInStage) {
      const card = document.createElement("div");
      card.className = "kanban-card";
      card.draggable = true;
      card.dataset.leadId = r.lead_id;

      const nameEl = document.createElement("a");
      nameEl.href = "#";
      nameEl.className = "kanban-card-name";
      nameEl.textContent = r.lead_name || "-";
      nameEl.addEventListener("click", (e) => {
        e.preventDefault();
        openLeadDetail(r.lead_id);
      });
      card.appendChild(nameEl);

      const meta = document.createElement("div");
      meta.className = "kanban-card-meta";
      meta.textContent = r.staff_name || "-";
      card.appendChild(meta);
      card.appendChild(riskBadge(r.risk));

      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(r.lead_id));
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));

      cardList.appendChild(card);
    }

    col.appendChild(cardList);

    col.addEventListener("dragover", (e) => e.preventDefault());
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      const leadId = e.dataTransfer.getData("text/plain");
      if (!leadId) return;
      const res = await apiFetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ funnel_stage: stage }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Gagal mengubah stage");
        return;
      }
      await loadKanban();
    });

    kanbanBoard.appendChild(col);
  }
}

// ---- Analitik ----
// `barRows` (opsional): [{ label, count }] data nyata per kategori, dipakai
// untuk gambar diagram batang horizontal di bawah daftar angka — supaya
// distribusi mudah dibaca sekilas, bukan cuma deretan angka/persen.
function analyticsCard(title, rowsOfPairs, barRows) {
  const card = document.createElement("div");
  card.className = "analytics-card";
  const h = document.createElement("h3");
  h.textContent = title;
  card.appendChild(h);

  if (barRows?.length) {
    const max = Math.max(1, ...barRows.map((r) => r.count));
    const chart = document.createElement("div");
    chart.className = "analytics-chart";
    for (const row of barRows) {
      const barRow = document.createElement("div");
      barRow.className = "analytics-bar-row";
      const label = document.createElement("span");
      label.className = "analytics-bar-label";
      label.textContent = row.label;
      const track = document.createElement("div");
      track.className = "analytics-bar-track";
      const fill = document.createElement("div");
      fill.className = "analytics-bar-fill";
      fill.style.width = `${Math.max(2, Math.round((row.count / max) * 100))}%`;
      track.appendChild(fill);
      const count = document.createElement("span");
      count.className = "analytics-bar-count";
      count.textContent = String(row.count);
      barRow.append(label, track, count);
      chart.appendChild(barRow);
    }
    card.appendChild(chart);
  }

  const list = document.createElement("ul");
  list.className = "analytics-list";
  for (const [label, value] of rowsOfPairs) {
    const li = document.createElement("li");
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    const valueSpan = document.createElement("span");
    valueSpan.className = "analytics-value";
    valueSpan.textContent = value;
    li.append(labelSpan, valueSpan);
    list.appendChild(li);
  }
  card.appendChild(list);
  return card;
}

async function loadAnalytics() {
  analyticsGrid.innerHTML = '<p class="hint">Memuat…</p>';
  const res = await apiFetch("/api/dashboard");
  if (res.status === 401 || res.status === 403) {
    clearToken();
    return showAuth("Sesi berakhir, silakan masuk kembali.");
  }
  const rows = await res.json();
  if (!res.ok) {
    showErrorIn(analyticsGrid, rows.error || "Gagal memuat data");
    return;
  }
  renderAnalytics(rows);
}

function renderAnalytics(rows) {
  analyticsGrid.innerHTML = "";

  const total = rows.length || 1;

  const stageCounts = FUNNEL_STAGES.map((s) => ({
    label: STAGE_LABEL[s] || s,
    count: rows.filter((r) => r.funnel_stage === s).length,
  }));
  const stagePairs = stageCounts.map(({ label, count }) => [label, `${count} (${Math.round((count / total) * 100)}%)`]);
  analyticsGrid.appendChild(analyticsCard("Distribusi Funnel Stage", stagePairs, stageCounts));

  const riskLevels = ["tinggi", "sedang", "rendah", "selesai"];
  const riskCounts = riskLevels.map((level) => ({
    label: RISK_LABEL[level],
    count: rows.filter((r) => (r.risk?.level || "") === level).length,
  }));
  const riskPairs = riskCounts.map(({ label, count }) => [label, `${count} (${Math.round((count / total) * 100)}%)`]);
  analyticsGrid.appendChild(analyticsCard("Distribusi Risiko", riskPairs, riskCounts));

  // Leaderboard sales: rata-rata skor + total lead + closing, dihitung dari
  // data dashboard yang sudah ada — tanpa query/endpoint baru.
  const bySales = new Map();
  for (const r of rows) {
    const name = r.staff_name || "-";
    const entry = bySales.get(name) || { total: 0, scoreSum: 0, scoreCount: 0, closedWon: 0 };
    entry.total += 1;
    if (typeof r.score === "number") {
      entry.scoreSum += r.score;
      entry.scoreCount += 1;
    }
    if (r.funnel_stage === "closed_won") entry.closedWon += 1;
    bySales.set(name, entry);
  }
  const leaderboard = [...bySales.entries()]
    .map(([name, e]) => ({
      name,
      total: e.total,
      avgScore: e.scoreCount ? Math.round(e.scoreSum / e.scoreCount) : null,
      closedWon: e.closedWon,
    }))
    .sort((a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1));

  const leaderboardCard = document.createElement("div");
  leaderboardCard.className = "analytics-card analytics-card-wide";
  const h = document.createElement("h3");
  h.textContent = "Leaderboard Sales";
  leaderboardCard.appendChild(h);

  if (!leaderboard.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Belum ada data lead.";
    leaderboardCard.appendChild(p);
  } else {
    const table = document.createElement("table");
    table.className = "leaderboard-table";
    table.innerHTML = "<thead><tr><th>Sales</th><th>Total Lead</th><th>Skor Rata-rata</th><th>Closing</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for (const entry of leaderboard) {
      const tr = document.createElement("tr");
      tr.append(
        cell(entry.name, "Sales"),
        cell(entry.total, "Total Lead"),
        cell(entry.avgScore ?? "-", "Skor Rata-rata"),
        cell(entry.closedWon, "Closing"),
      );
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    leaderboardCard.appendChild(table);
  }
  analyticsGrid.appendChild(leaderboardCard);
}

// ---- Reminder WA pribadi (settings) ----
async function loadNotifyNumber() {
  const res = await apiFetch("/api/me");
  if (!res.ok) return;
  const me = await res.json();
  notifyNumberInput.value = me.notify_wa_number || "";
}

notifyForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  notifyError.textContent = "";
  notifySuccess.hidden = true;
  const value = notifyNumberInput.value.trim();

  try {
    const res = await apiFetch("/api/me/notify-number", {
      method: "PATCH",
      body: JSON.stringify({ notify_wa_number: value || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Gagal menyimpan nomor");
    notifySuccess.hidden = false;
  } catch (err) {
    notifyError.textContent = err.message;
  }
});

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
    showErrorIn(area, result.error);
    return;
  }
  if (result.connected) {
    area.innerHTML = '<p class="success">Nomor sudah terhubung ✓</p>';
    loadDashboard();
    if (!salesView.hidden) loadStaff();
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
      if (!salesView.hidden) loadStaff();
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
          showErrorIn(area, d2.error || "Gagal");
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
document.getElementById("addStaffSalesPage").addEventListener("click", openAddSalesModal);
document.getElementById("logoutSales").addEventListener("click", logout);

function staffCell(text, label) {
  const td = document.createElement("td");
  td.textContent = text ?? "-";
  if (label) td.dataset.label = label;
  return td;
}

async function loadStaff() {
  const res = await apiFetch("/api/staff");
  const rows = await res.json();
  staffTableBody.innerHTML = "";

  if (!res.ok) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = rows.error || "Gagal memuat data sales";
    tr.appendChild(td);
    staffTableBody.appendChild(tr);
    return;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "Belum ada sales. Klik \"+ Tambah Sales\" untuk menghubungkan nomor WA.";
    tr.appendChild(td);
    staffTableBody.appendChild(tr);
    return;
  }

  for (const s of rows) {
    const tr = document.createElement("tr");
    tr.append(
      staffCell(s.name, "Nama"),
      staffCell(s.wa_number, "Nomor WA"),
      staffCell(s.wa_session_status, "Status"),
      staffCell(new Date(s.created_at).toLocaleString("id-ID"), "Terhubung Sejak"),
    );

    const actionTd = document.createElement("td");
    actionTd.dataset.label = "Aksi";

    if (s.wa_session_status !== "connected") {
      const reconnectBtn = document.createElement("button");
      reconnectBtn.textContent = "Hubungkan ulang";
      reconnectBtn.addEventListener("click", async () => {
        reconnectBtn.disabled = true;
        const res = await apiFetch(`/api/staff/${s.id}/pair`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || "Gagal memulai pairing");
          reconnectBtn.disabled = false;
          return;
        }
        openModal();
        modalContent.innerHTML = '<h2>Hubungkan ulang sales</h2><div id="pairArea" class="pair-area"></div>';
        renderPairing(data, s.id);
      });
      actionTd.appendChild(reconnectBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = "Hapus";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`Hapus sales "${s.name}"? Sesi WA akan diputus.`)) return;
      const res = await apiFetch(`/api/staff/${s.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Gagal menghapus sales");
      loadStaff();
    });
    actionTd.appendChild(delBtn);

    tr.appendChild(actionTd);
    staffTableBody.appendChild(tr);
  }
}

function clientCell(text, label) {
  const td = document.createElement("td");
  td.textContent = text ?? "-";
  if (label) td.dataset.label = label;
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
    td.colSpan = 6;
    td.textContent = "Belum ada client.";
    tr.appendChild(td);
    clientTableBody.appendChild(tr);
    return;
  }

  for (const c of rows) {
    const tr = document.createElement("tr");
    tr.append(clientCell(c.name, "Nama"), clientCell(c.business_name, "Usaha"), clientCell(c.plan, "Plan"));

    const providerTd = document.createElement("td");
    providerTd.dataset.label = "Provider AI";
    const select = document.createElement("select");
    select.className = "ai-provider-select";
    select.append(
      new Option("AI Biasa (Cepat)", "scraper", false, c.ai_provider === "scraper"),
      new Option("OpenRouter", "qwen", false, c.ai_provider === "qwen"),
    );
    select.addEventListener("change", async () => {
      const previous = c.ai_provider;
      select.disabled = true;
      const res = await apiFetch(`/api/admin/clients/${c.id}/ai-provider`, {
        method: "PATCH",
        body: JSON.stringify({ ai_provider: select.value }),
      });
      const data = await res.json();
      select.disabled = false;
      if (!res.ok) {
        alert(data.error || "Gagal mengubah provider AI");
        select.value = previous;
        return;
      }
      c.ai_provider = data.ai_provider;
    });
    providerTd.appendChild(select);
    tr.appendChild(providerTd);

    tr.appendChild(clientCell(new Date(c.created_at).toLocaleDateString("id-ID"), "Terdaftar"));

    const actionTd = document.createElement("td");
    actionTd.dataset.label = "Aksi";
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

// ---- Halaman Detail Lead ----
function closeLeadModal() {
  leadModalOverlay.hidden = true;
  leadModalContent.innerHTML = "";
}

leadModalClose.addEventListener("click", closeLeadModal);
leadModalOverlay.addEventListener("click", (e) => {
  if (e.target === leadModalOverlay) closeLeadModal();
});

function chip(text) {
  const span = document.createElement("span");
  span.className = "chip";
  span.textContent = text;
  return span;
}

function tagChip(text, onRemove) {
  const span = document.createElement("span");
  span.className = "chip chip-tag";
  const label = document.createElement("span");
  label.textContent = text;
  const x = document.createElement("button");
  x.type = "button";
  x.className = "chip-remove";
  x.textContent = "×";
  x.addEventListener("click", onRemove);
  span.append(label, x);
  return span;
}

async function openLeadDetail(leadId) {
  leadModalContent.innerHTML = '<p class="hint">Memuat detail lead…</p>';
  leadModalOverlay.hidden = false;

  const res = await apiFetch(`/api/leads/${leadId}`);
  const data = await res.json();
  if (!res.ok) {
    showErrorIn(leadModalContent, data.error || "Gagal memuat lead");
    return;
  }
  renderLeadDetail(data);
}

function renderLeadDetail(lead) {
  leadModalContent.innerHTML = "";

  const h = document.createElement("h2");
  h.textContent = lead.lead_name;
  leadModalContent.appendChild(h);

  const sub = document.createElement("p");
  sub.className = "hint";
  sub.textContent = `Sales: ${lead.staff_name || "-"} · WA: ${lead.wa_jid || "-"} · Status: ${lead.wa_status || "-"}`;
  leadModalContent.appendChild(sub);

  const pdfBtn = document.createElement("button");
  pdfBtn.type = "button";
  pdfBtn.className = "pdf-download-btn";
  pdfBtn.textContent = "⬇ Download PDF Lead";
  pdfBtn.addEventListener("click", () => downloadAuthedFile(`/api/leads/${lead.lead_id}/pdf`, pdfBtn));
  leadModalContent.appendChild(pdfBtn);

  // --- AI Intelligence Card ---
  const aiCard = document.createElement("div");
  aiCard.className = "ai-card";

  const aiHeader = document.createElement("div");
  aiHeader.className = "ai-card-header";
  aiHeader.appendChild(riskBadge(lead.risk));
  aiHeader.appendChild(stageBadge(lead.funnel_stage));
  const scoreSpan = document.createElement("span");
  scoreSpan.className = "ai-score";
  scoreSpan.textContent = lead.score != null ? `Skor: ${lead.score}` : "Skor: -";
  aiHeader.appendChild(scoreSpan);
  aiCard.appendChild(aiHeader);

  if (lead.risk?.reason) {
    const riskReason = document.createElement("p");
    riskReason.className = "hint";
    riskReason.textContent = `Risiko (heuristik): ${lead.risk.reason}`;
    aiCard.appendChild(riskReason);
  }

  if (lead.analysis_notes) {
    const notesP = document.createElement("p");
    const notesLabel = document.createElement("strong");
    notesLabel.textContent = "Catatan analisis:";
    notesP.append(notesLabel, " " + lead.analysis_notes);
    aiCard.appendChild(notesP);
  }
  if (lead.evaluation) {
    const evalP = document.createElement("p");
    const evalLabel = document.createElement("strong");
    evalLabel.textContent = "Evaluasi:";
    evalP.append(evalLabel, " " + lead.evaluation);
    aiCard.appendChild(evalP);
  }

  if (lead.buying_signals?.length) {
    const wrap = document.createElement("div");
    wrap.className = "chip-row";
    const label = document.createElement("span");
    label.className = "chip-row-label";
    label.textContent = "Sinyal beli:";
    wrap.appendChild(label);
    lead.buying_signals.forEach((s) => wrap.appendChild(chip(s)));
    aiCard.appendChild(wrap);
  }
  if (lead.objections?.length) {
    const wrap = document.createElement("div");
    wrap.className = "chip-row";
    const label = document.createElement("span");
    label.className = "chip-row-label";
    label.textContent = "Keberatan:";
    wrap.appendChild(label);
    lead.objections.forEach((s) => wrap.appendChild(chip(s)));
    aiCard.appendChild(wrap);
  }

  leadModalContent.appendChild(aiCard);

  // --- Quick stage change ---
  const stageForm = document.createElement("form");
  stageForm.className = "inline-form";
  const stageSelect = document.createElement("select");
  FUNNEL_STAGES.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    if (s === lead.funnel_stage) opt.selected = true;
    stageSelect.appendChild(opt);
  });
  const stageBtn = document.createElement("button");
  stageBtn.type = "submit";
  stageBtn.textContent = "Ubah Stage";
  stageForm.append(stageSelect, stageBtn);
  stageForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    stageBtn.disabled = true;
    try {
      const res = await apiFetch(`/api/leads/${lead.lead_id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ funnel_stage: stageSelect.value }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Gagal mengubah stage");
      await openLeadDetail(lead.lead_id);
      await loadDashboard();
    } finally {
      stageBtn.disabled = false;
    }
  });
  leadModalContent.appendChild(stageForm);

  // --- Tags ---
  const tagSection = document.createElement("div");
  tagSection.className = "lead-section";
  const tagTitle = document.createElement("h3");
  tagTitle.textContent = "Tag";
  tagSection.appendChild(tagTitle);

  const tagRow = document.createElement("div");
  tagRow.className = "chip-row";
  let currentTags = [...(lead.tags || [])];

  function renderTags() {
    tagRow.innerHTML = "";
    currentTags.forEach((t, i) => {
      tagRow.appendChild(
        tagChip(t, async () => {
          currentTags = currentTags.filter((_, idx) => idx !== i);
          await saveTags();
        }),
      );
    });
  }

  async function saveTags() {
    const res = await apiFetch(`/api/leads/${lead.lead_id}`, {
      method: "PATCH",
      body: JSON.stringify({ tags: currentTags }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || "Gagal menyimpan tag");
    currentTags = data.tags || [];
    renderTags();
    loadDashboard();
  }

  renderTags();
  tagSection.appendChild(tagRow);

  const tagForm = document.createElement("form");
  tagForm.className = "inline-form";
  const tagInput = document.createElement("input");
  tagInput.type = "text";
  tagInput.placeholder = "Tambah tag, lalu Enter";
  const tagAddBtn = document.createElement("button");
  tagAddBtn.type = "submit";
  tagAddBtn.textContent = "Tambah";
  tagForm.append(tagInput, tagAddBtn);
  tagForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = tagInput.value.trim();
    if (!value) return;
    currentTags = [...currentTags, value];
    tagInput.value = "";
    await saveTags();
  });
  tagSection.appendChild(tagForm);
  leadModalContent.appendChild(tagSection);

  // --- Owner note ---
  const noteSection = document.createElement("div");
  noteSection.className = "lead-section";
  const noteTitle = document.createElement("h3");
  noteTitle.textContent = "Catatan Manual";
  noteSection.appendChild(noteTitle);

  const noteForm = document.createElement("form");
  noteForm.className = "note-form";
  const noteArea = document.createElement("textarea");
  noteArea.rows = 3;
  noteArea.placeholder = "Catatan pribadi Anda tentang lead ini (tidak ditimpa AI)";
  noteArea.value = lead.owner_note || "";
  const noteBtn = document.createElement("button");
  noteBtn.type = "submit";
  noteBtn.textContent = "Simpan Catatan";
  noteForm.append(noteArea, noteBtn);
  noteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    noteBtn.disabled = true;
    noteBtn.textContent = "Menyimpan…";
    try {
      const res = await apiFetch(`/api/leads/${lead.lead_id}`, {
        method: "PATCH",
        body: JSON.stringify({ owner_note: noteArea.value }),
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Gagal menyimpan catatan");
      noteBtn.textContent = "Tersimpan ✓";
    } finally {
      setTimeout(() => {
        noteBtn.disabled = false;
        noteBtn.textContent = "Simpan Catatan";
      }, 1200);
    }
  });
  noteSection.appendChild(noteForm);
  leadModalContent.appendChild(noteSection);

  // --- Timeline ---
  const timelineSection = document.createElement("div");
  timelineSection.className = "lead-section";
  const timelineTitle = document.createElement("h3");
  timelineTitle.textContent = "Riwayat Chat";
  timelineSection.appendChild(timelineTitle);

  const timeline = document.createElement("div");
  timeline.className = "timeline";
  if (!lead.messages?.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Belum ada chat tercatat.";
    timeline.appendChild(p);
  } else {
    for (const m of lead.messages) {
      const item = document.createElement("div");
      item.className = `timeline-item timeline-${m.direction}`;
      const meta = document.createElement("div");
      meta.className = "timeline-meta";
      meta.textContent = `${m.direction === "outbound" ? "Sales" : "Lead"} · ${new Date(m.sent_at).toLocaleString("id-ID")}`;
      const body = document.createElement("div");
      body.className = "timeline-body";
      body.textContent = m.body || "";
      item.append(meta, body);
      timeline.appendChild(item);
    }
  }
  timelineSection.appendChild(timeline);
  leadModalContent.appendChild(timelineSection);
}

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

  const lastView = localStorage.getItem("faiaudit_view");
  if (lastView === "settings") {
    showView("settings");
    await loadClients();
    await loadNotifyNumber();
  } else if (lastView === "sales") {
    showView("sales");
    await loadStaff();
  } else if (lastView === "kanban") {
    showView("kanban");
    await loadKanban();
  } else if (lastView === "analytics") {
    showView("analytics");
    await loadAnalytics();
  } else {
    showView("app");
    await loadDashboard();
    maybeShowIntro();
  }
}

// ---- Sidebar collapse/expand (redesain: rail ikon saat ditutup) ----
(function initSidebarCollapse() {
  const shellEl = document.getElementById("shell");
  const collapseBtn = document.getElementById("collapseBtn");
  const expandBtn = document.getElementById("expandBtn");
  if (!shellEl || !collapseBtn || !expandBtn) return;
  const KEY = "faiaudit_sidebar_collapsed";
  function setCollapsed(state) {
    shellEl.classList.toggle("sidebar-collapsed", state);
    localStorage.setItem(KEY, state ? "1" : "0");
  }
  collapseBtn.addEventListener("click", () => setCollapsed(true));
  expandBtn.addEventListener("click", () => setCollapsed(false));
  if (localStorage.getItem(KEY) === "1") setCollapsed(true);
})();

restoreSession();
