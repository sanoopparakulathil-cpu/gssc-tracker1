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
var CLAUDE_MODEL = "claude-sonnet-4-6";

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
    + "Reply with ONE JSON object and nothing else - no explanation, no markdown fences. "
    + "Use these keys: srNo, jccNo, jccDate, date, site, amcNo, gmcNo, system, technicians, status, remarks. "
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
    { type: "text", text: "Read this service report and return the JSON object." }
  ];
  var r = claudeCall_([{ role: "user", content: content }], system, 800);
  if (!r.ok) return json_(r);
  var clean = String(r.text || "").replace(/```json/g, "").replace(/```/g, "").trim();
  var fields = null;
  try { fields = JSON.parse(clean); } catch (err) {
    return json_({ ok: false, error: "Claude could not read that picture clearly. Try a straighter, brighter photo.", raw: clean.slice(0, 200) });
  }
  return json_({ ok: true, fields: fields, usage: r.usage });
}

/* the app writes the shared list back */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var body = {};
    try { body = JSON.parse(e.postData.contents); } catch (err) {}
    if (String(body.key || "") !== KEY) {
      return json_({ ok: false, error: "wrong key" });
    }
    if (body.action === "file") {
      return saveFile_(body);
    }
    if (body.action === "ask") {
      return claudeAsk_(body);
    }
    if (body.action === "read") {
      return claudeRead_(body);
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
