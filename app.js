/* Universities Atlas: UK map, institutions, contacts, progress. Plain JS, no build step. */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, props = {}, ...kids) => { const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v); }
  kids.flat(Infinity).forEach(c => { if (c === false || c == null || c === true) return; e.append(c.nodeType ? c : document.createTextNode(c)); }); return e; };
const fmt = n => Number(n).toLocaleString("en-GB");
const safeUrl = u => { try { const x = new URL(/^https?:\/\//i.test(u) ? u : "https://" + u); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch { return ""; } };
const store = { get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const csvCell = v => { v = String(v ?? ""); if (/^[=@+\-\t\r]/.test(v) && !/^\+?\d[\d\s()-]*$/.test(v)) v = "'" + v; return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const firstEmail = s => (String(s || "").split(/[;,\s]+/).find(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) || "");
const emailsOf = list => [...new Set(list.flatMap(r => String(r || "").split(/[;,\s]+/)).map(e => e.trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
const today = () => new Date().toISOString().slice(0, 10);

const INST_STATUSES = ["Prospect", "Contacted", "In discussion", "Partner", "Parked", "Not a fit"];
const CON_STATUSES = ["Not contacted", "Contacted", "Replied", "Meeting", "Qualified", "Not a fit"];
const PRIO_COLOR = { High: "#2dd4bf", Medium: "#60a5fa", Low: "#a78bfa", Review: "#8fa0c0" };
const FAM_SHORT = ["Leadership", "UK onshore", "Agent relations", "Regional", "Marketing", "Admissions", "Progression", "Partnerships"];

/* ---------- theme ---------- */
const root = document.documentElement;
const savedTheme = store.get("univ.theme", null); if (savedTheme) root.dataset.theme = savedTheme;
$("#themeBtn").onclick = () => { const cur = root.dataset.theme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const nx = cur === "dark" ? "light" : "dark"; root.dataset.theme = nx; store.set("univ.theme", nx); };

/* ---------- state ---------- */
const D = { inst: [], con: [], instById: new Map(), conByInst: new Map(), manifest: null, cov: null, prov: null };
const ACT = store.get("univ.actions.v1", {}); // id -> {s: status, st: starred, o: owner, n: note}
const saveActs = () => store.set("univ.actions.v1", ACT);

/* ---------- access key (data files are AES-GCM encrypted; the key never leaves the browser) ---------- */
let KEY = null;
const te = new TextEncoder();
const b64 = { enc: u => btoa(String.fromCharCode(...u)), dec: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
async function deriveRaw(pass) {
  const salt = new Uint8Array(await fetch("data/salt.bin").then(r => r.arrayBuffer()));
  const base = await crypto.subtle.importKey("raw", te.encode(pass.trim()), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, 256));
}
const importKey = raw => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
async function getJSON(path) {
  const r = await fetch(path); if (!r.ok) throw new Error(r.status);
  const buf = new Uint8Array(await r.arrayBuffer());
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, KEY, buf.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
const objs = d => d.rows.map(a => { const o = {}; d.cols.forEach((c, i) => o[c] = a[i]); return o; });

const routeCat = r => /named/i.test(r) && !/regional team/i.test(r) ? "Named person" : /team|inbox|email|enquiry|form|switchboard|shared/i.test(r) ? "Team / shared route" : r ? "Other" : "Unspecified";

async function startApp(m) {
  D.manifest = m;
  const [ii, cc] = await Promise.all([getJSON("data/institutions.json"), getJSON("data/contacts.json")]);
  D.inst = objs(ii); D.con = objs(cc); D.families = ii.families;
  D.inst.forEach(i => { D.instById.set(i.id, i); i._s = [i.name, i.city, i.nation, i.type, i.web, i.id, i.context, i.fit, i.notes].join(" \u0001 ").toLowerCase(); i.famText = i.famHave.map(f => FAM_SHORT[f]).join(", "); i.famN = i.famHave.length; i.hasPos = i.lat != null; });
  D.con.forEach(c => { (D.conByInst.get(c.inst) || D.conByInst.set(c.inst, []).get(c.inst)).push(c);
    const i = D.instById.get(c.inst); c.instName = i ? i.name : c.inst; c.instPriority = i ? i.priority : ""; c.famText = c.fam.map(f => FAM_SHORT[f]).join(", "); c.routeCat = routeCat(c.route);
    c._s = [c.name, c.title, c.instName, c.email, c.phone, c.role, c.team, c.regions, c.id, c.notes].join(" \u0001 ").toLowerCase(); });
  $("#ovStats").textContent = `${fmt(m.institutions)} institutions · ${fmt(m.contacts)} contacts and team routes · ${fmt(m.withEmail)} with a published email · ${fmt(m.mapped)} placed on the map`;
  window.dispatchEvent(new Event("atlas-data"));
  route();
}
async function tryKey(raw, remember) {
  KEY = await importKey(raw);
  let m; try { m = await getJSON("data/manifest.json"); } catch { KEY = null; throw new Error("bad key"); }
  if (remember) { try { localStorage.setItem("univ.k", b64.enc(raw)); } catch {} }
  $("#lock").hidden = true; document.body.classList.remove("locked"); await startApp(m);
}
function showLock(msg) { document.body.classList.add("locked"); $("#lock").hidden = false; $("#lockMsg").textContent = msg || ""; $("#lockKey").focus(); }
$("#lockForm").addEventListener("submit", async e => {
  e.preventDefault(); const btn = $("#lockGo"); btn.disabled = true; $("#lockMsg").textContent = "Checking…";
  try { await tryKey(await deriveRaw($("#lockKey").value), $("#lockRemember").checked); $("#lockKey").value = ""; }
  catch { $("#lockMsg").textContent = "That key didn't work."; $("#lockKey").select(); }
  btn.disabled = false;
});
$("#lockBtn").addEventListener("click", () => { try { localStorage.removeItem("univ.k"); } catch {} location.reload(); });
(async () => {
  let saved = null; try { saved = localStorage.getItem("univ.k"); } catch {}
  if (saved) { try { await tryKey(b64.dec(saved), false); return; } catch { try { localStorage.removeItem("univ.k"); } catch {} } }
  showLock();
})();
addEventListener("hashchange", () => { if (D.manifest) route(); });

/* ---------- routing ---------- */
function show(id, nav) {
  for (const [k, v] of Object.entries({ navMap: "map", navInst: "inst", navCon: "con", navOv: "ov", navPg: "pg" })) $("#" + k).classList.toggle("on", v === nav);
  for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id; closeDrawer();
}
function crumbs(parts) { const c = $("#crumbs"); c.innerHTML = "";
  parts.forEach((p, i) => { if (i) c.append(el("span", { class: "sep" }, "›")); c.append(p.href ? el("a", { href: p.href }, p.label) : el("span", { class: "cur" }, p.label)); }); }
function parseHash() { const h = location.hash.replace(/^#\/?/, ""); const [path, qs] = h.split("?");
  return { parts: path.split("/").filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs || "") }; }
function route() {
  const { parts, params } = parseHash(); const v = parts[0] || "map";
  if (v === "map") { show("ukView", "map"); crumbs([{ label: "UK map" }]); window.COUNTRYMAPS?.uk.open(params.get("focus")); }
  else if (v === "overview") { show("overviewView", "ov"); crumbs([{ label: "Overview" }]); renderOverview(); }
  else if (v === "institutions" || v === "i") { show("dataView", "inst"); openGrid("inst", params, parts[1]); }
  else if (v === "contacts" || v === "c") { show("dataView", "con"); openGrid("con", params, parts[1]); }
  else if (v === "progress") { show("progressView", "pg"); crumbs([{ label: "Progress" }]); renderProgress(); }
  else location.hash = "#/map";
}

/* ---------- overview ---------- */
function barCard(title, rows, hrefFor, colorFor) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return el("div", { class: "cc" }, el("h3", {}, title), el("div", { class: "ccb" }, rows.map(r =>
    el(hrefFor ? "a" : "div", { class: "bar-row", href: hrefFor ? hrefFor(r) : null, style: `--c:${colorFor ? colorFor(r) : "var(--teal)"}` },
      el("span", {}, r.label), el("i", {}, el("b", { style: `width:${r.n / max * 100}%` })), el("em", {}, fmt(r.n))))));
}
function count(list, f) { const m = new Map(); list.forEach(x => { const k = f(x); if (k != null && k !== "") m.set(k, (m.get(k) || 0) + 1); }); return [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n); }
function renderOverview() {
  const I = D.inst, q = k => "#/institutions?" + k;
  const pr = ["High", "Medium", "Low", "Review"].map(l => ({ label: l, n: I.filter(i => i.priority === l).length }));
  const famRows = D.families.map((f, i) => ({ label: FAM_SHORT[i], full: f, n: I.filter(x => x.famHave.includes(i)).length }));
  $("#ovCards").replaceChildren(
    barCard("Priority", pr, r => q("priority=" + r.label), r => PRIO_COLOR[r.label]),
    barCard("Institutions with a contact route, by role family", famRows, r => "#/contacts?fam=" + encodeURIComponent(r.full)),
    barCard("Nation", count(I, i => i.nation || "Not recorded yet"), r => q("nation=" + encodeURIComponent(r.label)), () => "var(--blue)"),
    barCard("Institution type", count(I, i => i.typeCat), r => q("typeCat=" + encodeURIComponent(r.label)), () => "var(--amber)"),
    barCard("Top cities", count(I, i => i.city).slice(0, 8), r => q("q=" + encodeURIComponent(r.label)), () => "var(--violet)"));
}

/* ---------- progress ---------- */
const BUCKETS = ["Route confirmed", "Route recorded — to verify", "No public route found", "Pending", "Other"];
const BUCKET_COLOR = { "Route confirmed": "var(--teal)", "Route recorded — to verify": "var(--blue)", "No public route found": "var(--faint)", "Pending": "var(--amber)", "Other": "var(--line2)" };
async function ensureCov() { if (!D.cov) { const [c, p] = await Promise.all([getJSON("data/coverage.json"), getJSON("data/providers.json")]); D.cov = objs(c); D.prov = objs(p); } return D.cov; }
const kpi = (l, v, sub) => el("div", { class: "kpi" }, el("span", {}, l), el("b", {}, v), sub ? el("div", { class: "dim", style: "font-size:12px" }, sub) : "");
async function renderProgress() {
  const m = D.manifest; $("#pgMeta").textContent = `Built ${m.generated.replace("T", " ")} · source files last changed ${Object.values(m.sourceModified).sort().pop().replace("T", " ")}`;
  await ensureCov();
  const I = D.inst, recon = I.filter(i => i.reconstructed).length, bc = m.coverage;
  const closed = (bc["No public route found"] || 0) + (bc["Route confirmed"] || 0);
  $("#pgKpis").replaceChildren(kpi("Institutions", fmt(I.length)), kpi("Fully profiled", fmt(I.length - recon), `${recon} reconstructed, need review`), kpi("Contacts", fmt(m.contacts), `${fmt(m.named)} named people`),
    kpi("Published emails", fmt(m.withEmail)), kpi("Role checks closed", fmt(closed), `of ${fmt(m.coverageChecks)}`), kpi("Still pending", fmt(bc["Pending"] || 0)), kpi("To re-verify", fmt(bc["Route recorded — to verify"] || 0)), kpi("On the map", fmt(m.mapped), `${I.length - m.mapped} without a location`));
  const byFam = D.families.map((f, i) => { const c = Object.fromEntries(BUCKETS.map(b => [b, 0])); D.cov.filter(r => r.fam === i).forEach(r => c[r.bucket] = (c[r.bucket] || 0) + 1); return { f, c, t: Object.values(c).reduce((a, b) => a + b, 0) }; });
  $("#pgFam").replaceChildren(el("table", { class: "ptable" }, el("thead", {}, el("tr", {}, el("th", {}, "Role family"), BUCKETS.map(b => el("th", {}, b)), el("th", {}, "Mix"))),
    el("tbody", {}, byFam.map(r => el("tr", {}, el("td", {}, r.f), BUCKETS.map(b => el("td", { class: "mono" }, fmt(r.c[b]))),
      el("td", {}, el("span", { class: "stack" }, BUCKETS.map(b => el("b", { style: `width:${r.t ? r.c[b] / r.t * 100 : 0}%;background:${BUCKET_COLOR[b]}`, title: b })))))))));
  const comp = count(I, i => i.complete), geo = [{ label: "Campus match", n: m.geo.campus || 0 }, { label: "Name match only (approx.)", n: m.geo.name || 0 }, { label: "Town centre only", n: m.geo.town || 0 }, { label: "Not placed", n: m.geo.none || 0 }];
  $("#pgCards").replaceChildren(barCard("Profile completeness", comp, r => "#/institutions?complete=" + r.label), barCard("Map location precision", geo, null, r => r.label === "Not placed" ? "var(--rose)" : "var(--teal)"),
    barCard("Institution stage", count(I, i => i.stage || i.status), r => "#/institutions?stage=" + encodeURIComponent(r.label), () => "var(--violet)"));
  const disp = count(D.prov, p => p.disposition.split(/\s+[—–]\s+/)[0]);
  $("#pgProv").replaceChildren(el("table", { class: "ptable" }, el("thead", {}, el("tr", {}, el("th", {}, "Disposition"), el("th", {}, "Candidates"))), el("tbody", {}, disp.map(d => el("tr", {}, el("td", {}, d.label), el("td", { class: "mono" }, fmt(d.n)))))));
}

/* ---------- grids ---------- */
const ROW_H = 38;
const link = (href, text) => { const u = safeUrl(href); return u ? el("a", { href: u, target: "_blank", rel: "noopener noreferrer", onclick: e => e.stopPropagation() }, text) : text; };
const mailto = e => { const a = firstEmail(e); return a ? el("a", { href: "mailto:" + a, onclick: e2 => e2.stopPropagation() }, e) : e; };
const srcCount = i => i.sources.length;
const effStatus = (id, base) => ACT[id]?.s || base;
const GRIDS = {
  inst: { title: "Institutions", noun: "institution", rows: () => D.inst, idKey: "id", statuses: INST_STATUSES, base: r => r.stage || "Prospect", search: "_s", ph: "Search name, city, type, notes…",
    cols: [
      { k: "name", label: "Institution", w: 300, cell: r => el("b", {}, r.name) },
      { k: "priority", label: "Priority", w: 90, cell: r => el("span", { class: "dot-t", style: `--c:${PRIO_COLOR[r.priority]}` }, r.priority) },
      { k: "typeCat", label: "Type", w: 160 }, { k: "nation", label: "Nation", w: 120, get: r => r.nation || "—" }, { k: "city", label: "City", w: 130 },
      { k: "nContacts", label: "Contacts", w: 90, num: true }, { k: "nEmail", label: "Emails", w: 80, num: true },
      { k: "famN", label: "Role families", w: 120, num: true, cell: r => el("span", {}, el("span", { class: "mini" }, el("b", { style: `width:${r.famN / 8 * 100}%` })), " ", r.famN + "/8") },
      { k: "stage", label: "Stage", w: 120 }, { k: "complete", label: "Completeness", w: 120 }, { k: "checked", label: "Checked", w: 110, mono: true },
      { k: "web", label: "Website", w: 200, cell: r => r.web ? link(r.web, r.web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")) : "" },
      { k: "intlUrl", label: "Intl recruitment page", w: 220, hide: true, cell: r => r.intlUrl ? link(r.intlUrl, r.intlUrl.replace(/^https?:\/\/(www\.)?/, "")) : "" },
      { k: "partUrl", label: "Partnership page", w: 220, hide: true, cell: r => r.partUrl ? link(r.partUrl, r.partUrl.replace(/^https?:\/\/(www\.)?/, "")) : "" },
      { k: "type", label: "Type (as published)", w: 260, hide: true }, { k: "prec", label: "Map precision", w: 110, hide: true, get: r => r.prec || "not placed" },
      { k: "famText", label: "Families with a route", w: 260, hide: true }, { k: "fit", label: "Partnership fit", w: 320, hide: true }, { k: "context", label: "Student / market context", w: 420, hide: true },
      { k: "notes", label: "Notes", w: 420, hide: true }, { k: "sources", label: "Source URLs", w: 320, hide: true, get: r => r.sources.join(" ; ") }, { k: "id", label: "ID", w: 100, hide: true, mono: true }],
    filters: [{ k: "priority", label: "Priority" }, { k: "typeCat", label: "Type" }, { k: "nation", label: "Nation", get: r => r.nation || "Not recorded yet" }, { k: "stage", label: "Stage" }, { k: "complete", label: "Completeness" }],
    toggles: [{ k: "email", label: "Has email contact", test: r => r.nEmail > 0 }, { k: "mapped", label: "On map", test: r => r.hasPos }, { k: "verified", label: "Fully profiled", test: r => !r.reconstructed }],
    defaults: ["name", "priority", "typeCat", "nation", "city", "nContacts", "nEmail", "famN", "stage", "web"], drawer: r => openInstDrawer(r), sort: { k: "priority" } },
  con: { title: "Contacts", noun: "contact", rows: () => D.con, idKey: "id", statuses: CON_STATUSES, base: r => r.status || "Not contacted", search: "_s", ph: "Search name, role, institution, email…",
    cols: [
      { k: "name", label: "Name", w: 190, get: r => r.name || "(team route)", cell: r => r.name ? el("b", {}, r.name) : el("span", { class: "dim" }, "(team route)") },
      { k: "title", label: "Job title", w: 260 }, { k: "instName", label: "Institution", w: 260, cell: r => el("a", { href: "#/i/" + r.inst, onclick: e => e.stopPropagation() }, r.instName) },
      { k: "famText", label: "Role families", w: 200 }, { k: "email", label: "Email", w: 250, cell: r => mailto(r.email) }, { k: "phone", label: "Phone", w: 140, mono: true },
      { k: "routeCat", label: "Route", w: 130 }, { k: "regions", label: "Regions covered", w: 180 }, { k: "statusEff", label: "Status", w: 120, get: r => effStatus(r.id, r.status || "Not contacted") },
      { k: "checked", label: "Checked", w: 110, mono: true }, { k: "source", label: "Source", w: 90, cell: r => r.source ? link(r.source, "source ↗") : "" },
      { k: "team", label: "Team / department", w: 220, hide: true }, { k: "role", label: "Role category (as published)", w: 260, hide: true }, { k: "route", label: "Route type (as published)", w: 200, hide: true },
      { k: "evidence", label: "Agent onboarding evidence", w: 420, hide: true }, { k: "notes", label: "Notes", w: 420, hide: true }, { k: "sourceUrl", label: "Source URL", w: 320, hide: true, get: r => r.source },
      { k: "instPriority", label: "Institution priority", w: 120, hide: true }, { k: "id", label: "ID", w: 100, hide: true, mono: true }],
    filters: [{ k: "fam", label: "Role family", multi: true, get: r => r.fam.map(f => D.families[f]), order: () => D.families }, { k: "routeCat", label: "Route" }, { k: "instPriority", label: "Institution priority" }, { k: "statusEff", label: "Status", get: r => effStatus(r.id, r.status || "Not contacted") }],
    toggles: [{ k: "email", label: "Has email", test: r => !!firstEmail(r.email) }, { k: "named", label: "Named person", test: r => !!r.name }, { k: "phone", label: "Has phone", test: r => !!r.phone }],
    defaults: ["name", "title", "instName", "famText", "email", "phone", "routeCat", "statusEff", "source"], drawer: r => openConDrawer(r), sort: { k: "instName" } }
};
const G = { key: null, def: null, rows: [], view: [], sort: null, sel: new Set(), open: null, filt: {}, cols: [], widths: {} };
const gval = (r, c) => { const v = c.get ? c.get(r) : r[c.k]; return v == null ? "" : v; };
const colDef = k => G.def.cols.find(c => c.k === k);
const visCols = () => G.cols.map(colDef).filter(Boolean);
const colW = c => G.widths[c.k] || c.w;
const totalW = () => 78 + visCols().reduce((a, c) => a + colW(c), 0);
const prioRank = { High: 0, Medium: 1, Low: 2, Review: 3 };

function openGrid(key, params, openId) {
  const def = GRIDS[key]; const changed = G.key !== key;
  G.key = key; G.def = def; G.rows = def.rows();
  if (changed) { G.sel = new Set(); G.sort = { ...def.sort, dir: 1 }; G.cols = store.get("univ.cols." + key, def.defaults); G.widths = store.get("univ.widths." + key, {}); G.filt = { q: "", sel: {}, tog: new Set() }; }
  G.filt = changed || params.size ? { q: params.get("q") || "", sel: {}, tog: new Set(params.getAll("tog")) } : G.filt;
  for (const f of def.filters) if (params.get(f.k)) G.filt.sel[f.k] = params.get(f.k);
  crumbs([{ label: def.title }]);
  $("#dvTitle").textContent = def.title; $("#q").placeholder = def.ph; $("#q").value = G.filt.q;
  renderToolbar(); renderChips(); applyFilters(true);
  if (openId) { const r = G.rows.find(x => x[def.idKey] === openId); if (r) def.drawer(r); }
}
function facet(f) { const m = new Map(); G.rows.forEach(r => { const v = f.get ? f.get(r) : r[f.k]; (Array.isArray(v) ? v : [v]).forEach(x => { if (x !== "" && x != null) m.set(x, (m.get(x) || 0) + 1); }); });
  const order = f.order ? f.order() : null; return [...m].sort((a, b) => order ? order.indexOf(a[0]) - order.indexOf(b[0]) : f.k === "priority" || f.k === "instPriority" ? (prioRank[a[0]] ?? 9) - (prioRank[b[0]] ?? 9) : b[1] - a[1]); }
function renderToolbar() {
  const box = $("#tbFilters"); box.innerHTML = "";
  G.def.filters.forEach(f => { const s = el("select", { "aria-label": f.label, onchange: e => { e.target.value ? G.filt.sel[f.k] = e.target.value : delete G.filt.sel[f.k]; applyFilters(true); renderChips(); } },
      el("option", { value: "" }, f.label + ": all"), facet(f).map(([v, n]) => el("option", { value: v, selected: G.filt.sel[f.k] === v }, `${v} (${fmt(n)})`))); box.append(s); });
  G.def.toggles.forEach(t => box.append(el("label", { class: "tog" + (G.filt.tog.has(t.k) ? " on" : ""), onclick: e => { e.preventDefault(); G.filt.tog.has(t.k) ? G.filt.tog.delete(t.k) : G.filt.tog.add(t.k); renderToolbar(); applyFilters(true); } }, t.label)));
}
function renderChips() {
  const box = $("#dvChips"); box.innerHTML = "";
  Object.entries(G.filt.sel).forEach(([k, v]) => box.append(el("button", { class: "chip on", title: "Remove filter", onclick: () => { delete G.filt.sel[k]; renderToolbar(); renderChips(); applyFilters(true); } }, `${G.def.filters.find(f => f.k === k)?.label}: ${v}  ×`)));
}
$("#q").addEventListener("input", debounce(e => { if (!G.def) return; G.filt.q = e.target.value; applyFilters(true); }, 150));
function applyFilters(reset) {
  const f = G.filt, words = f.q.toLowerCase().split(/\s+/).filter(Boolean), d = G.def;
  G.view = G.rows.filter(r => {
    for (const w of words) if (!r[d.search].includes(w)) return false;
    for (const [k, v] of Object.entries(f.sel)) { const fd = d.filters.find(x => x.k === k); const val = fd.get ? fd.get(r) : r[k]; if (Array.isArray(val) ? !val.includes(v) : (val || (k === "nation" ? "Not recorded yet" : "")) !== v) return false; }
    for (const t of d.toggles) if (f.tog.has(t.k) && !t.test(r)) return false; return true; });
  sortView(); renderGrid(reset); $("#gridEmpty").hidden = G.view.length > 0; $("#gridLoading").hidden = true; updateStatus();
}
function sortView() {
  const s = G.sort; if (!s) return; const c = colDef(s.k); if (!c) return;
  const key = r => s.k === "priority" ? (prioRank[r.priority] ?? 9) : c.num ? +gval(r, c) : String(gval(r, c)).toLowerCase();
  G.view.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * s.dir || String(a.name || a.id).localeCompare(String(b.name || b.id)); });
}
function updateStatus() { $("#dvSub").textContent = `${fmt(G.view.length)} of ${fmt(G.rows.length)} ${G.def.noun}s`; $("#statusline").innerHTML = ""; $("#statusline").append(el("span", {}, `${fmt(G.view.length)} shown`), el("span", {}, "Status, stars and notes are saved in this browser only")); }
function renderHead() {
  const h = $("#gridHead"); h.innerHTML = ""; h.style.width = "";
  const all = el("input", { type: "checkbox", title: "Select all shown", onchange: e => { if (e.target.checked) G.view.forEach(r => G.sel.add(r[G.def.idKey])); else G.sel.clear(); renderRows(); updateSelBar(); } });
  h.append(el("div", { class: "gh", style: "width:42px;padding:9px 0;display:grid;place-items:center" }, all), el("div", { class: "gh", style: "width:36px" }, "★"));
  visCols().forEach(c => { const th = el("div", { class: "gh" + (G.sort?.k === c.k ? " sorted" : ""), style: `width:${colW(c)}px`, title: "Click to sort", onclick: () => {
      G.sort = G.sort?.k === c.k ? { k: c.k, dir: -G.sort.dir } : { k: c.k, dir: 1 }; sortView(); renderGrid(false); } }, c.label + (G.sort?.k === c.k ? (G.sort.dir > 0 ? " ↑" : " ↓") : ""));
    const rs = el("span", { class: "rs", onclick: e => e.stopPropagation(), onmousedown: e => { e.preventDefault(); e.stopPropagation(); const x0 = e.clientX, w0 = colW(c);
      const mv = ev => { G.widths[c.k] = Math.max(60, w0 + ev.clientX - x0); th.style.width = G.widths[c.k] + "px"; }; const up = () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); store.set("univ.widths." + G.key, G.widths); renderRows(); $("#gridSpacer").style.width = totalW() + "px"; };
      addEventListener("mousemove", mv); addEventListener("mouseup", up); } }); th.append(rs); h.append(th); });
}
function renderGrid(resetScroll) { renderHead(); const body = $("#gridBody"); if (resetScroll) body.scrollTop = 0; $("#gridSpacer").style.cssText = `height:${G.view.length * ROW_H}px;width:${totalW()}px`; renderRows(); updateSelBar(); }
$("#gridBody").addEventListener("scroll", () => { $("#gridHead").scrollLeft = $("#gridBody").scrollLeft; renderRows(); });
function renderRows() {
  if (!G.def) return; const body = $("#gridBody"), rows = $("#gridRows"); const top = body.scrollTop, h = body.clientHeight || 600;
  const a = Math.max(0, Math.floor(top / ROW_H) - 4), b = Math.min(G.view.length, Math.ceil((top + h) / ROW_H) + 4); const cols = visCols(), idk = G.def.idKey; rows.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i = a; i < b; i++) { const r = G.view[i], id = r[idk];
    const row = el("div", { class: "gr" + (G.sel.has(id) ? " sel" : "") + (G.open === id ? " open" : ""), style: `top:${i * ROW_H}px;width:${totalW()}px`, onclick: () => { G.def.drawer(r); } },
      el("div", { class: "gc chk", onclick: e => e.stopPropagation() }, el("input", { type: "checkbox", checked: G.sel.has(id), onchange: e => { e.target.checked ? G.sel.add(id) : G.sel.delete(id); row.classList.toggle("sel", e.target.checked); updateSelBar(); } })),
      el("div", { class: "gc", style: "width:36px;padding:0 8px", onclick: e => e.stopPropagation() }, el("button", { class: "star" + (ACT[id]?.st ? " on" : ""), title: "Star", onclick: e => { setAct([id], { st: !ACT[id]?.st }); e.target.classList.toggle("on"); } }, "★")),
      cols.map(c => { const v = c.cell ? c.cell(r) : gval(r, c); return el("div", { class: "gc" + (c.mono ? " mono" : ""), style: `width:${colW(c)}px`, title: typeof v === "string" ? v : "" }, v?.nodeType ? v : String(v)); }));
    frag.append(row); }
  rows.append(frag); rows.style.width = totalW() + "px";
}
new ResizeObserver(() => renderRows()).observe($("#gridBody"));

/* selection bar */
const selRows = () => { const idk = G.def.idKey; return G.rows.filter(r => G.sel.has(r[idk])); };
function selEmails(list) { return G.key === "inst" ? emailsOf(list.flatMap(i => (D.conByInst.get(i.id) || []).map(c => c.email))) : emailsOf(list.map(c => c.email)); }
function updateSelBar() {
  const n = G.sel.size, bar = $("#selbar"); bar.hidden = !n; if (!n) return; $("#selCount").textContent = `${fmt(n)} selected`;
  const acts = $("#selActions"); acts.innerHTML = "";
  acts.append(el("button", { class: "btn small", onclick: () => { const e = selEmails(selRows()); if (!e.length) return toast("No emails in the selection"); navigator.clipboard.writeText(e.join("; ")).then(() => toast(`Copied ${fmt(e.length)} unique emails`), () => toast("Copy blocked by the browser")); } }, "Copy emails"),
    el("button", { class: "btn small", onclick: () => setAct([...G.sel], { st: true }) && renderRows() }, "Star"),
    el("button", { class: "btn small", onclick: () => bulkModal("Set status", "Status", G.def.statuses, v => setAct([...G.sel], { s: v })) }, "Set status…"),
    el("button", { class: "btn small", onclick: () => noteModal() }, "Add note…"),
    el("button", { class: "btn small", onclick: () => openExport("selected") }, "Export selected"));
}
$("#selClear").onclick = () => { G.sel.clear(); renderRows(); updateSelBar(); $("#gridHead input[type=checkbox]") && ($("#gridHead input[type=checkbox]").checked = false); };

/* local actions (status / star / owner / note), stored in this browser */
function setAct(ids, patch) { ids.forEach(id => { ACT[id] = { ...(ACT[id] || {}), ...patch }; if (!ACT[id].s && !ACT[id].st && !ACT[id].o && !ACT[id].n) delete ACT[id]; }); saveActs(); if (G.def) { renderRows(); updateSelBar(); if (G.filt.sel.statusEff) applyFilters(false); } return true; }
function bulkModal(title, label, options, cb) {
  const s = el("select", { style: "width:100%" }, options.map(o => el("option", { value: o }, o)));
  openModal(el("div", { class: "mbox", style: "max-width:420px" }, el("h2", {}, title), el("label", { class: "field" }, el("span", {}, label), s),
    el("div", { class: "mfoot" }, el("button", { class: "btn", onclick: closeModal }, "Cancel"), el("button", { class: "btn primary", onclick: () => { cb(s.value); closeModal(); toast("Saved in this browser"); } }, "Apply"))));
}
function noteModal() {
  const t = el("textarea", { placeholder: "Note added to every selected record" });
  openModal(el("div", { class: "mbox", style: "max-width:460px" }, el("h2", {}, "Add note"), el("label", { class: "field" }, el("span", {}, "Appended to each selected record's note"), t),
    el("div", { class: "mfoot" }, el("button", { class: "btn", onclick: closeModal }, "Cancel"), el("button", { class: "btn primary", onclick: () => { if (!t.value.trim()) return; [...G.sel].forEach(id => setAct([id], { n: (ACT[id]?.n ? ACT[id].n + "\n" : "") + `[${today()}] ${t.value.trim()}` })); closeModal(); toast("Note added"); } }, "Add"))));
}

/* columns + export */
$("#colsBtn").onclick = () => {
  const boxes = G.def.cols.map(c => el("label", {}, el("input", { type: "checkbox", checked: G.cols.includes(c.k), "data-k": c.k }), c.label));
  openModal(el("div", { class: "mbox" }, el("h2", {}, "Columns"), el("p", { class: "sub" }, "Choose what the table shows. Drag column edges to resize."), el("div", { class: "colgrid" }, boxes),
    el("div", { class: "mfoot" }, el("button", { class: "btn", onclick: () => { G.cols = G.def.defaults.slice(); store.set("univ.cols." + G.key, G.cols); closeModal(); renderGrid(false); } }, "Reset"),
      el("button", { class: "btn primary", onclick: () => { const on = new Set([...document.querySelectorAll("#modal [data-k]")].filter(b => b.checked).map(b => b.dataset.k)); G.cols = G.def.cols.map(c => c.k).filter(k => on.has(k)); store.set("univ.cols." + G.key, G.cols); closeModal(); renderGrid(false); } }, "Apply"))));
};
$("#exportBtn").onclick = () => openExport(G.sel.size ? "selected" : "view");
function openExport(initScope) {
  let scope = initScope, cols = "visible";
  const mbox = el("div", { class: "mbox", style: "max-width:520px" }); const host = el("div");
  const scopes = () => [["view", "Rows shown now", G.view.length], ["selected", "Selected rows", G.sel.size], ["all", `All ${G.def.noun}s`, G.rows.length]];
  const render = () => { host.innerHTML = "";
    host.append(el("div", { class: "msec" }, el("h4", {}, "Rows"), el("div", { class: "radios" }, scopes().map(([k, l, n]) => el("div", { class: "radio" + (scope === k ? " on" : ""), "aria-disabled": n ? "false" : "true", onclick: () => { if (n) { scope = k; render(); } } }, l, el("span", { class: "n" }, fmt(n)))))),
      el("div", { class: "msec" }, el("h4", {}, "Columns"), el("div", { class: "radios" }, [["visible", "Columns shown now"], ["all", "Every field (includes notes, evidence, sources)"]].map(([k, l]) => el("div", { class: "radio" + (cols === k ? " on" : ""), onclick: () => { cols = k; render(); } }, l)))),
      el("p", { class: "dim", style: "font-size:12px" }, "Local status, star, owner and note are always included."));
  };
  render();
  mbox.append(el("h2", {}, "Export CSV"), el("p", { class: "sub" }, "Opens cleanly in Excel and Google Sheets."), host,
    el("div", { class: "mfoot" }, el("button", { class: "btn", onclick: closeModal }, "Cancel"), el("button", { class: "btn primary", onclick: () => {
      const rows = scope === "all" ? G.rows : scope === "selected" ? selRows() : G.view; if (!rows.length) return toast("Nothing to export");
      const cs = cols === "all" ? G.def.cols : visCols(); const idk = G.def.idKey;
      const head = [...cs.map(c => c.label), "Local status", "Starred", "Owner", "Local note"];
      const lines = [head, ...rows.map(r => [...cs.map(c => { const v = gval(r, c); return Array.isArray(v) ? v.join(" ; ") : v; }), ACT[r[idk]]?.s || "", ACT[r[idk]]?.st ? "yes" : "", ACT[r[idk]]?.o || "", ACT[r[idk]]?.n || ""])];
      download(`universities-atlas-${G.key === "inst" ? "institutions" : "contacts"}-${today()}.csv`, lines.map(l => l.map(csvCell).join(",")).join("\r\n")); closeModal(); toast(`Exported ${fmt(rows.length)} rows`); } }, "Download")));
  openModal(mbox);
}
function download(name, text) { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" })), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

/* ---------- drawers ---------- */
function openModal(node) { const m = $("#modal"); m.innerHTML = ""; m.append(node); m.hidden = false; m.onclick = e => { if (e.target === m) closeModal(); }; }
function closeModal() { $("#modal").hidden = true; $("#modal").innerHTML = ""; }
let toastT; function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#modal").hidden) closeModal(); else closeDrawer(); } });
function closeDrawer() { const d = $("#drawer"); if (d && !d.hidden) { d.hidden = true; G.open = null; if (G.def && !$("#dataView").hidden) { renderRows(); const p = G.key === "inst" ? "#/institutions" : "#/contacts"; if (/^#\/[ic]\//.test(location.hash)) history.replaceState(null, "", p); } } }
const dl = pairs => el("dl", {}, pairs.filter(([, v]) => v !== "" && v != null && !(Array.isArray(v) && !v.length)).map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]));
const tag = (t, cls = "") => el("span", { class: "tag " + cls }, t);
function actionsBox(id, statuses, base) {
  const a = ACT[id] || {};
  const sel = el("select", { onchange: e => { setAct([id], { s: e.target.value === base ? "" : e.target.value }); } }, statuses.concat(statuses.includes(base) ? [] : [base]).map(s => el("option", { value: s, selected: (a.s || base) === s }, s)));
  const owner = el("input", { type: "text", value: a.o || "", placeholder: "Owner", onchange: e => setAct([id], { o: e.target.value.trim() }) });
  const note = el("textarea", { placeholder: "Notes (saved in this browser)", onchange: e => setAct([id], { n: e.target.value }) }, a.n || "");
  const star = el("button", { class: "btn small", onclick: e => { const on = !ACT[id]?.st; setAct([id], { st: on }); e.target.textContent = on ? "★ Starred" : "☆ Star"; } }, a.st ? "★ Starred" : "☆ Star");
  return el("div", {}, el("h3", {}, "Your tracking (this browser only)"), el("div", { class: "mrow" }, el("label", { class: "field", style: "flex:1" }, el("span", {}, "Status"), sel), el("label", { class: "field", style: "flex:1" }, el("span", {}, "Owner"), owner), star), el("label", { class: "field" }, el("span", {}, "Note"), note));
}
const placeOpen = d => { const dr = $("#drawer"); dr.innerHTML = ""; dr.append(d); dr.hidden = false; dr.scrollTop = 0; };
function openInstDrawer(r) {
  G.open = r.id; if (G.def && !$("#dataView").hidden) { renderRows(); if (G.key === "inst") history.replaceState(null, "", "#/i/" + r.id); }
  const cons = D.conByInst.get(r.id) || [];
  const covBox = el("div", { class: "dim" }, "Loading role coverage…");
  const web = r.web && safeUrl(r.web);
  const acts = [web && el("a", { class: "btn small", href: web, target: "_blank", rel: "noopener noreferrer" }, "Website"), r.intlUrl && safeUrl(r.intlUrl) && el("a", { class: "btn small", href: safeUrl(r.intlUrl), target: "_blank", rel: "noopener noreferrer" }, "International team"),
    r.partUrl && safeUrl(r.partUrl) && el("a", { class: "btn small", href: safeUrl(r.partUrl), target: "_blank", rel: "noopener noreferrer" }, "Partnerships"),
    r.hasPos && el("a", { class: "btn small", href: "#/map?focus=" + r.id }, "Show on map"), r.hasPos && el("a", { class: "btn small", target: "_blank", rel: "noopener noreferrer", href: `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}` }, "Directions"),
    cons.some(c => firstEmail(c.email)) && el("button", { class: "btn small", onclick: () => { const e = emailsOf(cons.map(c => c.email)); navigator.clipboard.writeText(e.join("; ")).then(() => toast(`Copied ${e.length} emails`), () => toast("Copy blocked")); } }, "Copy emails")].filter(Boolean);
  const d = el("div", {}, el("button", { class: "btn ghost x", onclick: closeDrawer, "aria-label": "Close" }, "✕"), el("h2", {}, r.name),
    el("div", { class: "tags" }, tag(r.priority + " priority", r.priority === "High" ? "ok" : ""), tag(r.typeCat), r.nation && tag(r.nation), r.city && tag(r.city), tag(r.stage || "Prospect"), r.reconstructed && tag("reconstructed profile: verify before outreach", "warn")),
    el("div", { class: "qa" }, acts),
    dl([["Fit", r.fit], ["Student / market context", r.context], ["Notes", r.notes], ["Type as published", r.type], ["Completeness", r.completeNote || r.complete], ["Priority note", r.priorityNote], ["Last checked", r.checked],
      ["Map location", r.prec === "campus" ? "Campus match (OpenStreetMap)" : r.prec === "name" ? "Matched by name only (no city recorded yet): approximate" : r.prec === "town" ? "Town centre only" : "Not placed yet"]]),
    el("h3", {}, "Role-family coverage"), covBox,
    el("h3", {}, `Contacts (${cons.length})`), el("div", { class: "cons" }, cons.length ? cons.map(conCard) : el("div", { class: "dim" }, "No contacts recorded yet.")),
    r.sources.length ? [el("h3", {}, `Sources (${r.sources.length})`), el("ul", { class: "srcs" }, r.sources.map(u => el("li", {}, link(u, u.replace(/^https?:\/\/(www\.)?/, "")))))] : "",
    actionsBox(r.id, INST_STATUSES, r.stage || "Prospect"));
  placeOpen(d);
  ensureCov().then(() => { if (G.open !== r.id && $("#drawer").hidden) return; const mine = D.cov.filter(c => c.inst === r.id).sort((a, b) => a.fam - b.fam);
    covBox.replaceChildren(...(mine.length ? mine.map(c => el("details", { class: "cov" }, el("summary", {}, el("span", { class: "cb", style: `--c:${BUCKET_COLOR[c.bucket]}` }), el("b", {}, D.families[c.fam] || "Other"), el("em", {}, c.bucket)),
      el("div", { class: "cov-b" }, el("div", {}, c.status), c.notes ? el("p", {}, c.notes) : "", c.contacts ? el("div", { class: "dim" }, "Contacts: " + c.contacts) : ""))) : [el("div", { class: "dim" }, "No coverage checks recorded.")])); }).catch(() => covBox.textContent = "Could not load coverage.");
}
function conCard(c) {
  const e = firstEmail(c.email);
  return el("div", { class: "con" }, el("div", { class: "con1" }, el("b", {}, c.name || "(team route)"), el("span", { class: "dim" }, c.routeCat)), el("div", { class: "con2" }, c.title), c.famText && el("div", { class: "con3" }, c.famText),
    c.regions && el("div", { class: "dim" }, "Regions: " + c.regions),
    el("div", { class: "uk-acts" }, e && el("a", { class: "btn small", href: "mailto:" + e }, c.email), c.phone && el("a", { class: "btn small", href: "tel:" + c.phone.replace(/[^+\d]/g, "") }, c.phone), c.source && safeUrl(c.source) && el("a", { class: "btn small", target: "_blank", rel: "noopener noreferrer", href: safeUrl(c.source) }, "Source ↗"),
      el("a", { class: "btn small", href: "#/c/" + c.id, onclick: ev => { ev.preventDefault(); openConDrawer(c); } }, "Details")));
}
function openConDrawer(c) {
  G.open = c.id; if (G.def && !$("#dataView").hidden) { renderRows(); if (G.key === "con") history.replaceState(null, "", "#/c/" + c.id); }
  const i = D.instById.get(c.inst), e = firstEmail(c.email);
  placeOpen(el("div", {}, el("button", { class: "btn ghost x", onclick: closeDrawer, "aria-label": "Close" }, "✕"), el("h2", {}, c.name || "(team route)"), el("div", { class: "dim" }, c.title),
    el("div", { class: "tags" }, tag(c.routeCat), ...c.fam.map(f => tag(D.families[f])), c.status && tag(c.status)),
    el("div", { class: "qa" }, e && el("a", { class: "btn small", href: "mailto:" + e }, "Email"), c.phone && el("a", { class: "btn small", href: "tel:" + c.phone.replace(/[^+\d]/g, "") }, c.phone), c.source && safeUrl(c.source) && el("a", { class: "btn small", target: "_blank", rel: "noopener noreferrer", href: safeUrl(c.source) }, "Source page ↗"),
      i && el("a", { class: "btn small", href: "#/i/" + i.id, onclick: ev => { ev.preventDefault(); openInstDrawer(i); } }, "Institution")),
    dl([["Institution", i ? i.name : c.inst], ["Email", c.email], ["Phone", c.phone], ["Team / department", c.team], ["Regions covered", c.regions], ["Role category", c.role], ["Route type", c.route], ["Agent onboarding evidence", c.evidence], ["Notes", c.notes], ["Source checked", c.checked], ["Last contacted", c.last], ["Next follow-up", c.next], ["ID", c.id]]),
    actionsBox(c.id, CON_STATUSES, c.status || "Not contacted")));
}

/* ---------- shared with map.js ---------- */
window.__atlas = { el, fmt, csvCell, safeUrl, toast, firstEmail, emailsOf, download, today, PRIO_COLOR, data: D, openInst: id => { const r = D.instById.get(id); if (r) openInstDrawer(r); }, act: id => ACT[id] };
})();
