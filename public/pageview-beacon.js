/**
 * FaiAudit traffic beacon — tempel di tiap web yang mau dipantau:
 *
 *   <script src="https://audit.faiagent.my.id/pageview-beacon.js" data-site="NAMA_TARGET_DI_MONITORING" defer></script>
 *
 * "NAMA_TARGET_DI_MONITORING" harus sama persis dengan kolom `name` di
 * tabel monitor_targets (mis. "FAGANFAiAgent", "Faibleclip", dst).
 * Tidak mengirim cookie/kredensial; best-effort analytics saja.
 */
(function () {
  var thisScript = document.currentScript;
  if (!thisScript) return;
  var site = thisScript.getAttribute("data-site");
  if (!site) return;

  var apiBase = new URL(thisScript.src).origin;
  var payload = JSON.stringify({
    site: site,
    path: location.pathname + location.search,
    referrer: document.referrer || null,
  });

  function send() {
    var url = apiBase + "/api/monitoring-beacon/pageview";
    if (navigator.sendBeacon) {
      var blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(function () {});
  }

  if (document.readyState === "complete") send();
  else window.addEventListener("load", send);
})();
