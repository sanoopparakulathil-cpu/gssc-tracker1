/**
 * GSSC AMC / GMC Tracker — sync server + Claude agent
 * Gulf Safety & Security Co. Ltd.
 *
 * This little script is what lets your phone and your laptop share one list.
 * It keeps gssc-tracker-data.json plus a folder called GSSC Tracker Reports,
 * holding your uploaded service reports and site photos, in your own Drive.
 * Nobody else can see it. Setup takes about three minutes — see SYNC-SETUP.txt.
 *
 * STEP 1 of the setup: change the line below to your own long secret key.
 *        Use letters and numbers, at least 20 characters, no spaces.
 */
var KEY = "CHANGE-THIS-TO-A-LONG-SECRET-abc123xyz789";

/**
 * STEP 2 (only if you want the Claude agent): paste your Anthropic API key
 *        between the quotes below. It starts with sk-ant- and is very long.
 *
 *        This is the ONLY place the key should ever be written. It stays inside
 *        your own Google account. Never put it in index.html and never upload it
 *        to GitHub — that page is public and the key would be stolen and spent.
 *
 *        Leave it as it is if you are not using the agent yet. Everything else
 *        keeps working.
 */
var CLAUDE_KEY = "";
var CLAUDE_MODEL = "claude-sonnet-5";

/* Bump this whenever you paste in a new copy of the script. The app can read it
   back, so you can tell at a glance whether your deployment is up to date. */
var SCRIPT_VERSION = "2026-10-24-forms";

var FILE_NAME = "gssc-tracker-data.json";


function getFile_() {
  var it = DriveApp.getFilesByName(FILE_NAME);
  while (it.hasNext()) {
    var f = it.next();
    if (!f.isTrashed()) return f;
  }
  return DriveApp.createFile(FILE_NAME, JSON.stringify({ updatedAt: 0, data: null }), MimeType.PLAIN_TEXT);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

/* the app reads the shared list */
function doGet(e) {
  try {
    if (String((e && e.parameter && e.parameter.key) || "") !== KEY) {
      return json_({ ok: false, error: "wrong key" });
    }
    var txt = getFile_().getBlob().getDataAsString() || "{}";
    var o;
    try { o = JSON.parse(txt); } catch (err) { o = { updatedAt: 0, data: null }; }
    return json_({ ok: true, updatedAt: o.updatedAt || 0, data: o.data || null });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/* the app uploads a service report or a site photo */
function saveFile_(body) {
  var folders = DriveApp.getFoldersByName("GSSC Tracker Reports");
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder("GSSC Tracker Reports");
  var bytes = Utilities.base64Decode(body.data);
  var blob = Utilities.newBlob(bytes, body.mime || "application/octet-stream", body.name || "report");
  var f = folder.createFile(blob);
  return json_({ ok: true, id: f.getId(), url: f.getUrl() });
}



/* ---------------------------------------------------------------
   The Claude agent. The app never holds the API key — it asks this
   script, and this script talks to Anthropic.
   --------------------------------------------------------------- */

function claudeCall_(messages, system, maxTokens) {
  if (!CLAUDE_KEY) {
    return { ok: false, error: "No Claude key set. Open this script and paste your key into CLAUDE_KEY near the top." };
  }
  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens || 1200,
    messages: messages
  };
  if (system) payload.system = system;

  var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": CLAUDE_KEY,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var txt = res.getContentText();
  if (code !== 200) {
    var msg = "Claude refused the request (" + code + ").";
    if (code === 401) msg = "The Claude key is wrong or has been deleted. Check CLAUDE_KEY in this script.";
    if (code === 400 && txt.indexOf("credit") > -1) msg = "Your Anthropic balance has run out. Top it up at platform.claude.com.";
    if (code === 429) msg = "Too many requests at once. Wait a moment and try again.";
    if (code === 529) msg = "Claude is busy right now. Try again in a minute.";
    return { ok: false, error: msg, detail: txt.slice(0, 300) };
  }

  var out;
  try { out = JSON.parse(txt); } catch (err) { return { ok: false, error: "Could not read Claude's reply." }; }
  var text = "";
  (out.content || []).forEach(function (b) { if (b.type === "text") text += b.text; });
  return {
    ok: true,
    text: text,
    usage: out.usage || null
  };
}

/* the app asks a question about a site, sending its own records along */
function claudeAsk_(body) {
  var system = "You are a assistant for a fire-safety maintenance supervisor at Gulf Safety and Security Co. Ltd "
    + "in Saudi Arabia. You are given his own AMC, GMC, on-call and duty records as JSON. "
    + "Answer only from those records. If the records do not contain the answer, say so plainly - "
    + "do not guess and do not invent site names, dates or SR numbers. "
    + "Keep answers short and direct. Dates in the records are YYYY-MM-DD; write them back as DD-Mon-YYYY.";
  var msg = "Here are my records:\n\n" + (body.context || "{}")
    + "\n\nMy question: " + (body.question || "");
  return json_(claudeCall_([{ role: "user", content: msg }], system, 1000));
}

/* the app sends a photo of a service report to be read */
function claudeRead_(body) {
  var system = "You read photographs of fire-safety service reports and job sheets. "
    + "The photo may be angled, shadowed or partly blurred - read whatever you can. "
    + "Partial readings are useful: fill in every field you can make out, even if others are unreadable. "
    + "Reply with ONE JSON object and nothing else - no explanation, no markdown fences. "
    + "Use these keys: seen, srNo, jccNo, jccDate, date, site, amcNo, gmcNo, system, technicians, status, remarks. "
    + "seen is a short plain-English description of what the picture actually shows - for example "
    + "'a printed GSSC service report, clear' or 'a dark blurred photo, no text legible' or "
    + "'a screenshot of a phone app'. Always fill in seen, even when every other field is blank. "
    + "srNo is the service report number, often written SR No or SF/ followed by digits. "
    + "jccNo is the Job Completion Certificate number, often written JCC No, JCC, or Job Completion Certificate. "
    + "jccDate is the date on that certificate, if a separate one is shown. "
    + "amcNo is a five digit contract number such as 70099 or 60134. "
    + "gmcNo is a job number usually written with a leading P, such as P80098. "
    + "date is the date the service was carried out. All dates must be YYYY-MM-DD. "
    + "technicians must be an array of names. "
    + "status must be one of: Completed, Ongoing, On Hold, Open. "
    + "Use an empty string for anything you cannot read clearly. Never guess a number you cannot see.";
  var content = [
    { type: "image", source: { type: "base64", media_type: body.mime || "image/jpeg", data: body.data } },
    { type: "text", text: "Read this service report and return the JSON object. Fill in every field you can make out." }
  ];
  var kb = Math.round(String(body.data || "").length / 1365);
  var r = claudeCall_([{ role: "user", content: content }], system, 800);
  if (!r.ok) { r.sentKb = kb; return json_(r); }
  var clean = String(r.text || "").replace(/```json/g, "").replace(/```/g, "").trim();
  var fields = null;
  try { fields = JSON.parse(clean); } catch (err) {
    return json_({ ok: false, error: "Claude replied with something that was not a set of fields.",
      raw: clean.slice(0, 300), sentKb: kb, mime: body.mime || "" });
  }
  return json_({ ok: true, fields: fields, usage: r.usage, sentKb: kb,
    mime: body.mime || "", raw: clean.slice(0, 300) });
}

/* diagnostic: ask Claude to say what it can actually see in the picture */
function claudeLook_(body) {
  var content = [
    { type: "image", source: { type: "base64", media_type: body.mime || "image/jpeg", data: body.data } },
    { type: "text", text: "Describe what you see in this image in two or three sentences. "
      + "Is it a document? Is any text legible? If you can read any text at all, quote a few words of it." }
  ];
  var r = claudeCall_([{ role: "user", content: content }], "", 400);
  r.sentKb = Math.round(String(body.data || "").length / 1365);
  return json_(r);
}


/* ===============================================================
   TECHNICIAN ACCESS
   Technicians never get the secret KEY. They log in with their name
   and a PIN that only you set. The script gives them four things only:
   see their own jobs, start / complete a job (JCC number compulsory),
   take out / return a tool, and see who holds each tool.
   Their updates go in a separate file (gssc-tech-data.json), so they can
   never overwrite your AMC / GMC lists.
   =============================================================== */
var TECH_FILE = "gssc-tech-data.json";
var DEFAULT_TOOLS = ["Smoke Test Kit"];
var MAX_FAILS = 5;
var LOCK_MIN = 15;
var TZ = "Asia/Riyadh";

function newId_() { return Utilities.getUuid().replace(/-/g, "").slice(0, 8); }

function techLoad_() {
  var it = DriveApp.getFilesByName(TECH_FILE), f = null;
  while (it.hasNext()) { var c = it.next(); if (!c.isTrashed()) { f = c; break; } }
  var d = null;
  if (f) { try { d = JSON.parse(f.getBlob().getDataAsString() || "{}"); } catch (err) { d = null; } }
  if (!d || typeof d !== "object") d = {};
  if (!d.pins) d.pins = {};
  if (!d.events) d.events = [];
  if (!d.tpls) d.tpls = [];
  if (!d.forms) d.forms = [];
  if (!d.sites) d.sites = {};
  if (!d.sd) d.sd = {};
  if (!d.mrls) d.mrls = [];
  if (!d.photos) d.photos = {};
  if (!d.tools || !d.tools.length) {
    d.tools = DEFAULT_TOOLS.map(function (n) { return { id: newId_(), name: n }; });
  }
  if (!f) f = DriveApp.createFile(TECH_FILE, JSON.stringify(d), MimeType.PLAIN_TEXT);
  return { f: f, d: d };
}

function techSave_(h) {
  var cut = Date.now() - 120 * 864e5;
  h.d.events = h.d.events.filter(function (e) { return e.ts >= cut; });
  if (h.d.events.length > 4000) h.d.events = h.d.events.slice(-4000);
  if (h.d.forms.length > 3000) h.d.forms = h.d.forms.slice(-3000);
  if (h.d.mrls.length > 2000) h.d.mrls = h.d.mrls.slice(-2000);
  var pk = Object.keys(h.d.photos);
  if (pk.length > 6000) pk.slice(0, pk.length - 6000).forEach(function (k) { delete h.d.photos[k]; });
  h.f.setContent(JSON.stringify(h.d));
}

function mainData_() {
  try {
    var o = JSON.parse(getFile_().getBlob().getDataAsString() || "{}");
    return o.data || {};
  } catch (err) { return {}; }
}

function dayStr_(offset) {
  return Utilities.formatDate(new Date(Date.now() + (offset || 0) * 864e5), TZ, "yyyy-MM-dd");
}

function hashPin_(salt, pin) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + pin);
  return raw.map(function (b) { return ("0" + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join("");
}

function findTech_(main, name) {
  var n = String(name || "").trim().toLowerCase();
  if (!n) return null;
  var list = main.techs || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].active !== false && String(list[i].name || "").trim().toLowerCase() === n) return list[i];
  }
  return null;
}

/* returns {tech} when name + PIN are right, otherwise {error} */
function techAuth_(body, h, main) {
  var tech = findTech_(main, body.tech);
  if (!tech) return { error: "Name not found. Ask your supervisor." };
  var cache = CacheService.getScriptCache();
  var fk = "tf_" + tech.id;
  var n = Number(cache.get(fk) || 0);
  if (n >= MAX_FAILS) return { error: "Too many wrong PINs. Try again in " + LOCK_MIN + " minutes." };
  var p = h.d.pins[tech.id];
  if (!p) return { error: "No PIN set for you yet. Ask your supervisor." };
  if (hashPin_(p.salt, String(body.pin || "")) !== p.hash) {
    cache.put(fk, String(n + 1), LOCK_MIN * 60);
    return { error: "Wrong PIN. " + (MAX_FAILS - n - 1) + " tries left." };
  }
  cache.remove(fk);
  return { tech: tech };
}

/* who holds each tool right now, worked out from the event log */
function toolState_(d) {
  var held = {};
  d.events.forEach(function (e) {
    if (e.kind !== "tool") return;
    if (e.act === "out") held[e.toolId] = { techId: e.techId, tech: e.tech, since: e.ts, site: e.site || "" };
    else if (e.act === "return") delete held[e.toolId];
  });
  return d.tools.map(function (t) {
    var h = held[t.id];
    return { id: t.id, name: t.name, holder: h ? h.tech : "", holderId: h ? h.techId : "",
             since: h ? h.since : 0, site: h ? h.site : "" };
  });
}

/* latest job event for each duty */
function jobStatus_(d) {
  var m = {};
  d.events.forEach(function (e) {
    if (e.kind !== "job" || !e.dutyId) return;
    var k = e.dutyId + "|" + e.techId;
    var cur = m[k] || { status: "Pending", jcc: "", sr: "", started: 0, done: 0 };
    if (e.act === "start") { if (cur.status === "Pending") cur.status = "In Progress"; cur.started = e.ts; }
    if (e.act === "complete") { cur.status = "Completed"; cur.jcc = e.jcc || ""; cur.sr = e.sr || ""; cur.done = e.ts; }
    m[k] = cur;
  });
  return m;
}

function scopeItems_(txt) {
  return String(txt || "").split(/\r?\n|;/).map(function (x) { return x.trim(); })
    .filter(function (x) { return x; }).slice(0, 40);
}

function jobInfo_(main, duty) {
  var out = { info: "", items: [] };
  var ref = String(duty.ref || "");
  var bar = ref.indexOf("|");
  if (bar < 0) return out;
  var kind = ref.slice(0, bar), id = ref.slice(bar + 1), i;
  if (kind === "gmc") {
    var G = main.gmc || [];
    for (i = 0; i < G.length; i++) if (G[i].id === id) {
      out.info = "GMC " + (G[i].gmcNo || "") + " · " + (G[i].client || "") + (G[i].desc ? " — " + G[i].desc : "");
      out.items = scopeItems_(G[i].scope);
    }
  } else if (kind === "amc") {
    var A = main.amc || [];
    for (i = 0; i < A.length; i++) if (A[i].id === id) {
      out.info = "AMC " + (A[i].amcNo || "") + " · " + (A[i].site || "") + (A[i].serviceNo ? " (" + A[i].serviceNo + ")" : "")
        + (A[i].system ? " · " + A[i].system : "");
    }
  } else if (kind === "call") {
    var C = main.oncall || [];
    for (i = 0; i < C.length; i++) if (C[i].id === id) out.info = "CALL · " + (C[i].client || "") + (C[i].issue ? " — " + C[i].issue : "");
  }
  return out;
}

/* where each AMC / GMC row stands: Submitted -> (supervisor) Completed / Balance Work / Returned */
function rowState_(h) {
  var m = {};
  h.d.events.slice().sort(function (a, b) { return a.ts - b.ts; }).forEach(function (e) {
    var k = e.rowKind + "|" + e.rowId;
    if (e.kind === "row") m[k] = { st: "Submitted", sub: e, ver: null };
    else if (e.kind === "verify" && m[k]) {
      m[k].ver = e;
      m[k].st = e.ok ? (m[k].sub.result === "partial" ? "Balance Work" : "Completed") : "Returned";
    }
  });
  return m;
}

function rowFields_(s) {
  if (!s) return { doneDate: "", jcc: "", by: "", remaining: "", note: "", comment: "", at: 0, result: "" };
  return { doneDate: s.sub.doneDate || "", jcc: s.sub.jcc || "", by: s.sub.tech || "", remaining: s.sub.remaining || "",
    note: s.sub.note || "", comment: (s.ver && !s.ver.ok) ? (s.ver.comment || "") : "", at: s.sub.ts, result: s.sub.result || "complete" };
}

/* the full AMC and GMC lists a technician can see and update. No prices or quotation data are ever sent. */
function listsFor_(main, h) {
  var rs = rowState_(h);
  var cur = String(main.curMonth || dayStr_(0).slice(0, 7));
  var amc = [], gmc = [];
  (main.amc || []).forEach(function (a) {
    var s = rs["amc|" + a.id], m = String(a.month || "");
    var fin = a.status === "Completed" || (s && s.st === "Completed");
    if (a.status === "Cancelled") return;
    if (m !== cur && !(m < cur && !fin) && !s) return;
    var f = rowFields_(s);
    amc.push({ id: a.id, month: m, no: a.amcNo || "", site: a.site || "", system: a.system || "", serv: a.serviceNo || "",
      sched: a.schedDate || "", status: a.status === "Completed" ? "Completed" : (s ? s.st : (a.status || "Open")),
      doneDate: s ? f.doneDate : (a.doneDate || ""), jcc: s ? f.jcc : (a.jccNo || ""), by: s ? f.by : (a.doneBy || ""),
      sr: s ? (s.sub.sr || a.srNo || "") : (a.srNo || ""), remaining: f.remaining, note: f.note, comment: f.comment, result: f.result,
      progress: a.progress || "" });
  });
  (main.gmc || []).forEach(function (g) {
    var s = rs["gmc|" + g.id];
    var fin = g.status === "Completed" || (s && s.st === "Completed");
    if (fin && !s) return;   // completed GMC jobs are not shown to technicians
    var f = rowFields_(s);
    gmc.push({ id: g.id, month: String(g.month || ""), no: g.gmcNo || "", client: g.client || g.clientRaw || "", desc: g.desc || "",
      items: scopeItems_(g.scope), sched: g.schedDate || "", status: g.status === "Completed" ? "Completed" : (s ? s.st : (g.status || "Open")),
      doneDate: s ? f.doneDate : (g.doneDate || ""), jcc: s ? f.jcc : (g.jccNo || ""), by: s ? f.by : (g.doneBy || ""),
      remaining: f.remaining, note: f.note, comment: f.comment, result: f.result, progress: g.progress || "" });
  });
  amc.sort(function (a, b) { return a.site < b.site ? -1 : (a.site > b.site ? 1 : 0); });
  gmc.sort(function (a, b) { return a.no < b.no ? 1 : (a.no > b.no ? -1 : 0); });
  return { amc: amc.slice(0, 400), gmc: gmc.slice(0, 400) };
}

/* the duty roster for today and tomorrow, so technicians can see who is where and who is absent */
function teamDuty_(main) {
  var techs = (main.techs || []).filter(function (t) { return t.active !== false; }), name = {};
  techs.forEach(function (t) { name[t.id] = t.name; });
  return [dayStr_(0), dayStr_(1)].map(function (ds) {
    var rows = [], absent = [], busy = {};
    (main.duties || []).forEach(function (d) {
      if (d.date !== ds) return;
      var ids = d.techIds || [], names = ids.map(function (id) { return name[id] || ""; }).filter(function (x) { return x; });
      ids.forEach(function (id) { busy[id] = 1; });
      if (d.activity === "Leave") { absent = absent.concat(names); return; }
      rows.push({ techs: names, site: d.siteText || "", activity: d.activity || "", location: d.location || "" });
    });
    var free = techs.filter(function (t) { return !busy[t.id]; }).map(function (t) { return t.name; });
    return { date: ds, rows: rows, absent: absent, free: free };
  });
}

function techState_(tech, h, main) {
  var from = dayStr_(-3), to = dayStr_(1);
  var st = jobStatus_(h.d);
  var jobs = (main.duties || []).filter(function (x) {
    return x.date >= from && x.date <= to && (x.techIds || []).indexOf(tech.id) > -1;
  }).map(function (x) {
    var s = st[x.id + "|" + tech.id] || { status: "Pending", jcc: "", sr: "" };
    var inf = jobInfo_(main, x);
    return { id: x.id, date: x.date, site: x.siteText || "", activity: x.activity || "", location: x.location || "",
             remarks: x.remarks || "", ref: x.ref || "", info: inf.info, items: inf.items,
             status: s.status, jcc: s.jcc, sr: s.sr };
  }).sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  var mine = h.d.events.filter(function (e) { return e.techId === tech.id && e.ts > Date.now() - 31 * 864e5; })
    .slice(-60).reverse();
  var L = listsFor_(main, h);
  return { ok: true, tech: tech.name, today: dayStr_(0), jobs: jobs, tools: toolState_(h.d), history: mine,
           sites: siteNames_(main), amc: L.amc, gmc: L.gmc, team: teamDuty_(main),
           tpls: h.d.tpls, siteData: h.d.sites,
           forms: h.d.forms.filter(function (f) { return f.techId === tech.id; }).slice(-40).reverse().map(formSum_),
           sdList: sdList_(h), mrls: h.d.mrls.filter(function (f) { return f.techId === tech.id; }).slice(-30).reverse().map(mrlSum_) };
}

/* ---------- checklists filled on the phone ---------- */
function formSum_(f) {
  return { id: f.id, site: f.site, tplId: f.tplId, tplName: f.tplName, date: f.date, svc: f.svc || "", status: f.status,
           tech: f.tech, ts: f.mod, done: f.done || 0, total: f.total || 0 };
}
/* ---------- site system data (filled once per site, kept, updated later) ---------- */
function sdList_(h) {
  var o = {};
  Object.keys(h.d.sd).forEach(function (k) { var r = h.d.sd[k]; o[k] = { mod: r.mod, by: r.by, n: r.n || 0 }; });
  return o;
}
function sdSave_(tech, h, ev) {
  var site = cleanStr_(ev.site, 120).trim();
  if (!site) return { error: "Choose the site." };
  var data = {}, n = 0, keys = Object.keys(ev.data || {});
  if (keys.length > 900) return { error: "Too much data." };
  keys.forEach(function (k) {
    if (!/^[a-z0-9]{2,30}$/.test(k)) return;
    var v = cleanStr_(ev.data[k], 200);
    if (v !== "") { data[k] = v; n++; }
  });
  var prev = h.d.sd[site];
  h.d.sd[site] = { data: data, by: tech.name, byId: tech.id, mod: Date.now(), n: n, first: prev ? prev.first : tech.name };
  techSave_(h);
  return { ok: true };
}
/* ---------- material requirement list after service (with photos) ---------- */
function mrlSum_(f) {
  return { id: f.id, site: f.site, date: f.date, status: f.status, tech: f.tech, ts: f.mod, n: (f.items || []).length };
}
function mrlSave_(tech, h, form, isAdmin) {
  form = form || {};
  var id = cleanStr_(form.id, 40);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return { error: "Bad list id." };
  var site = cleanStr_(form.site, 120).trim();
  if (!site) return { error: "Choose the site." };
  var date = cleanStr_(form.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dayStr_(1)) return { error: "Check the service date." };
  var status = form.status === "final" ? "final" : "draft";
  var hdr = {};
  ["client", "loc", "rep", "amc", "svcno", "sys", "tech", "sup", "sub"].forEach(function (k) { hdr[k] = cleanStr_((form.hdr || {})[k], 120); });
  var items = (form.items || []).slice(0, 60).map(function (it) {
    var ph = (it.ph || []).filter(function (x) { return /^[A-Za-z0-9_-]{10,60}$/.test(String(x)); }).slice(0, 4);
    return { d: cleanStr_(it.d, 300), m: cleanStr_(it.m, 160), u: cleanStr_(it.u, 12), q: cleanStr_(it.q, 12), r: cleanStr_(it.r, 300), ph: ph };
  }).filter(function (it) { return it.d.trim(); });
  if (status === "final") {
    if (!items.length) return { error: "Add at least one item." };
    var noQ = items.filter(function (it) { return !it.q.trim() || !it.u.trim(); }).length;
    if (noQ) return { error: noQ + " item(s) have no quantity or unit." };
  }
  var cur = null, idx = -1;
  h.d.mrls.forEach(function (f, i) { if (f.id === id) { cur = f; idx = i; } });
  if (cur) {
    if (!isAdmin && cur.techId !== tech.id) return { error: "This list belongs to another technician." };
    if (!isAdmin && cur.status === "final") return { error: "Already submitted. Ask your supervisor to reopen it." };
  }
  var rec = { id: id, techId: cur ? cur.techId : tech.id, tech: cur ? cur.tech : tech.name, site: site, date: date, status: status,
              hdr: hdr, items: items, mod: Date.now() };
  if (idx > -1) h.d.mrls[idx] = rec; else h.d.mrls.push(rec);
  techSave_(h);
  return { ok: true, form: rec };
}
function photoFolder_() {
  var it = DriveApp.getFoldersByName("GSSC Tech Photos");
  return it.hasNext() ? it.next() : DriveApp.createFolder("GSSC Tech Photos");
}
function tplItems_(t) {
  var n = 0; (t.sections || []).forEach(function (sc) { n += (sc.items || []).length; }); return n;
}
function cleanStr_(v, n) { return String(v == null ? "" : v).slice(0, n); }
function chkSave_(tech, h, form, isAdmin) {
  form = form || {};
  var id = cleanStr_(form.id, 40);
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return { error: "Bad checklist id." };
  var tpl = null;
  h.d.tpls.forEach(function (t) { if (t.id === form.tplId) tpl = t; });
  if (!tpl) return { error: "That checklist is no longer available. Refresh the app." };
  var site = cleanStr_(form.site, 120).trim();
  if (!site) return { error: "Choose the site." };
  var date = cleanStr_(form.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dayStr_(1)) return { error: "Check the inspection date." };
  var status = form.status === "final" ? "final" : "draft";
  var hdr = {};
  Object.keys(form.hdr || {}).slice(0, 20).forEach(function (k) { hdr[cleanStr_(k, 24)] = cleanStr_(form.hdr[k], 120); });
  var ans = {}, done = 0, total = tplItems_(tpl);
  (tpl.sections || []).forEach(function (sc, si) {
    (sc.items || []).forEach(function (it, ii) {
      var k = si + "_" + ii, a = (form.ans || {})[k];
      if (a && (a.v === "y" || a.v === "n" || a.v === "na" || a.c)) {
        var v = (a.v === "y" || a.v === "n" || a.v === "na") ? a.v : "";
        ans[k] = { v: v, c: cleanStr_(a.c, 600) };
        if (v) done++;
      }
    });
  });
  if (status === "final" && done < total) {
    return { error: "Answer every item (Yes, No or N/A) before submitting. " + (total - done) + " left." };
  }
  var finds = (form.finds || []).slice(0, 30).map(function (r) {
    return { f: cleanStr_(r.f, 300), l: cleanStr_(r.l, 120), p: cleanStr_(r.p, 12), a: cleanStr_(r.a, 300) };
  }).filter(function (r) { return r.f || r.l || r.a; });
  var sign = { tech: cleanStr_((form.sign || {}).tech, 80), client: cleanStr_((form.sign || {}).client, 80) };
  var cur = null, idx = -1;
  h.d.forms.forEach(function (f, i) { if (f.id === id) { cur = f; idx = i; } });
  if (cur) {
    if (!isAdmin && cur.techId !== tech.id) return { error: "This checklist belongs to another technician." };
    if (!isAdmin && cur.status === "final") return { error: "This checklist is already submitted. Ask your supervisor to reopen it." };
  }
  var rec = { id: id, techId: cur ? cur.techId : tech.id, tech: cur ? cur.tech : tech.name, tplId: tpl.id, tplName: tpl.name,
              site: site, date: date, svc: cleanStr_(form.svc, 20), status: status, hdr: hdr, ans: ans, finds: finds, sign: sign,
              done: done, total: total, mod: Date.now(), created: cur ? cur.created : Date.now() };
  if (idx > -1) h.d.forms[idx] = rec; else h.d.forms.push(rec);
  // what a technician writes about the system (panel make, pump model) is kept for the site and prefills next time
  (tpl.hdr || []).forEach(function (hf) {
    if (hf.rem && hdr[hf.k]) {
      if (!h.d.sites[site]) h.d.sites[site] = {};
      h.d.sites[site][hf.k] = hdr[hf.k];
    }
  });
  techSave_(h);
  return { ok: true, form: rec };
}
function tplClean_(t) {
  if (!t || typeof t !== "object") return null;
  var id = /^[A-Za-z0-9_-]{3,40}$/.test(t.id || "") ? t.id : "c" + newId_();
  var secs = [];
  (t.sections || []).slice(0, 40).forEach(function (sc) {
    var items = [];
    (sc.items || []).slice(0, 120).forEach(function (it) {
      var tx = cleanStr_(it.t, 600).trim();
      if (tx) items.push({ n: cleanStr_(it.n, 8), t: tx, ref: cleanStr_(it.ref, 60) });
    });
    if (items.length) secs.push({ t: cleanStr_(sc.t, 200), items: items });
  });
  if (!secs.length) return null;
  var hdr = (t.hdr || []).slice(0, 14).map(function (x) {
    var k = /^[a-z0-9_]{1,24}$/.test(x.k || "") ? x.k : "x_" + newId_();
    var ty = (x.t === "date" || x.t === "svc" || x.t === "auto") ? x.t : "text";
    return { k: k, l: cleanStr_(x.l, 40), t: ty, rem: !!x.rem };
  });
  var sites = (t.sites || []).slice(0, 80).map(function (x) { return cleanStr_(x, 120); }).filter(function (x) { return x; });
  return { id: id, name: cleanStr_(t.name || t.title, 80), short: cleanStr_(t.short || t.name, 16), title: cleanStr_(t.title || t.name, 120),
           sub: (t.sub || []).slice(0, 4).map(function (x) { return cleanStr_(x, 160); }), refCol: cleanStr_(t.refCol || "REFERENCE", 30),
           hdr: hdr, sections: secs, foot: cleanStr_(t.foot, 500), sites: sites, std: !!t.std };
}

function siteNames_(main) {
  var seen = {}, out = [];
  (main.contracts || []).forEach(function (c) {
    var n = String(c.site || "").trim();
    if (n && !seen[n]) { seen[n] = 1; out.push(n); }
  });
  return out.sort().slice(0, 150);
}

function techAct_(body) {
  var h = techLoad_(), main = mainData_();
  var act = body.action;
  if (act === "t_names") {
    return json_({ ok: true, names: (main.techs || []).filter(function (t) { return t.active !== false && h.d.pins[t.id]; })
      .map(function (t) { return t.name; }) });
  }
  var au = techAuth_(body, h, main);
  if (au.error) return json_({ ok: false, error: au.error });
  var tech = au.tech;
  if (act === "t_state") return json_(techState_(tech, h, main));
  if (act === "t_site_get") {
    var sr = h.d.sd[cleanStr_(body.site, 120)];
    return json_({ ok: true, rec: sr || null });
  }
  if (act === "t_site_save") {
    var sv = sdSave_(tech, h, body.ev || {});
    if (sv.error) return json_({ ok: false, error: sv.error });
    return json_(techState_(tech, h, main));
  }
  if (act === "t_mrl_get") {
    var mf = null;
    h.d.mrls.forEach(function (f) { if (f.id === body.id && f.techId === tech.id) mf = f; });
    return mf ? json_({ ok: true, form: mf }) : json_({ ok: false, error: "List not found." });
  }
  if (act === "t_mrl_save") {
    var mr = mrlSave_(tech, h, (body.ev || {}).form, false);
    if (mr.error) return json_({ ok: false, error: mr.error });
    return json_(techState_(tech, h, main));
  }
  if (act === "t_photo") {
    var pid = cleanStr_(body.pid, 40);
    if (!/^[A-Za-z0-9_-]{6,40}$/.test(pid)) return json_({ ok: false, error: "Bad photo id." });
    if (h.d.photos[pid]) return json_({ ok: true, fileId: h.d.photos[pid] });
    var b64 = String(body.data || "").replace(/^data:image\/jpeg;base64,/, "");
    if (!b64 || b64.length > 1800000 || !/^[A-Za-z0-9+\/=]+$/.test(b64)) return json_({ ok: false, error: "Photo too large or invalid." });
    var blob = Utilities.newBlob(Utilities.base64Decode(b64), "image/jpeg", dayStr_(0) + "_" + tech.name + "_" + pid + ".jpg");
    var pf = photoFolder_().createFile(blob);
    h.d.photos[pid] = pf.getId();
    techSave_(h);
    return json_({ ok: true, fileId: pf.getId() });
  }
  if (act === "t_chk_get") {
    var gf = null;
    h.d.forms.forEach(function (f) { if (f.id === body.id && f.techId === tech.id) gf = f; });
    return gf ? json_({ ok: true, form: gf }) : json_({ ok: false, error: "Checklist not found." });
  }
  if (act === "t_chk_save") {
    var cr = chkSave_(tech, h, (body.ev || {}).form, false);
    if (cr.error) return json_({ ok: false, error: cr.error });
    return json_(techState_(tech, h, main));
  }

  var ev = body.ev || {};
  var id = String(ev.id || "");
  if (!id) return json_({ ok: false, error: "no event id" });
  var dup = h.d.events.some(function (e) { return e.id === id; });
  if (dup) return json_(techState_(tech, h, main));

  var rec = { id: id, ts: Date.now(), clientTs: Number(ev.clientTs) || 0, techId: tech.id, tech: tech.name };
  if (act === "t_job") {
    if (ev.act !== "start" && ev.act !== "complete") return json_({ ok: false, error: "bad job action" });
    rec.kind = "job"; rec.act = ev.act;
    rec.dutyId = String(ev.dutyId || ""); rec.ref = String(ev.ref || ""); rec.site = String(ev.site || "").slice(0, 120);
    if (!rec.dutyId) return json_({ ok: false, error: "no job" });
    if (ev.act === "complete") {
      rec.jcc = String(ev.jcc || "").trim().slice(0, 40);
      if (!rec.jcc) return json_({ ok: false, error: "JCC number is compulsory to complete a job." });
      var duty = null;
      (main.duties || []).forEach(function (x) { if (x.id === rec.dutyId) duty = x; });
      var need = duty ? jobInfo_(main, duty).items : [];
      if (need.length && !(ev.items && ev.items.total === need.length && ev.items.done === need.length)) {
        return json_({ ok: false, error: "Tick every scope item. Nothing was marked completed." });
      }
      rec.sr = String(ev.sr || "").trim().slice(0, 40);
      rec.remarks = String(ev.remarks || "").slice(0, 500);
      if (ev.items) rec.items = { done: Number(ev.items.done) || 0, total: Number(ev.items.total) || 0 };
    }
  } else if (act === "t_row") {
    if (ev.rowKind !== "amc" && ev.rowKind !== "gmc") return json_({ ok: false, error: "bad list" });
    var row = null, rows = ev.rowKind === "amc" ? (main.amc || []) : (main.gmc || []);
    rows.forEach(function (x) { if (x.id === ev.rowId) row = x; });
    if (!row) return json_({ ok: false, error: "Job not found. Refresh and try again." });
    var cur = rowState_(h)[ev.rowKind + "|" + row.id];
    if (row.status === "Completed" || (cur && cur.st === "Completed")) return json_({ ok: false, error: "Already completed." });
    if (cur && cur.st === "Submitted") {
      return json_({ ok: false, error: "Already submitted by " + cur.sub.tech + ". Waiting for your supervisor to verify." });
    }
    var dd = String(ev.doneDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dd) || dd > dayStr_(0) || dd < dayStr_(-45)) {
      return json_({ ok: false, error: "Date must be within the last 45 days and not in the future." });
    }
    var result = ev.result === "partial" ? "partial" : "complete";
    var items = ev.rowKind === "gmc" ? scopeItems_(row.scope) : [];
    var jc = String(ev.jcc || "").trim().slice(0, 40);
    var remaining = String(ev.remaining || "").trim().slice(0, 600);
    if (result === "complete") {
      if (!jc) return json_({ ok: false, error: "JCC number is compulsory." });
      if (items.length && !(ev.items && ev.items.total === items.length && ev.items.done === items.length)) {
        return json_({ ok: false, error: "Tick every scope item. Nothing was marked completed." });
      }
    } else if (!remaining) {
      return json_({ ok: false, error: "Write what is remaining." });
    }
    rec.kind = "row"; rec.act = "submit"; rec.result = result; rec.rowKind = ev.rowKind; rec.rowId = row.id;
    rec.site = ev.rowKind === "amc" ? (row.site || "") : (row.client || row.clientRaw || "");
    rec.no = ev.rowKind === "amc" ? (row.amcNo || "") : (row.gmcNo || "");
    rec.doneDate = dd; rec.jcc = jc; rec.sr = String(ev.sr || "").trim().slice(0, 40);
    rec.note = String(ev.remarks || "").slice(0, 600);
    rec.remaining = result === "partial" ? remaining : "";
    if (items.length) {
      var dn = result === "complete" ? items.length : Math.max(0, Math.min(items.length, Number(ev.items && ev.items.done) || 0));
      rec.items = { done: dn, total: items.length };
    }
  } else if (act === "t_tool") {
    if (ev.act !== "out" && ev.act !== "return") return json_({ ok: false, error: "bad tool action" });
    var tools = toolState_(h.d), t = null;
    tools.forEach(function (x) { if (x.id === ev.toolId) t = x; });
    if (!t) return json_({ ok: false, error: "Unknown tool." });
    if (ev.act === "out") {
      if (t.holder && t.holderId !== tech.id) return json_({ ok: false, error: t.name + " is with " + t.holder + " now." });
      if (t.holderId === tech.id) return json_(techState_(tech, h, main));
    } else {
      if (!t.holder) return json_(techState_(tech, h, main));
      if (t.holderId !== tech.id) return json_({ ok: false, error: t.name + " is with " + t.holder + ". Only they or your supervisor can return it." });
    }
    rec.kind = "tool"; rec.act = ev.act; rec.toolId = t.id; rec.tool = t.name;
    rec.site = String(ev.site || "").slice(0, 120);
    rec.cond = ev.act === "return" ? (ev.cond === "Damaged" ? "Damaged" : "OK") : "";
    rec.note = String(ev.note || "").slice(0, 300);
  } else {
    return json_({ ok: false, error: "unknown action" });
  }
  h.d.events.push(rec);
  techSave_(h);
  return json_(techState_(tech, h, main));
}

/* admin side — needs the secret KEY, same as the rest of the app */
function adminAct_(body) {
  var h = techLoad_(), main = mainData_(), act = body.action;
  if (act === "a_events") {
    var cut = Date.now() - 45 * 864e5;
    var evs = h.d.events.filter(function (e) { return e.ts >= cut; });
    return json_({ ok: true, version: SCRIPT_VERSION, now: Date.now(), events: evs, tools: toolState_(h.d),
      pins: (main.techs || []).map(function (t) { return { id: t.id, name: t.name, active: t.active !== false, pinSet: !!h.d.pins[t.id] }; }) });
  }
  if (act === "a_sd_list") {
    var sl = h.d.sd, out = Object.keys(sl).map(function (k) { return { site: k, by: sl[k].by, mod: sl[k].mod, n: sl[k].n || 0 }; });
    return json_({ ok: true, list: out });
  }
  if (act === "a_sd_get") {
    var sg = h.d.sd[cleanStr_(body.site, 120)];
    return sg ? json_({ ok: true, rec: sg }) : json_({ ok: false, error: "No data for this site." });
  }
  if (act === "a_sd_del") {
    delete h.d.sd[cleanStr_(body.site, 120)];
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_mrls") {
    return json_({ ok: true, list: h.d.mrls.slice(-300).reverse().map(mrlSum_) });
  }
  if (act === "a_mrl_get") {
    var am = null;
    h.d.mrls.forEach(function (f) { if (f.id === body.id) am = f; });
    return am ? json_({ ok: true, form: am }) : json_({ ok: false, error: "List not found." });
  }
  if (act === "a_mrl_reopen") {
    var rm = null;
    h.d.mrls.forEach(function (f) { if (f.id === body.id) rm = f; });
    if (!rm) return json_({ ok: false, error: "List not found." });
    rm.status = "draft"; rm.mod = Date.now();
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_mrl_del") {
    h.d.mrls = h.d.mrls.filter(function (f) { return f.id !== body.id; });
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_photo") {
    var fid = String(body.id || "");
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(fid)) return json_({ ok: false, error: "Bad photo id." });
    var known = false;
    Object.keys(h.d.photos).forEach(function (k) { if (h.d.photos[k] === fid) known = true; });
    if (!known) return json_({ ok: false, error: "Unknown photo." });
    try {
      var bl = DriveApp.getFileById(fid).getBlob();
      return json_({ ok: true, data: "data:image/jpeg;base64," + Utilities.base64Encode(bl.getBytes()) });
    } catch (err) { return json_({ ok: false, error: "Photo not found in Drive." }); }
  }
  if (act === "a_tpls") {
    return json_({ ok: true, tpls: h.d.tpls });
  }
  if (act === "a_tpl_save") {
    var tc = tplClean_(body.tpl);
    if (!tc) return json_({ ok: false, error: "The checklist has no items." });
    var ti = -1;
    h.d.tpls.forEach(function (x, i) { if (x.id === tc.id) ti = i; });
    if (ti > -1) h.d.tpls[ti] = tc; else h.d.tpls.push(tc);
    if (h.d.tpls.length > 60) return json_({ ok: false, error: "Too many checklists (60 maximum)." });
    techSave_(h);
    return json_({ ok: true, tpls: h.d.tpls });
  }
  if (act === "a_tpl_del") {
    h.d.tpls = h.d.tpls.filter(function (x) { return x.id !== body.id; });
    techSave_(h);
    return json_({ ok: true, tpls: h.d.tpls });
  }
  if (act === "a_forms") {
    return json_({ ok: true, forms: h.d.forms.slice(-400).reverse().map(formSum_), tpls: h.d.tpls, sites: h.d.sites });
  }
  if (act === "a_form_get") {
    var af = null;
    h.d.forms.forEach(function (f) { if (f.id === body.id) af = f; });
    return af ? json_({ ok: true, form: af }) : json_({ ok: false, error: "Checklist not found." });
  }
  if (act === "a_form_reopen") {
    var rf = null;
    h.d.forms.forEach(function (f) { if (f.id === body.id) rf = f; });
    if (!rf) return json_({ ok: false, error: "Checklist not found." });
    rf.status = "draft"; rf.mod = Date.now();
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_form_del") {
    h.d.forms = h.d.forms.filter(function (f) { return f.id !== body.id; });
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_setpin") {
    var pin = String(body.pin || "");
    if (!/^[0-9]{4,8}$/.test(pin)) return json_({ ok: false, error: "PIN must be 4 to 8 digits." });
    var known = (main.techs || []).some(function (t) { return t.id === body.techId; });
    if (!known) return json_({ ok: false, error: "Technician not found." });
    var salt = newId_() + newId_();
    h.d.pins[body.techId] = { salt: salt, hash: hashPin_(salt, pin) };
    CacheService.getScriptCache().remove("tf_" + body.techId);
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_clearpin") {
    delete h.d.pins[body.techId];
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_tools") {
    var names = (body.names || []).map(function (x) { return String(x).trim(); }).filter(function (x) { return x; });
    if (!names.length) return json_({ ok: false, error: "Keep at least one tool." });
    var state = toolState_(h.d), heldNames = {};
    state.forEach(function (t) { if (t.holder) heldNames[t.name.toLowerCase()] = t.holder; });
    var keep = {};
    var next = names.map(function (n) {
      var ex = null;
      h.d.tools.forEach(function (t) { if (t.name.toLowerCase() === n.toLowerCase()) ex = t; });
      if (ex) { keep[ex.id] = 1; return { id: ex.id, name: n }; }
      return { id: newId_(), name: n };
    });
    var blocked = h.d.tools.filter(function (t) { return !keep[t.id] && heldNames[t.name.toLowerCase()]; });
    if (blocked.length) return json_({ ok: false, error: blocked[0].name + " is still with " + heldNames[blocked[0].name.toLowerCase()] + ". Return it first." });
    h.d.tools = next;
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_verify") {
    var vk = body.rowKind + "|" + body.rowId, vs = rowState_(h)[vk];
    if (!vs || vs.st !== "Submitted") return json_({ ok: false, error: "Nothing waiting to verify for this job." });
    h.d.events.push({ id: "v" + newId_(), ts: Date.now(), clientTs: 0, techId: "admin", tech: "Supervisor", kind: "verify",
      ok: !!body.ok, comment: String(body.comment || "").slice(0, 300), rowKind: body.rowKind, rowId: body.rowId,
      site: vs.sub.site, no: vs.sub.no });
    techSave_(h);
    return json_({ ok: true });
  }
  if (act === "a_return") {
    var tl = toolState_(h.d), tt = null;
    tl.forEach(function (x) { if (x.id === body.toolId) tt = x; });
    if (!tt) return json_({ ok: false, error: "Unknown tool." });
    if (tt.holder) {
      h.d.events.push({ id: "adm" + newId_(), ts: Date.now(), clientTs: 0, techId: "admin", tech: "Supervisor", kind: "tool",
        act: "return", toolId: tt.id, tool: tt.name, site: "", cond: "OK", note: "Returned by supervisor (was with " + tt.holder + ")" });
      techSave_(h);
    }
    return json_({ ok: true });
  }
  return json_({ ok: false, error: "unknown action" });
}

/* the app writes the shared list back */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) {}
    var act0 = String(body.action || "");
    if (act0.indexOf("t_") === 0) {
      return techAct_(body);
    }
    if (String(body.key || "") !== KEY) {
      return json_({ ok: false, error: "wrong key" });
    }
    if (act0.indexOf("a_") === 0) {
      return adminAct_(body);
    }
    if (body.action === "file") {
      return saveFile_(body);
    }
    if (body.action === "ping") {
      return json_({
        ok: true,
        version: SCRIPT_VERSION,
        claudeKeySet: !!CLAUDE_KEY,
        model: CLAUDE_MODEL
      });
    }
    if (body.action === "ask") {
      return claudeAsk_(body);
    }
    if (body.action === "read") {
      return claudeRead_(body);
    }
    if (body.action === "look") {
      return claudeLook_(body);
    }
    if (!body.data) {
      return json_({ ok: false, error: "no data sent" });
    }
    var payload = { updatedAt: Date.now(), data: body.data };
    getFile_().setContent(JSON.stringify(payload));
    return json_({ ok: true, updatedAt: payload.updatedAt });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}
