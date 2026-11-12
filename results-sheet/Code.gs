// Google Apps Script backend for Hebrew Class.
// Students' sign-ins, finished quizzes, Word of the day practice and suggestions
// are saved as rows in this spreadsheet, and the site reads them back.
// Setup steps are in README.md.

// Change this to your own passcode before deploying. You type it once on the
// Teacher page. Keep it out of the public GitHub repository.
var TEACHER_PASSCODE = "change-me";

var SHEET_NAME = "Results";
// Quiz is last so sheets made before it was added keep their columns.
var HEADERS = ["Finished", "Student", "Lesson ID", "Lesson", "Score", "Out of", "Percent", "Phrases missed", "Quiz"];

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "bad-request" });
  }
  if (data.action === "list") return listResults(data);
  if (data.action === "signIn") return signIn(data);
  if (data.action === "myReport") return myReport(data);
  if (data.action === "practice") return savePractice(data);
  if (data.action === "suggestions") return listSuggestions();
  if (data.action === "suggest") return saveSuggestion(data);
  if (data.action === "suggestReply") return replySuggestion(data);
  if (data.action === "resetPin") return resetPin(data);
  if (data.action === "emailTempPin") return emailTempPin(data);
  if (data.action === "pinOptions") return pinOptions(data);
  if (data.action === "pinCode") return sendPinCode(data);
  if (data.action === "pinCodeReset") return resetPinWithCode(data);
  if (data.action === "translate") return translate(data);
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
// Name is last so sheets made before it was added keep their columns.
var ATTENDANCE_HEADERS = ["Joined", "Email", "Lesson ID", "Class ID", "Name"];

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

// Name is required; email is optional, but checked when given.
function liveJoin(data) {
  var name = cleanName(data.name);
  if (!name) return reply({ ok: false, error: "bad-name" });
  var email = String(data.email || "").trim().toLowerCase().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ ok: false, error: "bad-email" });
  var live = liveState();
  if (!live.running) return reply({ ok: false, error: "not-live" });
  withLock(function () {
    attendanceSheet().appendRow([new Date(), safe(email, 120), live.lessonId, live.sessionId, safe(name, 60)]);
  });
  return reply(liveReply(live));
}

// Everyone who joined the class that is running now (each person once:
// by email when they gave one, otherwise by name).
function liveAttendees() {
  var live = liveState();
  if (!live.running) return reply({ ok: true, running: false, attendees: [] });
  var seen = {};
  var attendees = [];
  attendanceSheet().getDataRange().getValues().slice(1).forEach(function (r) {
    var email = String(r[1] || "").replace(/^'/, "");
    var name = String(r[4] || "").replace(/^'/, "");
    var key = email || name.toLowerCase();
    if (String(r[3]) !== live.sessionId || !key || seen[key]) return;
    seen[key] = true;
    attendees.push({ name: name, email: email, joinedAt: isoDate(r[0]) });
  });
  return reply({ ok: true, running: true, attendees: attendees });
}

function attendanceSheet() {
  var s = namedSheet(ATTENDANCE_SHEET, ATTENDANCE_HEADERS);
  if (s.getLastColumn() < ATTENDANCE_HEADERS.length) {
    s.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]); // older sheet: add the Name header
  }
  return s;
}

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { fn(); } finally { lock.releaseLock(); }
}

/* ---------- Students ----------
   A student signs in with a name. A PIN is optional: once a student has set
   one, their report, scores, practice and suggestions need it. The PIN itself
   is never stored, only a scrambled form of it. A student who forgot it gets a
   code by email (below). Or, on the student's report on the Teacher page, the
   teacher presses Email temporary PIN: a 3-digit PIN goes to the student's
   email and is kept in the "PIN" cell ("Temporary: 482"); the student signs in
   with it and must then choose their own PIN. For a student with no email the
   teacher presses Clear PIN. Every change is written to the "PIN changes" sheet. */

var STUDENTS_SHEET = "Students";
// Email is last so sheets made before it was added keep their columns.
var STUDENTS_HEADERS = ["Joined", "Name", "Key", "PIN", "Email"];
var PIN_TRIES = 5; // wrong PINs allowed before a pause
var PIN_PAUSE_SECONDS = 600;
var TEMP_PIN_PREFIX = "Temporary: ";
var PIN_LOG_SHEET = "PIN changes";
var PIN_LOG_HEADERS = ["When", "Student", "Change"];

// The 3 digits of a temporary PIN cell, or "" for a real (scrambled) PIN.
function tempPinOf(cell) {
  var m = /^Temporary: (\d{3})$/.exec(String(cell || ""));
  return m ? m[1] : "";
}

// One line on the PIN changes sheet. Never the PIN itself. Call it inside withLock.
function logPin(name, change) {
  namedSheet(PIN_LOG_SHEET, PIN_LOG_HEADERS).appendRow([new Date(), safe(name, 60), safe(change, 200)]);
}

// Counts a wrong PIN; the fifth in 10 minutes pauses sign-in for that name.
function wrongPin(cache, triesKey, name) {
  var tries = (Number(cache.get(triesKey)) || 0) + 1;
  cache.put(triesKey, String(tries), PIN_PAUSE_SECONDS);
  if (tries === PIN_TRIES) logPin(name, PIN_TRIES + " wrong PINs: sign-in paused for 10 minutes");
}

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
}

// The same name with different capitals or spaces is one student.
function nameKey(value) {
  return cleanName(value).toLowerCase();
}

function studentsSheet() {
  var s = namedSheet(STUDENTS_SHEET, STUDENTS_HEADERS);
  if (s.getLastColumn() < STUDENTS_HEADERS.length) {
    s.getRange(1, 1, 1, STUDENTS_HEADERS.length).setValues([STUDENTS_HEADERS]); // older sheet: add the Email header
  }
  return s;
}

// { row, name, pin } for the student with this key, or null.
function findStudent(key) {
  var rows = studentsSheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]).replace(/^'/, "") === key) {
      return { row: i + 1, name: String(rows[i][1]).replace(/^'/, ""), pin: String(rows[i][3] || "") };
    }
  }
  return null;
}

// Made once and kept with the script, so the scrambled PINs can't be worked
// out from the sheet alone.
function secret() {
  var props = PropertiesService.getScriptProperties();
  var value = props.getProperty("secret");
  if (!value) {
    value = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty("secret", value);
  }
  return value;
}

function sha(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8).map(function (b) {
    return ("0" + (b & 255).toString(16)).slice(-2);
  }).join("");
}

function pinHash(key, pin) {
  return sha(secret() + "|pin|" + key + "|" + pin);
}

// What the student's browser keeps instead of the PIN.
function tokenFor(key, hash) {
  return sha(secret() + "|token|" + key + "|" + hash);
}

// True unless this name has a PIN and the browser's token doesn't match it.
function studentAllowed(name, token) {
  var key = nameKey(name);
  if (!key) return false;
  var student = findStudent(key);
  return !student || !student.pin || String(token || "") === tokenFor(key, student.pin);
}

function signIn(data) {
  var name = cleanName(data.name);
  var key = name.toLowerCase();
  var pin = String(data.pin || "").trim();
  var newPin = String(data.newPin || "").trim(); // only after a temporary PIN
  if (!name) return reply({ ok: false, error: "bad-name" });
  // 3 digits is a temporary PIN from the teacher; a PIN of one's own is 4 to 8.
  if (pin && !/^\d{3,8}$/.test(pin)) return reply({ ok: false, error: "bad-pin" });
  if (newPin && !/^\d{4,8}$/.test(newPin)) return reply({ ok: false, error: "bad-pin" });
  var email = String(data.email || "").trim().toLowerCase().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ ok: false, error: "bad-email" });

  var cache = CacheService.getScriptCache();
  var triesKey = "pinTries:" + sha(key);
  if (Number(cache.get(triesKey)) >= PIN_TRIES) return reply({ ok: false, error: "too-many-tries" });

  var out;
  withLock(function () {
    var student = findStudent(key);
    var temp = student ? tempPinOf(student.pin) : "";
    var hash = pin ? pinHash(key, pin) : "";
    if ((!student || !student.pin) && pin && !/^\d{4,8}$/.test(pin)) {
      out = { ok: false, error: "bad-pin" };
    } else if (!student) {
      studentsSheet().appendRow([new Date(), safe(name, 60), safe(key, 60), hash, safe(email, 120)]);
      if (pin) logPin(name, "Chose a PIN");
      out = { ok: true, name: name, created: true, hasPin: !!pin, token: pin ? tokenFor(key, hash) : "" };
    } else if (!student.pin) {
      // No PIN yet: typing one now sets it.
      if (hash) {
        studentsSheet().getRange(student.row, 4).setValue(hash);
        logPin(student.name, "Chose a PIN");
      }
      out = { ok: true, name: student.name, created: false, hasPin: !!pin, token: pin ? tokenFor(key, hash) : "" };
    } else if (!pin) {
      out = { ok: false, error: "pin-needed" };
    } else if (temp) {
      // The teacher's temporary PIN: right, then the student chooses their own.
      if (pin !== temp) {
        wrongPin(cache, triesKey, student.name);
        out = { ok: false, error: "wrong-pin" };
      } else if (!newPin) {
        out = { ok: false, error: "choose-pin" };
      } else {
        var newHash = pinHash(key, newPin);
        studentsSheet().getRange(student.row, 4).setValue(newHash);
        logPin(student.name, "Used the temporary PIN and chose a new PIN");
        cache.remove(triesKey);
        out = { ok: true, name: student.name, created: false, hasPin: true, token: tokenFor(key, newHash) };
      }
    } else if (hash !== student.pin) {
      wrongPin(cache, triesKey, student.name);
      out = { ok: false, error: "wrong-pin" };
    } else {
      cache.remove(triesKey);
      out = { ok: true, name: student.name, created: false, hasPin: true, token: tokenFor(key, student.pin) };
    }
    // An email typed at a successful sign-in replaces the one on file.
    if (out.ok && student && email) studentsSheet().getRange(student.row, 5).setValue(safe(email, 120));
  });
  return reply(out);
}

// The teacher clears a forgotten PIN for a student with no email (and ends any
// pause after wrong tries). Until the student signs in and types a new PIN,
// their name works without one, so clear it only when they ask.
function resetPin(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var key = nameKey(data.name);
  if (!key) return reply({ ok: false, error: "bad-request" });
  var found = false;
  withLock(function () {
    var student = findStudent(key);
    if (!student) return;
    studentsSheet().getRange(student.row, 4).setValue("");
    logPin(student.name, "Teacher cleared the PIN");
    found = true;
  });
  if (!found) return reply({ ok: false, error: "not-found" });
  CacheService.getScriptCache().remove("pinTries:" + sha(key));
  return reply({ ok: true });
}

// The teacher sends a 3-digit temporary PIN to the email saved for the student.
// It goes only to that email (the teacher's screen doesn't show it) and is kept
// in the student's PIN cell as "Temporary: 482". The old PIN stops working; the
// student signs in with the temporary PIN and must then choose their own.
function emailTempPin(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var key = nameKey(data.name);
  if (!key) return reply({ ok: false, error: "bad-request" });
  var student = studentWithEmail(key);
  if (!student) return reply({ ok: false, error: "not-found" });
  if (!student.email) return reply({ ok: false, error: "no-email" });
  var site = /^https:\/\/[^\s]+$/.test(String(data.siteUrl || "")) ? String(data.siteUrl) : "";
  var temp = String(100 + Math.floor(Math.random() * 900));
  try {
    MailApp.sendEmail({
      to: student.email,
      subject: "Hebrew Class: your temporary PIN",
      body: "Hello " + student.name + ",\n\n" +
        "Your teacher has reset your Hebrew Class PIN. Your temporary PIN is: " + temp + "\n\n" +
        "Sign in" + (site ? " at " + site : "") + " with your name and this PIN, then choose your own PIN. " +
        "Your old PIN no longer works. Your scores are kept.\n"
    });
  } catch (err) {
    return reply({ ok: false, error: "mail-failed" });
  }
  withLock(function () {
    studentsSheet().getRange(student.row, 4).setValue(TEMP_PIN_PREFIX + temp);
    logPin(student.name, "Teacher emailed a temporary PIN (" + maskEmail(student.email) + ")");
  });
  CacheService.getScriptCache().remove("pinTries:" + sha(key));
  return reply({ ok: true, sentTo: student.email });
}

/* A student who forgot their PIN resets it themselves: a 6-digit code goes to
   the email saved for their name, and the code lets them choose a new PIN.
   The emails are sent from the Google account that owns this script. */

var CODE_MINUTES = 15;   // how long a code works
var CODE_TRIES = 5;      // wrong codes allowed before a new one is needed
var CODES_PER_HOUR = 3;  // codes one name can ask for in an hour

// Run this once from the Apps Script editor (choose it above, press Run) so
// Google asks you to allow the script to send the reset emails.
function allowEmail() {
  Logger.log("Emails left today: " + MailApp.getRemainingDailyQuota());
}

// { row, name, pin, email } for the student with this key, or null.
function studentWithEmail(key) {
  var student = findStudent(key);
  if (!student) return null;
  student.email = unsafe(studentsSheet().getRange(student.row, 5).getValues()[0][0]).trim();
  return student;
}

// "d***@gmail.com": enough for the student to recognise, not to read.
function maskEmail(email) {
  var at = email.indexOf("@");
  return at < 1 ? "your email" : email.charAt(0) + "***" + email.slice(at);
}

// What "Forgot your PIN?" can offer this name, before anything is sent: a code
// by email (to the address shown half-hidden) or only the teacher.
function pinOptions(data) {
  var key = nameKey(data.name);
  if (!key) return reply({ ok: false, error: "bad-name" });
  var student = studentWithEmail(key);
  if (!student) return reply({ ok: false, error: "not-found" });
  return reply({
    ok: true,
    name: student.name,
    hasPin: !!student.pin,
    hasEmail: !!student.email,
    sentTo: student.email ? maskEmail(student.email) : ""
  });
}

function sendPinCode(data) {
  var name = cleanName(data.name);
  var key = name.toLowerCase();
  if (!key) return reply({ ok: false, error: "bad-name" });
  var student = studentWithEmail(key);
  if (!student) return reply({ ok: false, error: "not-found" });
  if (!student.pin) return reply({ ok: false, error: "no-pin" });
  if (!student.email) return reply({ ok: false, error: "no-email" });

  var cache = CacheService.getScriptCache();
  var countKey = "pinCodes:" + sha(key);
  var sent = Number(cache.get(countKey)) || 0;
  if (sent >= CODES_PER_HOUR) return reply({ ok: false, error: "too-many-codes" });

  var code = String(Math.floor(100000 + Math.random() * 900000));
  try {
    MailApp.sendEmail({
      to: student.email,
      subject: "Hebrew Class: your PIN reset code",
      body: "Hello " + student.name + ",\n\n" +
        "Your code to choose a new Hebrew Class PIN is: " + code + "\n\n" +
        "It works for " + CODE_MINUTES + " minutes. If you didn't ask for it, you can ignore this email; your PIN stays the same.\n"
    });
  } catch (err) {
    return reply({ ok: false, error: "mail-failed" });
  }
  cache.put(countKey, String(sent + 1), 3600);
  cache.put("pinCode:" + sha(key), JSON.stringify({ hash: sha(secret() + "|code|" + key + "|" + code), tries: 0 }), CODE_MINUTES * 60);
  withLock(function () { logPin(student.name, "Asked for a PIN reset code by email (" + maskEmail(student.email) + ")"); });
  return reply({ ok: true, sentTo: maskEmail(student.email) });
}

function resetPinWithCode(data) {
  var name = cleanName(data.name);
  var key = name.toLowerCase();
  var code = String(data.code || "").replace(/\s+/g, "");
  var pin = String(data.pin || "").trim();
  if (!key) return reply({ ok: false, error: "bad-name" });
  if (!/^\d{4,8}$/.test(pin)) return reply({ ok: false, error: "bad-pin" });

  var cache = CacheService.getScriptCache();
  var codeKey = "pinCode:" + sha(key);
  var saved = cache.get(codeKey);
  if (!saved) return reply({ ok: false, error: "code-expired" });
  saved = JSON.parse(saved);
  if (saved.hash !== sha(secret() + "|code|" + key + "|" + code)) {
    saved.tries += 1;
    if (saved.tries >= CODE_TRIES) cache.remove(codeKey);
    else cache.put(codeKey, JSON.stringify(saved), CODE_MINUTES * 60);
    return reply({ ok: false, error: saved.tries >= CODE_TRIES ? "code-expired" : "wrong-code" });
  }

  var out;
  withLock(function () {
    var student = findStudent(key);
    if (!student) { out = { ok: false, error: "not-found" }; return; }
    var hash = pinHash(key, pin);
    studentsSheet().getRange(student.row, 4).setValue(hash);
    logPin(student.name, "Chose a new PIN with the code from the email");
    out = { ok: true, name: student.name, hasPin: true, token: tokenFor(key, hash) };
  });
  if (out.ok) {
    cache.remove(codeKey);
    cache.remove("pinTries:" + sha(key));
  }
  return reply(out);
}

// One student's own quiz results and Word of the day practice.
function myReport(data) {
  var key = nameKey(data.name);
  if (!key) return reply({ ok: false, error: "bad-request" });
  if (!studentAllowed(data.name, data.token)) return reply({ ok: false, error: "sign-in" });
  function mine(r) { return nameKey(r.student) === key; }
  return reply({ ok: true, results: readResults().filter(mine), practice: readPractice().filter(mine) });
}

/* ---------- Quiz results ---------- */

function saveResult(data) {
  var score = Number(data.score) || 0;
  var total = Number(data.total) || 0;
  var student = cleanName(data.student);
  if (!student || total <= 0) return reply({ ok: false, error: "bad-request" });
  if (!studentAllowed(student, data.token)) return reply({ ok: false, error: "sign-in" });

  withLock(function () {
    sheet().appendRow([
      new Date(),
      safe(student, 60),
      safe(data.lessonId, 80),
      safe(data.lessonTitle, 120),
      score,
      total,
      Math.round((score / total) * 100) + "%",
      safe(data.missed, 2000),
      Math.max(0, Math.floor(Number(data.quiz) || 0)) || ""
    ]);
  });
  return reply({ ok: true });
}

// Everything the Teacher page shows: all quiz results, all practice, all
// students (with a temporary PIN not used yet) and the PIN changes.
function listResults(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var students = dataRows(studentsSheet()).map(function (r) {
    return { name: unsafe(r[1]), joinedAt: isoDate(r[0]), hasPin: !!r[3], tempPinSent: !!tempPinOf(r[3]), email: unsafe(r[4]) };
  });
  var pinChanges = dataRows(namedSheet(PIN_LOG_SHEET, PIN_LOG_HEADERS)).map(function (r) {
    return { at: isoDate(r[0]), student: unsafe(r[1]), change: unsafe(r[2]) };
  });
  return reply({ ok: true, results: readResults(), practice: readPractice(), students: students, pinChanges: pinChanges });
}

function readResults() {
  return dataRows(sheet()).map(function (r) {
    return {
      finishedAt: isoDate(r[0]),
      student: unsafe(r[1]),
      lessonId: String(r[2]),
      lessonTitle: unsafe(r[3]),
      score: Number(r[4]) || 0,
      total: Number(r[5]) || 0,
      missed: unsafe(r[7]),
      quiz: Number(r[8]) || 0 // which of the lesson's short quizzes; 0 for results from before there were several
    };
  });
}

function sheet() {
  var s = namedSheet(SHEET_NAME, HEADERS);
  if (s.getLastColumn() < HEADERS.length) {
    s.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]); // older sheet: add the Quiz header
  }
  return s;
}

/* ---------- Word of the day practice ---------- */

var PRACTICE_SHEET = "Practice";
var PRACTICE_HEADERS = ["When", "Student", "Day", "Word"];

function practiceSheet() {
  return namedSheet(PRACTICE_SHEET, PRACTICE_HEADERS);
}

function readPractice() {
  return dataRows(practiceSheet()).map(function (r) {
    return { at: isoDate(r[0]), student: unsafe(r[1]), day: dayText(r[2]), word: unsafe(r[3]) };
  });
}

// Sheets may turn "2026-11-15" into a date; give it back as text.
function dayText(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), "yyyy-MM-dd");
  }
  return String(value || "").replace(/^'/, "");
}

// One row per student per day; practising again the same day changes nothing.
function savePractice(data) {
  var name = cleanName(data.name);
  var key = name.toLowerCase();
  var day = String(data.day || "");
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply({ ok: false, error: "bad-request" });
  if (!studentAllowed(name, data.token)) return reply({ ok: false, error: "sign-in" });
  withLock(function () {
    var done = readPractice().some(function (p) { return p.day === day && nameKey(p.student) === key; });
    if (!done) practiceSheet().appendRow([new Date(), safe(name, 60), "'" + day, safe(data.word, 200)]);
  });
  return reply({ ok: true });
}

/* ---------- Suggestions box ---------- */

var SUGGESTIONS_SHEET = "Suggestions";
var SUGGESTIONS_HEADERS = ["ID", "When", "Student", "Suggestion", "Response", "Responded"];

function suggestionsSheet() {
  return namedSheet(SUGGESTIONS_SHEET, SUGGESTIONS_HEADERS);
}

// Everyone in the class can read the suggestions and the teacher's responses.
function listSuggestions() {
  var items = dataRows(suggestionsSheet()).map(function (r) {
    return {
      id: String(r[0]),
      at: isoDate(r[1]),
      student: unsafe(r[2]),
      text: unsafe(r[3]),
      response: unsafe(r[4]),
      respondedAt: r[5] ? isoDate(r[5]) : ""
    };
  });
  return reply({ ok: true, suggestions: items });
}

function saveSuggestion(data) {
  var name = cleanName(data.name);
  var text = String(data.text || "").trim();
  if (!name || !text) return reply({ ok: false, error: "bad-request" });
  if (!isTeacher(data) && !studentAllowed(name, data.token)) return reply({ ok: false, error: "sign-in" });
  withLock(function () {
    suggestionsSheet().appendRow([Utilities.getUuid(), new Date(), safe(name, 60), safe(text, 1000), "", ""]);
  });
  return listSuggestions();
}

// The teacher's response to one suggestion; an empty response removes it.
function replySuggestion(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var id = String(data.id || "");
  var found = false;
  withLock(function () {
    var s = suggestionsSheet();
    var rows = s.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) !== id) continue;
      var response = safe(data.response, 1000);
      s.getRange(i + 1, 5, 1, 2).setValues([[response, response ? new Date() : ""]]);
      found = true;
      break;
    }
  });
  return found ? listSuggestions() : reply({ ok: false, error: "not-found" });
}

/* ---------- How to say ----------
   Google's translator, built into Apps Script. Short phrases only. Answers
   are remembered for six hours, so a repeated phrase doesn't count against
   the script's daily translation allowance. */

function translate(data) {
  var text = String(data.text || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!text) return reply({ ok: false, error: "bad-request" });
  var cache = CacheService.getScriptCache();
  var cacheKey = "tr:" + sha(text.toLowerCase());
  var hebrew = cache.get(cacheKey);
  if (!hebrew) {
    try {
      hebrew = LanguageApp.translate(text, "en", "he");
    } catch (err) {
      return reply({ ok: false, error: "translate-failed" });
    }
    if (hebrew) cache.put(cacheKey, hebrew, 21600);
  }
  return reply({ ok: true, text: text, hebrew: hebrew });
}

/* ---------- Sheets ---------- */

function namedSheet(name, headers) {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var s = book.getSheetByName(name) || book.insertSheet(name);
  if (s.getLastRow() === 0) {
    s.appendRow(headers);
    s.setFrozenRows(1);
  }
  return s;
}

function dataRows(s) {
  return s.getDataRange().getValues().slice(1);
}

function isoDate(value) {
  return value instanceof Date ? value.toISOString() : String(value);
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
