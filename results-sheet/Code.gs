// Google Apps Script backend for Hebrew Class quiz results.
// Students' finished quizzes are saved as rows in this spreadsheet, and the
// teacher dashboard reads them back. Setup steps are in README.md.

// Change this to your own passcode before deploying. You type it once on the
// Teacher page. Keep it out of the public GitHub repository.
var TEACHER_PASSCODE = "change-me";

var SHEET_NAME = "Results";
var HEADERS = ["Finished", "Student", "Lesson ID", "Lesson", "Score", "Out of", "Percent", "Phrases missed"];

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "bad-request" });
  }
  if (data.action === "list") return listResults(data);
  if (data.action === "liveState") return reply(liveReply(liveState()));
  if (data.action === "liveJoin") return liveJoin(data);
  if (data.action === "liveStart" || data.action === "liveSet" || data.action === "liveEnd" || data.action === "liveAttendees") {
    if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
    if (data.action === "liveStart") return liveStart(data);
    if (data.action === "liveSet") return liveSet(data);
    if (data.action === "liveEnd") return liveEnd();
    return liveAttendees();
  }
  return saveResult(data);
}

function isTeacher(data) {
  return TEACHER_PASSCODE !== "change-me" && String(data.passcode || "") === TEACHER_PASSCODE;
}

/* ---------- Live class ----------
   The teacher's current word is kept in the script cache, which is fast enough
   for every student to check it every few seconds, with a copy in script
   properties in case the cache is cleared. Who joined goes to the Attendance sheet. */

var LIVE_KEY = "liveClass";
var LIVE_MAX_HOURS = 4; // A class nobody ended stops counting as live after this.
var ATTENDANCE_SHEET = "Attendance";
var ATTENDANCE_HEADERS = ["Joined", "Email", "Lesson ID", "Class ID"];

function liveState() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(LIVE_KEY);
  if (!raw) {
    raw = PropertiesService.getScriptProperties().getProperty(LIVE_KEY);
    if (raw) cache.put(LIVE_KEY, raw, 21600);
  }
  var live = raw ? JSON.parse(raw) : { running: false };
  if (live.running && Date.now() - live.startedAt > LIVE_MAX_HOURS * 3600000) live = { running: false };
  return live;
}

function saveLive(live) {
  var raw = JSON.stringify(live);
  CacheService.getScriptCache().put(LIVE_KEY, raw, 21600);
  PropertiesService.getScriptProperties().setProperty(LIVE_KEY, raw);
}

function liveReply(live) {
  return live.running
    ? { ok: true, running: true, lessonId: live.lessonId, index: live.index, sessionId: live.sessionId }
    : { ok: true, running: false };
}

function liveStart(data) {
  var lessonId = safe(data.lessonId, 80);
  if (!lessonId) return reply({ ok: false, error: "bad-request" });
  var now = Date.now();
  var live = { running: true, lessonId: lessonId, index: 0, seq: 0, startedAt: now, sessionId: String(now) };
  withLock(function () { saveLive(live); });
  return reply(liveReply(live));
}

// seq is the teacher's click time, so a slow, older request can't undo a newer one.
function liveSet(data) {
  var live;
  withLock(function () {
    live = liveState();
    var seq = Number(data.seq) || 0;
    if (live.running && seq >= (live.seq || 0)) {
      live.index = Math.max(0, Math.floor(Number(data.index) || 0));
      live.seq = seq;
      saveLive(live);
    }
  });
  return reply(liveReply(live));
}

function liveEnd() {
  withLock(function () { saveLive({ running: false }); });
  return reply({ ok: true, running: false });
}

function liveJoin(data) {
  var email = String(data.email || "").trim().toLowerCase().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ ok: false, error: "bad-email" });
  var live = liveState();
  if (!live.running) return reply({ ok: false, error: "not-live" });
  withLock(function () {
    attendanceSheet().appendRow([new Date(), safe(email, 120), live.lessonId, live.sessionId]);
  });
  return reply(liveReply(live));
}

// Everyone who joined the class that is running now (each email once).
function liveAttendees() {
  var live = liveState();
  if (!live.running) return reply({ ok: true, running: false, attendees: [] });
  var seen = {};
  var attendees = [];
  attendanceSheet().getDataRange().getValues().slice(1).forEach(function (r) {
    var email = String(r[1] || "").replace(/^'/, "");
    if (String(r[3]) !== live.sessionId || seen[email]) return;
    seen[email] = true;
    attendees.push({ email: email, joinedAt: r[0] instanceof Date ? r[0].toISOString() : String(r[0]) });
  });
  return reply({ ok: true, running: true, attendees: attendees });
}

function attendanceSheet() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var s = book.getSheetByName(ATTENDANCE_SHEET) || book.insertSheet(ATTENDANCE_SHEET);
  if (s.getLastRow() === 0) {
    s.appendRow(ATTENDANCE_HEADERS);
    s.setFrozenRows(1);
  }
  return s;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { fn(); } finally { lock.releaseLock(); }
}

function saveResult(data) {
  var score = Number(data.score) || 0;
  var total = Number(data.total) || 0;
  var student = safe(data.student, 60);
  if (!student || total <= 0) return reply({ ok: false, error: "bad-request" });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet().appendRow([
      new Date(),
      student,
      safe(data.lessonId, 80),
      safe(data.lessonTitle, 120),
      score,
      total,
      Math.round((score / total) * 100) + "%",
      safe(data.missed, 2000)
    ]);
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true });
}

function listResults(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var rows = sheet().getDataRange().getValues().slice(1);
  var results = rows.map(function (r) {
    return {
      finishedAt: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
      student: unsafe(r[1]),
      lessonId: String(r[2]),
      lessonTitle: unsafe(r[3]),
      score: Number(r[4]) || 0,
      total: Number(r[5]) || 0,
      missed: unsafe(r[7])
    };
  });
  return reply({ ok: true, results: results });
}

function sheet() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var s = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (s.getLastRow() === 0) {
    s.appendRow(HEADERS);
    s.setFrozenRows(1);
  }
  return s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Plain text only: stops a name like "=HYPERLINK(...)" becoming a formula.
function safe(value, maxLength) {
  var text = String(value || "").trim().slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function unsafe(value) {
  return String(value || "");
}
