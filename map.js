/* UK institutions map: Leaflet + clustering. Lists the institutions in view nearest-first from the map centre or a searched postcode/town. */
(() => {
"use strict";
const A = () => window.__atlas;
const el = (...a) => A().el(...a);
const rad = d => d * Math.PI / 180;
const MI = 3958.8;
const miles = (a, b, c, d) => { const x = rad(c - a), y = rad(d - b), h = Math.sin(x / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(y / 2) ** 2; return 2 * MI * Math.asin(Math.sqrt(h)); };
const theme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
const BOUNDS = [[49.9, -7.8], [58.9, 1.8]], MAXB = [[48, -13], [62.5, 4.5]];
const jget = async u => { try { const r = await fetch(u); return r.ok ? (await r.json()).result : null; } catch { return null; } };

let map, cluster, tiles, rows = [], ref = null, refLabel = "", pin = null, ring = null, sel = null, timer = 0, shown = [], ready = false, fitted = false;
const F = { prio: "all", email: false, full: false };
const $ = s => document.querySelector("#uk" + s);

// ---- view skeleton
const sec = document.createElement("section");
sec.id = "ukView"; sec.className = "ukview view"; sec.hidden = true;
sec.innerHTML = `<aside class="ukpanel">
  <form id="ukSearch" class="uk-search" autocomplete="off">
    <input id="ukQ" type="search" placeholder="Postcode or town, e.g. M1 1AE, Leeds" aria-label="Search">
    <button class="btn primary" type="submit">Find</button>
    <button class="btn" type="button" id="ukLocate" title="Use my location">◎</button>
  </form>
  <div class="uk-filters">
    <div class="seg" id="ukPrio" role="group" aria-label="Priority"><button data-v="all" class="on">All</button><button data-v="High">High</button><button data-v="Medium">Medium</button><button data-v="rest">Low / review</button></div>
  </div>
  <div class="uk-filters" style="padding-top:0">
    <label class="chk"><input type="checkbox" id="ukEmail"> Has email contact</label>
    <label class="chk"><input type="checkbox" id="ukFull"> Fully profiled</label>
  </div>
  <div class="uk-sum" id="ukSum"></div>
  <div class="uk-list" id="ukList"></div>
  <div class="uk-foot"><button class="btn small" id="ukCopy">Copy emails</button><button class="btn small" id="ukCsv">Export these CSV</button></div>
</aside>
<div class="ukmapwrap"><div id="ukMap"></div></div>`;
document.getElementById("app").append(sec);

const prioOk = r => F.prio === "all" || (F.prio === "rest" ? !["High", "Medium"].includes(r.priority) : r.priority === F.prio);
const visible = () => rows.filter(r => prioOk(r) && (!F.email || r.nEmail > 0) && (!F.full || !r.reconstructed));

function setTiles() {
  if (!tiles) tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
  $("Map").classList.toggle("dark", theme() !== "light");
}
function paintMarkers() {
  cluster.clearLayers();
  cluster.addLayers(visible().map(r => {
    const m = L.circleMarker([r.lat, r.lng], { radius: 8, weight: r.prec !== "campus" ? 2 : 1.5, dashArray: r.prec !== "campus" ? "3 2" : null, color: r.prec !== "campus" ? "#fbbf24" : "#0b1220", fillColor: A().PRIO_COLOR[r.priority] || "#8fa0c0", fillOpacity: .95 });
    m.on("click", () => select(r, false)); r._m = m; return m; }));
}
function detail(r) {
  const cons = A().data.conByInst.get(r.id) || [], w = r.web && A().safeUrl(r.web);
  const lines = [];
  if (r.type) lines.push(el("div", {}, r.type));
  if (r.prec === "town") lines.push(el("div", { class: "uk-note" }, "Approximate: pin shown at the centre of " + (r.city || "the town") + "."));
  if (r.prec === "name") lines.push(el("div", { class: "uk-note" }, "Approximate: matched by name only (no city recorded yet). Check before relying on the location."));
  lines.push(el("div", {}, `${cons.length} contacts · ${r.nEmail} with email · ${r.famN}/8 role families covered`));
  if (r.reconstructed) lines.push(el("div", { class: "uk-note" }, "Reconstructed profile: verify before outreach."));
  const acts = [el("button", { class: "btn small primary", onclick: () => A().openInst(r.id) }, "Open record")];
  if (w) acts.push(el("a", { class: "btn small", href: w, target: "_blank", rel: "noopener noreferrer" }, "Website"));
  acts.push(el("a", { class: "btn small", target: "_blank", rel: "noopener noreferrer", href: `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}` }, "Directions"));
  return el("div", { class: "uk-detail" }, ...lines, el("div", { class: "uk-acts" }, ...acts));
}
function card(r) {
  const d = r._d;
  const c = el("div", { class: "uk-card" + (sel === r ? " on" : ""), tabindex: "0", role: "button" },
    el("div", { class: "uk-row1" }, el("b", {}, r.name), el("span", { class: "uk-dist" }, d == null ? "" : (d < 0.1 ? "<0.1" : d.toFixed(1)) + " mi")),
    el("div", { class: "uk-row2" }, el("span", { class: "uk-pc" }, r.city || r.nation || "—"), el("span", { class: "tag", style: `border-color:${A().PRIO_COLOR[r.priority]};color:${A().PRIO_COLOR[r.priority]}` }, r.priority),
      r.prec !== "campus" ? el("span", { class: "tag" }, "approx.") : "", r.nContacts ? el("span", { class: "tag" }, r.nContacts + " contacts") : "", r.nEmail ? el("span", { class: "tag ok" }, "email") : ""));
  if (sel === r) c.append(detail(r));
  const go = () => select(r, true);
  c.addEventListener("click", e => { if (!e.target.closest("a,button")) go(); });
  c.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === c) go(); });
  return c;
}
function refresh() {
  if (!map) return;
  const b = map.getBounds(), c = ref || map.getCenter(); const [la, ln] = Array.isArray(c) ? c : [c.lat, c.lng];
  const inView = visible().filter(r => b.contains([r.lat, r.lng]));
  inView.forEach(r => r._d = miles(la, ln, r.lat, r.lng)); inView.sort((x, y) => x._d - y._d);
  shown = inView; const top = inView.slice(0, 80), f = A().fmt, unplaced = A().data.inst.length - rows.length;
  $("Sum").textContent = (!inView.length ? "No institutions in this part of the map. Zoom out or search elsewhere."
    : `${f(inView.length)} institution${inView.length === 1 ? "" : "s"} in view · nearest to ${ref ? refLabel : "the map centre"}` + (inView.length > top.length ? ` · showing ${top.length}` : "")) + (unplaced ? ` · ${f(unplaced)} not placed yet` : "");
  const list = $("List"); list.innerHTML = ""; top.forEach(r => list.append(card(r)));
  if (sel) list.querySelector(".uk-card.on")?.scrollIntoView({ block: "nearest" });
}
const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 120); };
function select(r, fly) {
  sel = r; if (fly) map.flyTo([r.lat, r.lng], Math.max(map.getZoom(), 14), { duration: .6 });
  L.popup({ closeButton: false, offset: [0, -4] }).setLatLng([r.lat, r.lng]).setContent(el("div", { class: "uk-pop" }, el("b", {}, r.name), el("div", {}, r.city || ""))).openOn(map);
  refresh();
}
function setRef(lat, lng, label, zoom) {
  ref = [lat, lng]; refLabel = label; sel = null;
  if (pin) map.removeLayer(pin); if (ring) map.removeLayer(ring);
  pin = L.marker(ref, { icon: L.divIcon({ className: "uk-pin", html: "<span></span>", iconSize: [22, 22], iconAnchor: [11, 11] }), keyboard: false }).addTo(map);
  ring = L.circle(ref, { radius: 16093, color: "#fb7185", weight: 1.5, dashArray: "5 5", fill: false }).addTo(map);
  map.flyTo(ref, zoom || 11, { duration: .7 }); map.once("moveend", refresh); refresh();
}
async function search(q) {
  q = q.trim().replace(/\s+/g, " "); if (!q) return;
  $("Sum").textContent = "Searching…"; const c = q.toUpperCase().replace(/\s/g, ""); let res;
  if (/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(c) && (res = await jget("https://api.postcodes.io/postcodes/" + c))) return setRef(res.latitude, res.longitude, res.postcode, 13);
  if (/^[A-Z]{1,2}\d[A-Z\d]?$/.test(c) && (res = await jget("https://api.postcodes.io/outcodes/" + c)) && res.latitude) return setRef(res.latitude, res.longitude, res.outcode, 12);
  const pl = await jget("https://api.postcodes.io/places?limit=1&q=" + encodeURIComponent(q));
  const hit = rows.find(r => r.name.toLowerCase().includes(q.toLowerCase()));
  if (pl && pl[0] && pl[0].latitude && (!hit || pl[0].name_1.toLowerCase() === q.toLowerCase())) return setRef(pl[0].latitude, pl[0].longitude, pl[0].name_1, 11);
  if (hit) { select(hit, true); return; }
  $("Sum").textContent = "Couldn't find that postcode, town or institution. Try LE1 6TP, SW1A, Leeds or part of a university name.";
}
function locate() {
  if (!navigator.geolocation) return A().toast("Location isn't available in this browser");
  navigator.geolocation.getCurrentPosition(p => setRef(p.coords.latitude, p.coords.longitude, "your location", 11), () => A().toast("Location permission was declined"), { timeout: 10000 });
}
function exportCsv() {
  if (!shown.length) return A().toast("Nothing in view to export");
  const cols = ["Institution", "ID", "Priority", "Type", "Nation", "City", "Website", "Contacts", "Contacts with email", "Distance (mi)", "Location precision"];
  A().download(`universities-near-${(refLabel || "map-centre").replace(/\W+/g, "-")}-${A().today()}.csv`, [cols, ...shown.map(r => [r.name, r.id, r.priority, r.typeCat, r.nation, r.city, r.web, r.nContacts, r.nEmail, r._d.toFixed(2), r.prec])].map(l => l.map(A().csvCell).join(",")).join("\r\n"));
}
function init() {
  map = L.map("ukMap", { zoomControl: true, minZoom: 5, maxBounds: MAXB, maxBoundsViscosity: .8, preferCanvas: true }); map.fitBounds(BOUNDS); setTiles();
  new MutationObserver(setTiles).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  cluster = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 17 }); map.addLayer(cluster);
  map.on("moveend", later); map.on("click", () => { if (sel) { sel = null; map.closePopup(); refresh(); } });
  $("Search").addEventListener("submit", e => { e.preventDefault(); search($("Q").value); });
  $("Locate").addEventListener("click", locate);
  $("Prio").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; F.prio = b.dataset.v; [...$("Prio").children].forEach(x => x.classList.toggle("on", x === b)); paintMarkers(); refresh(); });
  $("Email").addEventListener("change", e => { F.email = e.target.checked; paintMarkers(); refresh(); });
  $("Full").addEventListener("change", e => { F.full = e.target.checked; paintMarkers(); refresh(); });
  $("Copy").addEventListener("click", () => { const e = A().emailsOf(shown.flatMap(i => (A().data.conByInst.get(i.id) || []).map(c => c.email))); if (!e.length) return A().toast("No emails in view"); navigator.clipboard.writeText(e.join("; ")).then(() => A().toast(`Copied ${e.length} unique emails`), () => A().toast("Copy blocked by the browser")); });
  $("Csv").addEventListener("click", exportCsv);
}
window.COUNTRYMAPS = { uk: { open(focus) {
  if (!ready) { rows = A().data.inst.filter(i => i.hasPos); if (!rows.length && !A().data.inst.length) return; init(); paintMarkers(); ready = true; }
  setTimeout(() => { map.invalidateSize(); if (!fitted) { fitted = true; map.fitBounds(BOUNDS); } refresh(); if (focus) { const r = rows.find(x => x.id === focus); if (r) select(r, true); } }, 50);
} } };
})();
