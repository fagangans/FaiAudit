const ownerIdInput = document.getElementById("ownerId");
const sheetBody = document.getElementById("sheetBody");

ownerIdInput.value = localStorage.getItem("faiaudit_owner_id") || "";

function headers() {
  return { "Content-Type": "application/json", "x-owner-id": ownerIdInput.value.trim() };
}

async function loadDashboard() {
  const ownerId = ownerIdInput.value.trim();
  localStorage.setItem("faiaudit_owner_id", ownerId);
  if (!ownerId) {
    sheetBody.innerHTML = '<tr><td colspan="10">Isi Owner ID dahulu.</td></tr>';
    return;
  }

  const res = await fetch("/api/dashboard", { headers: headers() });
  const rows = await res.json();
  if (!res.ok) {
    sheetBody.innerHTML = `<tr><td colspan="10">${rows.error || "Gagal memuat data"}</td></tr>`;
    return;
  }

  if (!rows.length) {
    sheetBody.innerHTML = '<tr><td colspan="10">Belum ada lead. Tambahkan sales dan tunggu chat masuk.</td></tr>';
    return;
  }

  sheetBody.innerHTML = rows
    .map(
      (r) => `
    <tr>
      <td>${r.staff_name || "-"}</td>
      <td>${r.lead_name}</td>
      <td>${r.wa_status || "-"}</td>
      <td>${r.previous_stage}</td>
      <td><span class="stage stage-${r.funnel_stage}">${r.funnel_stage}</span></td>
      <td>${r.score}</td>
      <td>${r.analysis_notes}</td>
      <td>${r.evaluation}</td>
      <td>${r.analyzed_at ? new Date(r.analyzed_at).toLocaleString("id-ID") : "-"}</td>
      <td><button data-lead="${r.lead_id}" class="analyze">Analisis</button></td>
    </tr>`,
    )
    .join("");

  sheetBody.querySelectorAll(".analyze").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "...";
      const res = await fetch(`/api/leads/${btn.dataset.lead}/analyze`, {
        method: "POST",
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Gagal analisis");
      await loadDashboard();
    });
  });
}

async function addStaff() {
  const ownerId = ownerIdInput.value.trim();
  if (!ownerId) return alert("Isi Owner ID dahulu.");
  const name = prompt("Nama sales/staff?");
  if (!name) return;
  const wa_number = prompt("Nomor WhatsApp (format 62xxxxxxxxxx)?");
  if (!wa_number) return;

  const res = await fetch("/api/staff", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ name, wa_number }),
  });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "Gagal menambah sales");
  alert(`Sales ditambahkan. Pairing code WhatsApp: ${data.pairing_code || "(cek log server)"}`);
  loadDashboard();
}

document.getElementById("refresh").addEventListener("click", loadDashboard);
document.getElementById("addStaff").addEventListener("click", addStaff);

loadDashboard();
