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
  if (data.action === "place") return savePlace(data);
  if (data.action === "myReport") return myReport(data);
  if (data.action === "practice") return savePractice(data);
  if (data.action === "suggestions") return listSuggestions(data);
  if (data.action === "suggest" || data.action === "suggestPrivate") return saveSuggestion(data);
  if (data.action === "suggestReply") return replySuggestion(data);
  if (data.action === "resetPin") return resetPin(data);
  if (data.action === "emailTempPin") return emailTempPin(data);
  if (data.action === "pinOptions") return pinOptions(data);
  if (data.action === "pinCode") return sendPinCode(data);
  if (data.action === "pinCodeReset") return resetPinWithCode(data);
  if (data.action === "inviteCode") return inviteCode(data);
  if (data.action === "translate") return translate(data);
  if (data.action === "board") return board(data);
  if (data.action === "boardHide") return boardHide(data);
  if (data.action === "liveState") return reply(liveReply(liveState()));
  if (data.action === "liveJoin") return liveJoin(data);
  if (data.action === "liveCall") return liveCall(data);
  if (data.action === "liveStart" || data.action === "liveSet" || data.action === "liveLesson" || data.action === "liveKeep" || data.action === "liveEnd" || data.action === "liveAttendees" || data.action === "callUsage") {
    if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
    if (data.action === "liveStart") return liveStart(data);
    if (data.action === "liveSet") return liveSet(data);
    if (data.action === "liveLesson") return liveLesson(data);
    if (data.action === "liveKeep") return liveKeep();
    if (data.action === "liveEnd") return liveEnd();
    if (data.action === "callUsage") return callUsage();
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
// So a class isn't left running by mistake, the teacher's page asks "Still teaching?" LIVE_ASK_MINUTES
// after the class starts or Continue was last pressed, and ends the class if Continue isn't pressed
// within LIVE_ANSWER_MINUTES. In case the page was closed, the script ends it LIVE_GRACE_MINUTES later.
// The page may ask for shorter times when it starts the class (handy for a quick test), never longer.
var LIVE_ASK_MINUTES = 30;
var LIVE_ANSWER_MINUTES = 10;
var LIVE_GRACE_MINUTES = 2;
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
  if (live.running && (Date.now() - live.startedAt > LIVE_MAX_HOURS * 3600000 || liveForgotten(live))) live = { running: false };
  return live;
}

// Nobody pressed Continue in time. keptAt: when the class started or Continue was last pressed
// (classes started before it was added have none).
function liveForgotten(live) {
  return !!live.keptAt && Date.now() - live.keptAt > (liveAskMinutes(live) + liveAnswerMinutes(live) + LIVE_GRACE_MINUTES) * 60000;
}

// The class's own times, which the page chose when it started it.
function liveAskMinutes(live) {
  return live.askMinutes || LIVE_ASK_MINUTES;
}

function liveAnswerMinutes(live) {
  return live.answerMinutes || LIVE_ANSWER_MINUTES;
}

// A shorter time the page asked for, whole minutes from 1; never longer than the most.
function shorterMinutes(value, most) {
  var n = Math.floor(Number(value));
  return n >= 1 && n < most ? n : most;
}

function saveLive(live) {
  var raw = JSON.stringify(live);
  CacheService.getScriptCache().put(LIVE_KEY, raw, 21600);
  PropertiesService.getScriptProperties().setProperty(LIVE_KEY, raw);
}

// askIn: milliseconds until the teacher's page asks "Still teaching?" (below 0 once it has asked).
function liveReply(live) {
  if (!live.running) return { ok: true, running: false };
  var res = { ok: true, running: true, lessonId: live.lessonId, index: live.index, sessionId: live.sessionId };
  if (live.keptAt) res.askIn = live.keptAt + liveAskMinutes(live) * 60000 - Date.now();
  return res;
}

function liveStart(data) {
  var lessonId = safe(data.lessonId, 80);
  if (!lessonId) return reply({ ok: false, error: "bad-request" });
  var now = Date.now();
  var live = {
    running: true, lessonId: lessonId, index: 0, seq: 0, startedAt: now, keptAt: now, sessionId: String(now),
    askMinutes: shorterMinutes(data.askMinutes, LIVE_ASK_MINUTES),
    answerMinutes: shorterMinutes(data.answerMinutes, LIVE_ANSWER_MINUTES)
  };
  var old;
  withLock(function () { old = liveState(); saveLive(live); });
  deleteRoom(old); // a class that was still running loses its call
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

// Moves the running class to another lesson, at its first word. It stays the
// same class, so everyone who joined stays in it and in its video call. Lesson
// changes are ordered by their own seq, so one that arrives after a later word
// change still moves the lesson, but leaves that word in place.
function liveLesson(data) {
  var lessonId = safe(data.lessonId, 80);
  if (!lessonId) return reply({ ok: false, error: "bad-request" });
  var live;
  withLock(function () {
    live = liveState();
    var seq = Number(data.seq) || 0;
    if (live.running && seq >= (live.lessonSeq || 0)) {
      live.lessonId = lessonId;
      live.lessonSeq = seq;
      if (seq >= (live.seq || 0)) {
        live.index = 0;
        live.seq = seq;
      }
      saveLive(live);
    }
  });
  if (!live.running) return reply({ ok: false, error: "not-live" });
  return reply(liveReply(live));
}

// The teacher pressed Continue: the next "Still teaching?" comes the class's ask minutes from now.
function liveKeep() {
  var live;
  withLock(function () {
    live = liveState();
    if (live.running) {
      live.keptAt = Date.now();
      saveLive(live);
    }
  });
  if (!live.running) return reply({ ok: false, error: "not-live" });
  return reply(liveReply(live));
}

function liveEnd() {
  var old;
  withLock(function () { old = liveState(); saveLive({ running: false }); });
  deleteRoom(old);
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
  boardPointsChanged();
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

/* ---------- Live class video call ----------
   With a Daily API key in the script properties (DAILY_API_KEY, see README.md),
   each live class gets a private Daily room, made when the first person opens
   the call and deleted when the class ends. Everyone who joined the class gets
   their own token for it: the teacher and the first VIDEO_SEATS students to
   join can send video and sound, everyone after them sound only. Without a key
   the class runs as before, with no call.

   Daily has no spending limit, so the script keeps its own: a call takes at
   most CALL_MAX_PEOPLE people for at most CALL_MAX_MINUTES, and before making
   a room it checks the minutes used in the last 32 days (any billing month
   fits inside that) and shortens the call, or leaves it out, so the total
   can't pass CALL_MINUTES_LIMIT. Each call first counts as its most
   (people × minutes); once Daily has the numbers, it counts what it really used. */

var VIDEO_SEATS = 10;          // students with video, besides the teacher
// Daily's 10,000 free participant minutes a month, less room for test calls. Both scripts share
// one Daily account but count only their own calls, so the test script gets a script property
// CALL_MINUTES_LIMIT of 600 (see README.md): 9,000 + 600 stays under 10,000.
var CALL_MINUTES_LIMIT = 9000;
var CALL_MAX_PEOPLE = 20;      // in the call at once, teacher included (Daily counts the teacher's minutes too)
var CALL_MAX_MINUTES = 60;     // the longest a call lasts, from the class's first call
var CALL_MIN_MINUTES = 15;     // with less than this left, the class has no call
var CALL_LEDGER = "callLedger"; // script property: the calls of the last 32 days
var LEDGER_DAYS = 32;
var DAILY_API = "https://api.daily.co/v1/";

function dailyKey() {
  return PropertiesService.getScriptProperties().getProperty("DAILY_API_KEY") || "";
}

// The minutes this script may use in 32 days: the CALL_MINUTES_LIMIT script property when set, never more than the default.
function callMinutesLimit() {
  var raw = String(PropertiesService.getScriptProperties().getProperty("CALL_MINUTES_LIMIT") || "").trim();
  var set = raw === "" ? NaN : Number(raw);
  return set >= 0 && set < CALL_MINUTES_LIMIT ? set : CALL_MINUTES_LIMIT;
}

var dailyError = ""; // why the last request to Daily failed, for checkDaily

// One request to Daily: its reply, or null if it failed (the reason goes to the script's log).
function daily(method, path, payload) {
  var key = dailyKey();
  if (!key) return null;
  dailyError = "";
  var options = { method: method, headers: { Authorization: "Bearer " + key }, muteHttpExceptions: true };
  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  try {
    var res = UrlFetchApp.fetch(DAILY_API + path, options);
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return JSON.parse(res.getContentText() || "{}");
    dailyError = code + " " + res.getContentText().slice(0, 300);
  } catch (err) {
    dailyError = String(err);
  }
  console.error("Daily " + method + " " + path + ": " + dailyError);
  return null;
}

// Run this once from the Apps Script editor after adding DAILY_API_KEY. Google
// asks you to allow the script to connect to Daily; then it makes a test room
// and deletes it again, as a live class will.
function checkDaily() {
  if (!dailyKey()) throw new Error("Add DAILY_API_KEY under Project Settings → Script properties first.");
  var room = daily("post", "rooms", roomSettings("check-" + Utilities.getUuid().slice(0, 8), Math.floor(Date.now() / 1000) + 600));
  if (!room || !room.name) {
    throw new Error("Daily couldn't make a room. If the key is right (Daily dashboard → Developers), Daily may need a card on the account. Daily said: " + dailyError);
  }
  daily("delete", "rooms/" + encodeURIComponent(room.name));
  Logger.log("Daily is connected. The next live class will have the video call.");
  Logger.log("Video minutes counted in the last " + LEDGER_DAYS + " days: " + ledgerMinutes(readLedger()) + " of " + callMinutesLimit() + ".");
  var month = monthMinutes(monthStart());
  Logger.log(month === null
    ? "Couldn't read this month's minutes from Daily. Daily said: " + dailyError
    : "Video minutes on the whole Daily account this month: " + month + " of " + DAILY_FREE_MINUTES + " free.");
}

/* The teacher's meter: participant minutes on the whole Daily account since the
   1st of this month, against Daily's free minutes. It counts every call on the
   account (the test script's too), from Daily's own meeting records. */

var DAILY_FREE_MINUTES = 10000; // free each calendar month; Daily charges for every minute above

// The 1st of this month at midnight UTC, in milliseconds.
function monthStart() {
  var now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

// Kept for 2 minutes, so the teacher's pages don't ask Daily each time they refresh.
function callUsage() {
  if (!dailyKey()) return reply({ ok: false, error: "no-video" });
  var since = monthStart();
  var cache = CacheService.getScriptCache();
  var cacheKey = "callUsage|" + since;
  var kept = cache.get(cacheKey);
  var minutes = kept !== null ? Number(kept) : monthMinutes(since);
  if (minutes === null) return reply({ ok: false, error: "video-failed" });
  if (kept === null) cache.put(cacheKey, String(minutes), 120);
  return reply({ ok: true, minutes: minutes, free: DAILY_FREE_MINUTES, since: since });
}

// Every participant's minutes in the meetings since `since` (milliseconds), a
// minute started counting as a whole one; null if Daily didn't answer.
function monthMinutes(since) {
  var start = Math.floor(since / 1000);
  var minutes = 0;
  var after = "";
  for (var page = 0; page < 50; page++) {
    var res = daily("get", "meetings?timeframe_start=" + start + "&limit=100" + (after ? "&starting_after=" + encodeURIComponent(after) : ""));
    if (!res || !res.data) return null;
    res.data.forEach(function (meeting) {
      if (Number(meeting.start_time) < start) return; // in case Daily sends older ones too
      (meeting.participants || []).forEach(function (p) {
        minutes += Math.ceil((Number(p.duration) || 0) / 60);
      });
    });
    if (res.data.length < 100) break;
    after = res.data[res.data.length - 1].id;
  }
  return minutes;
}

// A private room that throws everyone out at exp (unix seconds) and takes at most CALL_MAX_PEOPLE.
function roomSettings(name, exp) {
  return {
    name: name,
    privacy: "private",
    properties: {
      exp: exp,
      eject_at_room_exp: true,
      max_participants: CALL_MAX_PEOPLE,
      enable_chat: false,
      enable_screenshare: false
    }
  };
}

// The calls of the last 32 days: [{ name, at, minutes, settled }].
function readLedger() {
  var raw = PropertiesService.getScriptProperties().getProperty(CALL_LEDGER);
  var since = Date.now() - LEDGER_DAYS * 86400000;
  return (raw ? JSON.parse(raw) : []).filter(function (entry) { return entry.at > since; });
}

function saveLedger(list) {
  PropertiesService.getScriptProperties().setProperty(CALL_LEDGER, JSON.stringify(list));
}

function ledgerMinutes(list) {
  return list.reduce(function (sum, entry) { return sum + entry.minutes; }, 0);
}

// The participant minutes a room used, from Daily's meeting records, or null
// when Daily has none for it yet. A minute started counts as a whole one.
function roomUsage(name) {
  var res = daily("get", "meetings?room=" + encodeURIComponent(name));
  if (!res || !res.data || !res.data.length) return null;
  var usage = { minutes: 0, ongoing: false };
  res.data.forEach(function (meeting) {
    if (meeting.ongoing) usage.ongoing = true;
    (meeting.participants || []).forEach(function (p) {
      usage.minutes += Math.ceil((Number(p.duration) || 0) / 60) + (meeting.ongoing ? 1 : 0);
    });
  });
  return usage;
}

// Swaps each call's "at most" for what it really used, once that's known. The
// room named ending is being closed, so its numbers so far are its last.
function settleCalls(list, ending) {
  list.forEach(function (entry) {
    if (entry.settled) return;
    var usage = roomUsage(entry.name);
    if (!usage || (usage.ongoing && entry.name !== ending)) return;
    entry.minutes = Math.min(entry.minutes, usage.minutes);
    entry.settled = true;
  });
}

// When the class ends its call has to go too, or it would stay open until it expires.
function deleteRoom(live) {
  if (!live || !live.room) return;
  var name = live.room.name;
  withLock(function () {
    var list = readLedger();
    settleCalls(list.filter(function (entry) { return entry.name === name; }), name);
    saveLedger(list);
  });
  daily("delete", "rooms/" + encodeURIComponent(name));
}

// The running class's room, made the first time someone asks for it:
// { room } or { error: "used-up" | "video-failed" }.
function liveRoom() {
  var live = liveState();
  if (live.room) return { room: live.room };
  if (live.noCall) return { error: live.noCall };
  var result = { error: "video-failed" };
  withLock(function () {
    live = liveState(); // someone else may have made it while this one waited
    if (!live.running) return;
    if (live.room) { result = { room: live.room }; return; }
    if (live.noCall) { result = { error: live.noCall }; return; }
    var list = readLedger();
    settleCalls(list);
    var left = callMinutesLimit() - ledgerMinutes(list);
    var minutes = Math.min(CALL_MAX_MINUTES, Math.floor(left / CALL_MAX_PEOPLE));
    if (minutes < CALL_MIN_MINUTES) {
      live.noCall = "used-up"; // asked once per class, not by every student
      saveLive(live);
      result = { error: "used-up" };
    } else {
      var exp = Math.floor(Date.now() / 1000) + minutes * 60;
      var made = daily("post", "rooms", roomSettings("class-" + live.sessionId + "-" + Utilities.getUuid().slice(0, 8), exp));
      if (made && made.name && made.url) {
        list.push({ name: made.name, at: Date.now(), minutes: minutes * CALL_MAX_PEOPLE, settled: false });
        live.room = { name: made.name, url: made.url, exp: exp, shortened: minutes < CALL_MAX_MINUTES };
        saveLive(live);
        result = { room: live.room };
      }
    }
    saveLedger(list);
  });
  return result;
}

// Where a student comes among the people who joined the running class (0 for
// the first), counted as liveAttendees does, or -1 if they haven't joined.
function liveSeat(live, name, email) {
  var key = nameKey(name);
  email = String(email || "").trim().toLowerCase();
  var seen = {};
  var place = 0;
  var rows = attendanceSheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][3]) !== live.sessionId) continue;
    var rowEmail = String(rows[i][1] || "").replace(/^'/, "");
    var rowName = String(rows[i][4] || "").replace(/^'/, "");
    var rowKey = rowEmail || rowName.toLowerCase();
    if (!rowKey || seen[rowKey]) continue;
    seen[rowKey] = true;
    if ((email && rowEmail === email) || nameKey(rowName) === key) return place;
    place++;
  }
  return -1;
}

// The call for the teacher, or for a student who joined the running class:
// the room's address and their own token, and whether they can send video.
function liveCall(data) {
  var live = liveState();
  if (!live.running) return reply({ ok: false, error: "not-live" });
  if (!dailyKey()) return reply({ ok: false, error: "no-video" });
  var who;
  if (data.passcode) {
    if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
    who = { key: "teacher", name: "Teacher", video: true, owner: true };
  } else {
    var name = cleanName(data.name);
    if (!name) return reply({ ok: false, error: "bad-name" });
    if (!studentAllowed(name, data.token)) return reply({ ok: false, error: "wrong-pin" });
    var seat = liveSeat(live, name, data.email);
    if (seat < 0) return reply({ ok: false, error: "not-joined" });
    if (seat >= CALL_MAX_PEOPLE - 1) return reply({ ok: false, error: "call-full" }); // one place is the teacher's
    who = { key: nameKey(name) + "|" + String(data.email || "").trim().toLowerCase().slice(0, 120), name: name, video: seat < VIDEO_SEATS, owner: false };
  }
  var found = liveRoom();
  if (found.error) return reply({ ok: false, error: found.error });
  var room = found.room;
  if (room.exp * 1000 <= Date.now()) return reply({ ok: false, error: "time-up" });
  // A token is kept for the class, so reloading the page doesn't ask Daily again.
  var cache = CacheService.getScriptCache();
  var cacheKey = "callToken|" + room.name + "|" + who.key;
  var token = cache.get(cacheKey);
  if (!token) {
    var made = daily("post", "meeting-tokens", {
      properties: {
        room_name: room.name,
        user_name: who.name,
        // "v-" marks someone with video, so every page knows whose picture to show.
        user_id: (who.video ? "v-" : "a-") + sha(secret() + "|call|" + who.key).slice(0, 20),
        is_owner: who.owner,
        exp: room.exp,
        start_audio_off: !who.owner,
        start_video_off: !who.owner,
        enable_screenshare: false,
        permissions: { canSend: who.video ? ["audio", "video"] : ["audio"] }
      }
    });
    if (!made || !made.token) return reply({ ok: false, error: "video-failed" });
    token = made.token;
    cache.put(cacheKey, token, 21600);
  }
  return reply({
    ok: true, url: room.url, token: token, video: who.video, seats: VIDEO_SEATS, sessionId: live.sessionId,
    endsAt: room.exp * 1000, shortened: !!room.shortened // shortened: the minutes left this month end it early
  });
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
// Newer columns go last so sheets made before them keep their columns.
var STUDENTS_HEADERS = ["Joined", "Name", "Key", "PIN", "Email", "Country", "Time zone", "Invited by"];
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
    s.getRange(1, 1, 1, STUDENTS_HEADERS.length).setValues([STUDENTS_HEADERS]); // older sheet: add the newer headers
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
  var ref = String(data.ref || "").trim().toLowerCase(); // from a classmate's Share link
  if (!/^[0-9a-f]{8}$/.test(ref)) ref = "";

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
      var invitedBy = ref ? inviterOf(ref, key) : "";
      studentsSheet().appendRow([new Date(), safe(name, 60), safe(key, 60), hash, safe(email, 120), "", "", safe(invitedBy, 60)]);
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
    if (out.ok && student) logSignIn(student.name);
  });
  return reply(out);
}

/* ---------- Invites ----------
   Each student's Share link ends in ?ref= and their invite code, made from
   their name so nothing new is stored. A friend who signs up for the first
   time through it gets the student's name in "Invited by" on Students. */

function inviteCodeOf(key) {
  return sha(secret() + "|invite|" + key).slice(0, 8);
}

// The student whose invite code this is, or "" (not someone inviting themselves).
function inviterOf(code, newKey) {
  var rows = studentsSheet().getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var key = String(rows[i][2]).replace(/^'/, "");
    if (key && key !== newKey && inviteCodeOf(key) === code) return String(rows[i][1]).replace(/^'/, "");
  }
  return "";
}

// A signed-in student's own invite code, for their Share link.
function inviteCode(data) {
  var key = nameKey(data.name);
  if (!key) return reply({ ok: false, error: "bad-request" });
  if (!studentAllowed(data.name, data.token)) return reply({ ok: false, error: "sign-in" });
  if (!findStudent(key)) return reply({ ok: false, error: "not-found" });
  return reply({ ok: true, code: inviteCodeOf(key) });
}

/* ---------- Sign-ins ----------
   Each time a student signs in again (on another device, or after signing
   out), a line goes on the "Sign-ins" sheet, for Recent activity on the
   Teacher page. A student's first sign-in is the Joined date on Students. */

var SIGNIN_SHEET = "Sign-ins";
var SIGNIN_HEADERS = ["When", "Student"];
var RECENT_ROWS = 200; // the Teacher page gets only the latest sign-ins and class joins

// Call it inside withLock.
function logSignIn(name) {
  namedSheet(SIGNIN_SHEET, SIGNIN_HEADERS).appendRow([new Date(), safe(name, 60)]);
}

// The newest rows of a sheet that only grows, at most RECENT_ROWS, oldest first,
// without reading the rest of the sheet.
function latestRows(s) {
  var last = s.getLastRow();
  if (last < 2) return [];
  var first = Math.max(2, last - RECENT_ROWS + 1);
  return s.getRange(first, 1, last - first + 1, s.getLastColumn()).getValues();
}

// The time zone the student's browser reports, and the country it is in. The
// site sends it after signing in, and again whenever the time zone changes.
// It's the device's clock setting, not its exact location.
function savePlace(data) {
  var key = nameKey(data.name);
  var timeZone = String(data.timeZone || "").trim();
  if (!key || !/^[A-Za-z0-9_+\-\/]{1,60}$/.test(timeZone)) return reply({ ok: false, error: "bad-request" });
  if (!studentAllowed(data.name, data.token)) return reply({ ok: false, error: "sign-in" });
  var saved = false;
  withLock(function () {
    var student = findStudent(key);
    if (!student) return;
    studentsSheet().getRange(student.row, 6, 1, 2).setValues([[safe(countryOf(timeZone), 60), safe(timeZone, 60)]]);
    saved = true;
  });
  return reply({ ok: true, saved: saved });
}

// The country of a time zone, or "" for one that isn't a country's (like UTC).
function countryOf(timeZone) {
  for (var i = 0; i < COUNTRY_ZONES.length; i++) {
    var parts = COUNTRY_ZONES[i].split("|");
    if ((" " + parts[2] + " ").indexOf(" " + timeZone + " ") >= 0) return parts[1];
  }
  return "";
}

// The two-letter code of a country saved by countryOf (for its flag), or "".
function countryCode(country) {
  for (var i = 0; i < COUNTRY_ZONES.length; i++) {
    var parts = COUNTRY_ZONES[i].split("|");
    if (parts[1] === country) return parts[0];
  }
  return "";
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
    // The script doesn't know which language the student uses, so this one is
    // in English, Spanish and Portuguese.
    MailApp.sendEmail({
      to: student.email,
      subject: "Hebrew Class: your temporary PIN / Clase de hebreo: tu PIN temporal / Aula de hebraico: seu PIN temporário",
      body: "Hello " + student.name + ",\n\n" +
        "Your teacher has reset your Hebrew Class PIN. Your temporary PIN is: " + temp + "\n\n" +
        "Sign in" + (site ? " at " + site : "") + " with your name and this PIN, then choose your own PIN. " +
        "Your old PIN no longer works. Your scores are kept.\n\n" +
        "---\n\n" +
        "Hola, " + student.name + ":\n\n" +
        "Tu docente restableció tu PIN de la Clase de hebreo. Tu PIN temporal es: " + temp + "\n\n" +
        "Entra" + (site ? " en " + site : "") + " con tu nombre y este PIN, y luego elige tu propio PIN. " +
        "Tu PIN anterior ya no funciona. Tus puntuaciones se conservan.\n\n" +
        "---\n\n" +
        "Olá, " + student.name + "!\n\n" +
        "Seu professor redefiniu seu PIN da Aula de hebraico. Seu PIN temporário é: " + temp + "\n\n" +
        "Entre" + (site ? " em " + site : "") + " com seu nome e este PIN e depois escolha seu próprio PIN. " +
        "Seu PIN antigo não funciona mais. Suas pontuações continuam salvas.\n"
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
    // In Spanish or Portuguese when the student asked from the site in that language.
    MailApp.sendEmail(data.lang === "pt" ? {
      to: student.email,
      subject: "Aula de hebraico: seu código para trocar o PIN",
      body: "Olá, " + student.name + "!\n\n" +
        "Seu código para escolher um novo PIN da Aula de hebraico é: " + code + "\n\n" +
        "Ele vale por " + CODE_MINUTES + " minutos. Se você não pediu, pode ignorar este e-mail; seu PIN continua o mesmo.\n"
    } : data.lang === "es" ? {
      to: student.email,
      subject: "Clase de hebreo: tu código para cambiar el PIN",
      body: "Hola, " + student.name + ":\n\n" +
        "Tu código para elegir un PIN nuevo de la Clase de hebreo es: " + code + "\n\n" +
        "Sirve durante " + CODE_MINUTES + " minutos. Si no lo pediste, puedes ignorar este correo; tu PIN sigue igual.\n"
    } : {
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
    logSignIn(student.name);
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
  boardPointsChanged();
  return reply({ ok: true });
}

// Everything the Teacher page shows: all quiz results, all practice, all
// students (with a temporary PIN not used yet), the PIN changes, and the
// latest sign-ins and live class joins.
function listResults(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var students = dataRows(studentsSheet()).map(function (r) {
    return { name: unsafe(r[1]), joinedAt: isoDate(r[0]), hasPin: !!r[3], tempPinSent: !!tempPinOf(r[3]), email: unsafe(r[4]),
      country: unsafe(r[5]), countryCode: countryCode(unsafe(r[5])), timeZone: unsafe(r[6]), invitedBy: unsafe(r[7]) };
  });
  var pinChanges = dataRows(namedSheet(PIN_LOG_SHEET, PIN_LOG_HEADERS)).map(function (r) {
    return { at: isoDate(r[0]), student: unsafe(r[1]), change: unsafe(r[2]) };
  });
  var signIns = latestRows(namedSheet(SIGNIN_SHEET, SIGNIN_HEADERS)).map(function (r) {
    return { at: isoDate(r[0]), student: unsafe(r[1]) };
  });
  // The latest class joins, and everyone who ever joined a class, each once
  // (for the number of students). Older rows have no name, only the email.
  var attendance = dataRows(attendanceSheet());
  var classes = attendance.slice(-RECENT_ROWS).map(function (r) {
    return { at: isoDate(r[0]), student: unsafe(r[4]) || unsafe(r[1]), lessonId: String(r[2]), classId: String(r[3]) };
  });
  var classNames = {};
  attendance.forEach(function (r) {
    var name = cleanName(unsafe(r[4]) || unsafe(r[1]));
    if (name) classNames[nameKey(name)] = name;
  });
  return reply({ ok: true, results: readResults(), practice: readPractice(), students: students, pinChanges: pinChanges,
    signIns: signIns, classes: classes, classNames: Object.keys(classNames).map(function (key) { return classNames[key]; }) });
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
  boardPointsChanged();
  return reply({ ok: true });
}

/* ---------- Suggestions box ---------- */

var SUGGESTIONS_SHEET = "Suggestions";
// "Only teacher" is last so sheets made before it was added keep their columns.
var SUGGESTIONS_HEADERS = ["ID", "When", "Student", "Suggestion", "Response", "Responded", "Only teacher"];

function suggestionsSheet() {
  var s = namedSheet(SUGGESTIONS_SHEET, SUGGESTIONS_HEADERS);
  if (s.getLastColumn() < SUGGESTIONS_HEADERS.length) {
    s.getRange(1, 1, 1, SUGGESTIONS_HEADERS.length).setValues([SUGGESTIONS_HEADERS]); // older sheet: add the newer header
  }
  return s;
}

// Everyone in the class can read the suggestions and the teacher's responses,
// except one a student sent only to the teacher ("Yes" under Only teacher):
// that one only the teacher and its student see (signed in, with their PIN if
// they have one). privateOk tells the site it can offer the choice.
function listSuggestions(data) {
  var teacher = isTeacher(data);
  var name = cleanName(data.name);
  var mine = !teacher && name && studentAllowed(name, data.token) ? nameKey(name) : "";
  var items = [];
  dataRows(suggestionsSheet()).forEach(function (r) {
    var onlyTeacher = String(r[6] || "") === "Yes";
    if (onlyTeacher && !teacher && (!mine || nameKey(unsafe(r[2])) !== mine)) return;
    items.push({
      id: String(r[0]),
      at: isoDate(r[1]),
      student: unsafe(r[2]),
      text: unsafe(r[3]),
      response: unsafe(r[4]),
      respondedAt: r[5] ? isoDate(r[5]) : "",
      onlyTeacher: onlyTeacher
    });
  });
  return reply({ ok: true, suggestions: items, privateOk: true });
}

// "suggestPrivate" sends it only to the teacher. It's an action of its own so
// that an older script, which doesn't know it, refuses it rather than showing
// it to everyone.
function saveSuggestion(data) {
  var name = cleanName(data.name);
  var text = String(data.text || "").trim();
  if (!name || !text) return reply({ ok: false, error: "bad-request" });
  if (!isTeacher(data) && !studentAllowed(name, data.token)) return reply({ ok: false, error: "sign-in" });
  var onlyTeacher = data.action === "suggestPrivate" ? "Yes" : "";
  withLock(function () {
    suggestionsSheet().appendRow([Utilities.getUuid(), new Date(), safe(name, 60), safe(text, 1000), "", "", onlyTeacher]);
  });
  return listSuggestions(data);
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
  return found ? listSuggestions(data) : reply({ ok: false, error: "not-found" });
}

/* ---------- Championship board ----------
   Points reward effort, week by week from Sunday to Saturday (in the
   spreadsheet's time zone):
   - 1 point per correct quiz answer, counting the best try at each quiz that week
   - 2 points per day the Word of the day was practised
   - 10 points per live class joined
   Everyone sees last week's champion and this week's top 3; a signed-in student
   also sees their own points and where they came from. Only names and points
   leave the script (the breakdown goes only to that signed-in student). The
   teacher can hide a name (a test name, or a student who'd rather not appear):
   it stays off the board everyone sees. */

var POINTS_PER_PRACTICE = 2;
var POINTS_PER_CLASS = 10;
var BOARD_PLACES = 3;          // places shown; everyone tied for a place is shown...
var BOARD_MAX_NAMES = 5;       // ...up to this many names
var BOARD_HIDDEN = "boardHidden";
var BOARD_CACHE = "boardPoints";
var BOARD_CACHE_SECONDS = 60;  // students load the board often; the sheets are read at most once a minute...
var BOARD_VERSION = "boardVersion"; // ...unless someone's points changed since: then straight away

function board(data) {
  var teacher = isTeacher(data);
  if (data.passcode && !teacher) return reply({ ok: false, error: "wrong-passcode" });
  var points = teacher ? boardPoints() : cachedBoardPoints();
  var hidden = boardHidden();

  if (teacher) {
    // Everyone the sheets know, with both weeks' points, to hide or show names.
    var list = {};
    var add = function (key, name) {
      if (key && !list[key]) list[key] = { name: name, points: 0, lastWeek: 0, hidden: !!hidden[key] };
    };
    Object.keys(points.names).forEach(function (key) { add(key, points.names[key]); });
    points.thisWeek.forEach(function (s) { add(s.key, s.name); list[s.key].points = s.points; });
    points.lastWeek.forEach(function (s) { add(s.key, s.name); list[s.key].lastWeek = s.points; });
    var students = Object.keys(list).map(function (key) { return list[key]; }).sort(function (a, b) {
      return b.points - a.points || b.lastWeek - a.lastWeek || byName(a, b);
    });
    return reply({ ok: true, weekStart: points.thisStart, students: students });
  }

  function shown(list) { return list.filter(function (s) { return !hidden[s.key]; }); }
  function plain(list) { return list.map(function (s) { return { name: s.name, points: s.points, place: s.place }; }); }
  var last = placed(shown(points.lastWeek));
  var champions = last.filter(function (s) { return s.place === 1; }).slice(0, BOARD_MAX_NAMES);
  var leaders = placed(shown(points.thisWeek)).filter(function (s) { return s.place <= BOARD_PLACES; }).slice(0, BOARD_MAX_NAMES);
  var me = null;
  var key = nameKey(data.name);
  if (key && studentAllowed(data.name, data.token)) {
    var mine = points.thisWeek.filter(function (s) { return s.key === key; })[0];
    // hidden: the student's name is off the board, so the page can say why they aren't on it.
    me = { points: mine ? mine.points : 0, parts: mine ? mine.parts : null, hidden: !!hidden[key] };
  }
  return reply({ ok: true, weekStart: points.thisStart, champions: plain(champions), leaders: plain(leaders), me: me });
}

// Most points first; equal points share a place (1, 2, 2, 4).
function placed(list) {
  return list.map(function (s, i) {
    var place = i + 1;
    while (place > 1 && list[place - 2].points === s.points) place -= 1;
    return { key: s.key, name: s.name, points: s.points, place: place };
  });
}

function byName(a, b) {
  var x = a.name.toLowerCase(), y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

// The teacher hides a name from the board everyone sees, or shows it again.
function boardHide(data) {
  if (!isTeacher(data)) return reply({ ok: false, error: "wrong-passcode" });
  var key = nameKey(data.name);
  if (!key) return reply({ ok: false, error: "bad-request" });
  withLock(function () {
    var hidden = boardHidden();
    if (data.hidden) hidden[key] = true;
    else delete hidden[key];
    PropertiesService.getScriptProperties().setProperty(BOARD_HIDDEN, JSON.stringify(hidden));
  });
  return board({ passcode: data.passcode });
}

// { key: true } for each hidden name.
function boardHidden() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty(BOARD_HIDDEN) || "{}");
  } catch (err) {
    return {};
  }
}

// The saved board is used only if no quiz, practice or class join came in
// since it was worked out (each one changes the version).
function cachedBoardPoints() {
  var cache = CacheService.getScriptCache();
  var got = cache.getAll([BOARD_CACHE, BOARD_VERSION]);
  var version = got[BOARD_VERSION] || "";
  if (got[BOARD_CACHE]) {
    var saved = JSON.parse(got[BOARD_CACHE]);
    if (saved.version === version) return saved.points;
  }
  var points = boardPoints();
  try {
    cache.put(BOARD_CACHE, JSON.stringify({ version: version, points: points }), BOARD_CACHE_SECONDS);
  } catch (err) { /* too big to keep: read again next time */ }
  return points;
}

// Someone's points changed: the next board read works them out again.
function boardPointsChanged() {
  try {
    CacheService.getScriptCache().put(BOARD_VERSION, Date.now() + "-" + Math.random(), 21600);
  } catch (err) { /* the saved board runs out within a minute anyway */ }
}

// "2026-11-15" moved by n days.
function dayPlus(day, n) {
  var d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Everyone's points this week and last week, most first:
// { thisStart, lastStart, thisWeek: [{ key, name, points, parts }], lastWeek: [...], names: { key: name } }
// parts: { quizzes, quizPoints, days, practicePoints, classes, classPoints }
function boardPoints(now) {
  now = now || new Date();
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var today = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  var thisStart = dayPlus(today, -new Date(today + "T00:00:00Z").getUTCDay()); // the Sunday
  var lastStart = dayPlus(thisStart, -7);
  var oldest = now.getTime() - 16 * 86400000; // anything older is before last week

  function localDay(value) {
    if (value instanceof Date) return value.getTime() < oldest ? "" : Utilities.formatDate(value, tz, "yyyy-MM-dd");
    return String(value || "").replace(/^'/, "");
  }
  function weekOf(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    return day >= thisStart ? "current" : day >= lastStart ? "last" : null;
  }

  // The name as the student first signed in, so "dana" and "Dana" are one person.
  var names = {};
  dataRows(studentsSheet()).forEach(function (r) {
    var name = cleanName(unsafe(r[1]).replace(/^'/, ""));
    if (name) names[nameKey(name)] = name;
  });

  var weeks = { current: {}, last: {} };
  function entry(day, rawName) {
    var week = weekOf(day);
    var name = cleanName(unsafe(rawName).replace(/^'/, ""));
    if (!week || !name) return null;
    var key = nameKey(name);
    var w = weeks[week];
    return w[key] || (w[key] = { key: key, name: names[key] || name, quizzes: {}, days: {}, classes: {} });
  }

  // Quiz results: the best score at each quiz.
  dataRows(sheet()).forEach(function (r) {
    var e = entry(localDay(r[0]), r[1]);
    if (!e) return;
    var quiz = String(r[2]) + "|" + (Number(r[8]) || 0);
    e.quizzes[quiz] = Math.max(e.quizzes[quiz] || 0, Number(r[4]) || 0);
  });
  // Word of the day: each word once, in the week it was practised (a student
  // can catch up on the past week's words, like retaking an older quiz).
  dataRows(practiceSheet()).forEach(function (r) {
    var e = entry(localDay(r[0]), r[1]);
    if (e) e.days[dayText(r[2])] = true;
  });
  // Live classes: each class once.
  dataRows(attendanceSheet()).forEach(function (r) {
    var e = entry(localDay(r[0]), r[4]);
    if (e && r[3]) e.classes[String(r[3])] = true;
  });

  function totals(w) {
    return Object.keys(w).map(function (key) {
      var e = w[key];
      var quizzes = Object.keys(e.quizzes);
      var days = Object.keys(e.days).length;
      var classes = Object.keys(e.classes).length;
      var parts = {
        quizzes: quizzes.length,
        quizPoints: quizzes.reduce(function (n, q) { return n + e.quizzes[q]; }, 0),
        days: days,
        practicePoints: POINTS_PER_PRACTICE * days,
        classes: classes,
        classPoints: POINTS_PER_CLASS * classes
      };
      var points = parts.quizPoints + parts.practicePoints + parts.classPoints;
      return { key: key, name: e.name, points: points, parts: parts };
    }).filter(function (s) { return s.points > 0; }).sort(function (a, b) { return b.points - a.points || byName(a, b); });
  }
  return { thisStart: thisStart, lastStart: lastStart, thisWeek: totals(weeks.current), lastWeek: totals(weeks.last), names: names };
}

/* ---------- How to say ----------
   Google's translator, built into Apps Script. Short phrases only. Answers
   are remembered for six hours, so a repeated phrase doesn't count against
   the script's daily translation allowance. */

function translate(data) {
  var text = String(data.text || "").trim().replace(/\s+/g, " ").slice(0, 80);
  if (!text) return reply({ ok: false, error: "bad-request" });
  // From English, or from Spanish or Portuguese when the site is used in that
  // language. The reply says which, so the site knows this script understands it.
  var from = data.from === "es" || data.from === "pt" ? data.from : "en";
  var cache = CacheService.getScriptCache();
  var cacheKey = "tr:" + (from === "en" ? "" : from + ":") + sha(text.toLowerCase());
  var hebrew = cache.get(cacheKey);
  if (!hebrew) {
    try {
      hebrew = LanguageApp.translate(text, from, "he");
    } catch (err) {
      return reply({ ok: false, error: "translate-failed" });
    }
    if (hebrew) cache.put(cacheKey, hebrew, 21600);
  }
  return reply({ ok: true, text: text, hebrew: hebrew, from: from });
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

/* ---------- Countries ----------
   Each line is a country's two-letter code (for its flag), its name, then the
   time zones in it, from the IANA time zone database (2026f), with the older
   names some browsers still report (Asia/Calcutta, US/Eastern, Israel...).
   Used by savePlace and the Teacher page. */

var COUNTRY_ZONES = [
  "AF|Afghanistan|Asia/Kabul",
  "AX|Åland Islands|Europe/Mariehamn",
  "AL|Albania|Europe/Tirane",
  "DZ|Algeria|Africa/Algiers",
  "AS|American Samoa|Pacific/Pago_Pago Pacific/Samoa US/Samoa",
  "AD|Andorra|Europe/Andorra",
  "AO|Angola|Africa/Luanda",
  "AI|Anguilla|America/Anguilla",
  "AQ|Antarctica|Antarctica/Casey Antarctica/Davis Antarctica/DumontDUrville Antarctica/Mawson Antarctica/McMurdo Antarctica/Palmer Antarctica/Rothera Antarctica/Syowa Antarctica/Troll Antarctica/Vostok",
  "AG|Antigua & Barbuda|America/Antigua",
  "AR|Argentina|America/Argentina/Buenos_Aires America/Argentina/Catamarca America/Argentina/ComodRivadavia America/Argentina/Cordoba America/Argentina/Jujuy America/Argentina/La_Rioja America/Argentina/Mendoza America/Argentina/Rio_Gallegos America/Argentina/Salta America/Argentina/San_Juan America/Argentina/San_Luis America/Argentina/Tucuman America/Argentina/Ushuaia America/Buenos_Aires America/Catamarca America/Cordoba America/Jujuy America/Mendoza America/Rosario",
  "AM|Armenia|Asia/Yerevan",
  "AW|Aruba|America/Aruba",
  "AU|Australia|Antarctica/Macquarie Australia/ACT Australia/Adelaide Australia/Brisbane Australia/Broken_Hill Australia/Canberra Australia/Currie Australia/Darwin Australia/Eucla Australia/Hobart Australia/LHI Australia/Lindeman Australia/Lord_Howe Australia/Melbourne Australia/NSW Australia/North Australia/Perth Australia/Queensland Australia/South Australia/Sydney Australia/Tasmania Australia/Victoria Australia/West Australia/Yancowinna",
  "AT|Austria|Europe/Vienna",
  "AZ|Azerbaijan|Asia/Baku",
  "BS|Bahamas|America/Nassau",
  "BH|Bahrain|Asia/Bahrain",
  "BD|Bangladesh|Asia/Dacca Asia/Dhaka",
  "BB|Barbados|America/Barbados",
  "BY|Belarus|Europe/Minsk",
  "BE|Belgium|CET Europe/Brussels MET",
  "BZ|Belize|America/Belize",
  "BJ|Benin|Africa/Porto-Novo",
  "BM|Bermuda|Atlantic/Bermuda",
  "BT|Bhutan|Asia/Thimbu Asia/Thimphu",
  "BO|Bolivia|America/La_Paz",
  "BA|Bosnia & Herzegovina|Europe/Sarajevo",
  "BW|Botswana|Africa/Gaborone",
  "BR|Brazil|America/Araguaina America/Bahia America/Belem America/Boa_Vista America/Campo_Grande America/Cuiaba America/Eirunepe America/Fortaleza America/Maceio America/Manaus America/Noronha America/Porto_Acre America/Porto_Velho America/Recife America/Rio_Branco America/Santarem America/Sao_Paulo Brazil/Acre Brazil/DeNoronha Brazil/East Brazil/West",
  "IO|British Indian Ocean Territory|Indian/Chagos",
  "VG|British Virgin Islands|America/Tortola",
  "BN|Brunei|Asia/Brunei",
  "BG|Bulgaria|Europe/Sofia",
  "BF|Burkina Faso|Africa/Ouagadougou",
  "BI|Burundi|Africa/Bujumbura",
  "KH|Cambodia|Asia/Phnom_Penh",
  "CM|Cameroon|Africa/Douala",
  "CA|Canada|America/Atikokan America/Blanc-Sablon America/Cambridge_Bay America/Creston America/Dawson America/Dawson_Creek America/Edmonton America/Fort_Nelson America/Glace_Bay America/Goose_Bay America/Halifax America/Inuvik America/Iqaluit America/Moncton America/Montreal America/Nipigon America/Pangnirtung America/Rainy_River America/Rankin_Inlet America/Regina America/Resolute America/St_Johns America/Swift_Current America/Thunder_Bay America/Toronto America/Vancouver America/Whitehorse America/Winnipeg America/Yellowknife Canada/Atlantic Canada/Central Canada/Eastern Canada/Mountain Canada/Newfoundland Canada/Pacific Canada/Saskatchewan Canada/Yukon",
  "CV|Cape Verde|Atlantic/Cape_Verde",
  "BQ|Caribbean Netherlands|America/Kralendijk",
  "KY|Cayman Islands|America/Cayman",
  "CF|Central African Republic|Africa/Bangui",
  "TD|Chad|Africa/Ndjamena",
  "CL|Chile|America/Coyhaique America/Punta_Arenas America/Santiago Chile/Continental Chile/EasterIsland Pacific/Easter",
  "CN|China|Asia/Chongqing Asia/Chungking Asia/Harbin Asia/Kashgar Asia/Shanghai Asia/Urumqi PRC",
  "CX|Christmas Island|Indian/Christmas",
  "CC|Cocos (Keeling) Islands|Indian/Cocos",
  "CO|Colombia|America/Bogota",
  "KM|Comoros|Indian/Comoro",
  "CG|Congo - Brazzaville|Africa/Brazzaville",
  "CD|Congo - Kinshasa|Africa/Kinshasa Africa/Lubumbashi",
  "CK|Cook Islands|Pacific/Rarotonga",
  "CR|Costa Rica|America/Costa_Rica",
  "CI|Côte d’Ivoire|Africa/Abidjan Africa/Timbuktu Iceland",
  "HR|Croatia|Europe/Zagreb",
  "CU|Cuba|America/Havana Cuba",
  "CW|Curaçao|America/Curacao",
  "CY|Cyprus|Asia/Famagusta Asia/Nicosia Europe/Nicosia",
  "CZ|Czechia|Europe/Prague",
  "DK|Denmark|Europe/Copenhagen",
  "DJ|Djibouti|Africa/Djibouti",
  "DM|Dominica|America/Dominica",
  "DO|Dominican Republic|America/Santo_Domingo",
  "EC|Ecuador|America/Guayaquil Pacific/Galapagos",
  "EG|Egypt|Africa/Cairo Egypt",
  "SV|El Salvador|America/El_Salvador",
  "GQ|Equatorial Guinea|Africa/Malabo",
  "ER|Eritrea|Africa/Asmara",
  "EE|Estonia|Europe/Tallinn",
  "SZ|Eswatini|Africa/Mbabane",
  "ET|Ethiopia|Africa/Addis_Ababa",
  "FK|Falkland Islands|Atlantic/Stanley",
  "FO|Faroe Islands|Atlantic/Faeroe Atlantic/Faroe",
  "FJ|Fiji|Pacific/Fiji",
  "FI|Finland|Europe/Helsinki",
  "FR|France|Europe/Paris",
  "GF|French Guiana|America/Cayenne",
  "PF|French Polynesia|Pacific/Gambier Pacific/Marquesas Pacific/Tahiti",
  "TF|French Southern Territories|Indian/Kerguelen",
  "GA|Gabon|Africa/Libreville",
  "GM|Gambia|Africa/Banjul",
  "GE|Georgia|Asia/Tbilisi",
  "DE|Germany|Atlantic/Jan_Mayen Europe/Berlin Europe/Busingen",
  "GH|Ghana|Africa/Accra",
  "GI|Gibraltar|Europe/Gibraltar",
  "GR|Greece|EET Europe/Athens",
  "GL|Greenland|America/Danmarkshavn America/Godthab America/Nuuk America/Scoresbysund America/Thule",
  "GD|Grenada|America/Grenada",
  "GP|Guadeloupe|America/Guadeloupe",
  "GU|Guam|Pacific/Guam",
  "GT|Guatemala|America/Guatemala",
  "GG|Guernsey|Europe/Guernsey",
  "GN|Guinea|Africa/Conakry",
  "GW|Guinea-Bissau|Africa/Bissau",
  "GY|Guyana|America/Guyana",
  "HT|Haiti|America/Port-au-Prince",
  "HN|Honduras|America/Tegucigalpa",
  "HK|Hong Kong SAR China|Asia/Hong_Kong Hongkong",
  "HU|Hungary|Europe/Budapest",
  "IS|Iceland|Atlantic/Reykjavik",
  "IN|India|Asia/Calcutta Asia/Kolkata",
  "ID|Indonesia|Asia/Jakarta Asia/Jayapura Asia/Makassar Asia/Pontianak Asia/Ujung_Pandang",
  "IR|Iran|Asia/Tehran Iran",
  "IQ|Iraq|Asia/Baghdad",
  "IE|Ireland|Eire Europe/Dublin",
  "IM|Isle of Man|Europe/Isle_of_Man",
  "IL|Israel|Asia/Jerusalem Asia/Tel_Aviv Israel",
  "IT|Italy|Europe/Rome",
  "JM|Jamaica|America/Jamaica Jamaica",
  "JP|Japan|Asia/Tokyo Japan",
  "JE|Jersey|Europe/Jersey",
  "JO|Jordan|Asia/Amman",
  "KZ|Kazakhstan|Asia/Almaty Asia/Aqtau Asia/Aqtobe Asia/Atyrau Asia/Oral Asia/Qostanay Asia/Qyzylorda",
  "KE|Kenya|Africa/Asmera Africa/Nairobi",
  "KI|Kiribati|Pacific/Enderbury Pacific/Kanton Pacific/Kiritimati Pacific/Tarawa",
  "KW|Kuwait|Asia/Kuwait",
  "KG|Kyrgyzstan|Asia/Bishkek",
  "LA|Laos|Asia/Vientiane",
  "LV|Latvia|Europe/Riga",
  "LB|Lebanon|Asia/Beirut",
  "LS|Lesotho|Africa/Maseru",
  "LR|Liberia|Africa/Monrovia",
  "LY|Libya|Africa/Tripoli Libya",
  "LI|Liechtenstein|Europe/Vaduz",
  "LT|Lithuania|Europe/Vilnius",
  "LU|Luxembourg|Europe/Luxembourg",
  "MO|Macao SAR China|Asia/Macao Asia/Macau",
  "MG|Madagascar|Indian/Antananarivo",
  "MW|Malawi|Africa/Blantyre",
  "MY|Malaysia|Asia/Kuala_Lumpur Asia/Kuching",
  "MV|Maldives|Indian/Maldives",
  "ML|Mali|Africa/Bamako",
  "MT|Malta|Europe/Malta",
  "MH|Marshall Islands|Kwajalein Pacific/Kwajalein Pacific/Majuro",
  "MQ|Martinique|America/Martinique",
  "MR|Mauritania|Africa/Nouakchott",
  "MU|Mauritius|Indian/Mauritius",
  "YT|Mayotte|Indian/Mayotte",
  "MX|Mexico|America/Bahia_Banderas America/Cancun America/Chihuahua America/Ciudad_Juarez America/Ensenada America/Hermosillo America/Matamoros America/Mazatlan America/Merida America/Mexico_City America/Monterrey America/Ojinaga America/Santa_Isabel America/Tijuana Mexico/BajaNorte Mexico/BajaSur Mexico/General",
  "FM|Micronesia|Pacific/Chuuk Pacific/Kosrae Pacific/Pohnpei",
  "MD|Moldova|Europe/Chisinau Europe/Tiraspol",
  "MC|Monaco|Europe/Monaco",
  "MN|Mongolia|Asia/Choibalsan Asia/Hovd Asia/Ulaanbaatar Asia/Ulan_Bator",
  "ME|Montenegro|Europe/Podgorica",
  "MS|Montserrat|America/Montserrat",
  "MA|Morocco|Africa/Casablanca",
  "MZ|Mozambique|Africa/Maputo",
  "MM|Myanmar (Burma)|Asia/Rangoon Asia/Yangon",
  "NA|Namibia|Africa/Windhoek",
  "NR|Nauru|Pacific/Nauru",
  "NP|Nepal|Asia/Kathmandu Asia/Katmandu",
  "NL|Netherlands|Europe/Amsterdam",
  "NC|New Caledonia|Pacific/Noumea",
  "NZ|New Zealand|Antarctica/South_Pole NZ NZ-CHAT Pacific/Auckland Pacific/Chatham",
  "NI|Nicaragua|America/Managua",
  "NE|Niger|Africa/Niamey",
  "NG|Nigeria|Africa/Lagos",
  "NU|Niue|Pacific/Niue",
  "NF|Norfolk Island|Pacific/Norfolk",
  "KP|North Korea|Asia/Pyongyang",
  "MK|North Macedonia|Europe/Skopje",
  "MP|Northern Mariana Islands|Pacific/Saipan",
  "NO|Norway|Europe/Oslo",
  "OM|Oman|Asia/Muscat",
  "PK|Pakistan|Asia/Karachi",
  "PW|Palau|Pacific/Palau",
  "PS|Palestinian Territories|Asia/Gaza Asia/Hebron",
  "PA|Panama|America/Coral_Harbour America/Panama EST",
  "PG|Papua New Guinea|Pacific/Bougainville Pacific/Port_Moresby Pacific/Truk Pacific/Yap",
  "PY|Paraguay|America/Asuncion",
  "PE|Peru|America/Lima",
  "PH|Philippines|Asia/Manila",
  "PN|Pitcairn Islands|Pacific/Pitcairn",
  "PL|Poland|Europe/Warsaw Poland",
  "PT|Portugal|Atlantic/Azores Atlantic/Madeira Europe/Lisbon Portugal WET",
  "PR|Puerto Rico|America/Puerto_Rico America/Virgin",
  "QA|Qatar|Asia/Qatar",
  "RE|Réunion|Indian/Reunion",
  "RO|Romania|Europe/Bucharest",
  "RU|Russia|Asia/Anadyr Asia/Barnaul Asia/Chita Asia/Irkutsk Asia/Kamchatka Asia/Khandyga Asia/Krasnoyarsk Asia/Magadan Asia/Novokuznetsk Asia/Novosibirsk Asia/Omsk Asia/Sakhalin Asia/Srednekolymsk Asia/Tomsk Asia/Ust-Nera Asia/Vladivostok Asia/Yakutsk Asia/Yekaterinburg Europe/Astrakhan Europe/Kaliningrad Europe/Kirov Europe/Moscow Europe/Samara Europe/Saratov Europe/Ulyanovsk Europe/Volgograd W-SU",
  "RW|Rwanda|Africa/Kigali",
  "WS|Samoa|Pacific/Apia",
  "SM|San Marino|Europe/San_Marino",
  "ST|São Tomé & Príncipe|Africa/Sao_Tome",
  "SA|Saudi Arabia|Asia/Riyadh",
  "SN|Senegal|Africa/Dakar",
  "RS|Serbia|Europe/Belgrade",
  "SC|Seychelles|Indian/Mahe",
  "SL|Sierra Leone|Africa/Freetown",
  "SG|Singapore|Asia/Singapore Singapore",
  "SX|Sint Maarten|America/Lower_Princes",
  "SK|Slovakia|Europe/Bratislava",
  "SI|Slovenia|Europe/Ljubljana",
  "SB|Solomon Islands|Pacific/Guadalcanal Pacific/Ponape",
  "SO|Somalia|Africa/Mogadishu",
  "ZA|South Africa|Africa/Johannesburg",
  "GS|South Georgia & South Sandwich Islands|Atlantic/South_Georgia",
  "KR|South Korea|Asia/Seoul ROK",
  "SS|South Sudan|Africa/Juba",
  "ES|Spain|Africa/Ceuta Atlantic/Canary Europe/Madrid",
  "LK|Sri Lanka|Asia/Colombo",
  "BL|St. Barthélemy|America/St_Barthelemy",
  "SH|St. Helena|Atlantic/St_Helena",
  "KN|St. Kitts & Nevis|America/St_Kitts",
  "LC|St. Lucia|America/St_Lucia",
  "MF|St. Martin|America/Marigot",
  "PM|St. Pierre & Miquelon|America/Miquelon",
  "VC|St. Vincent & Grenadines|America/St_Vincent",
  "SD|Sudan|Africa/Khartoum",
  "SR|Suriname|America/Paramaribo",
  "SJ|Svalbard & Jan Mayen|Arctic/Longyearbyen",
  "SE|Sweden|Europe/Stockholm",
  "CH|Switzerland|Europe/Zurich",
  "SY|Syria|Asia/Damascus",
  "TW|Taiwan|Asia/Taipei ROC",
  "TJ|Tajikistan|Asia/Dushanbe",
  "TZ|Tanzania|Africa/Dar_es_Salaam",
  "TH|Thailand|Asia/Bangkok",
  "TL|Timor-Leste|Asia/Dili",
  "TG|Togo|Africa/Lome",
  "TK|Tokelau|Pacific/Fakaofo",
  "TO|Tonga|Pacific/Tongatapu",
  "TT|Trinidad & Tobago|America/Port_of_Spain",
  "TN|Tunisia|Africa/Tunis",
  "TR|Türkiye|Asia/Istanbul Europe/Istanbul Turkey",
  "TM|Turkmenistan|Asia/Ashgabat Asia/Ashkhabad",
  "TC|Turks & Caicos Islands|America/Grand_Turk",
  "TV|Tuvalu|Pacific/Funafuti",
  "UM|U.S. Outlying Islands|Pacific/Midway Pacific/Wake",
  "VI|U.S. Virgin Islands|America/St_Thomas",
  "UG|Uganda|Africa/Kampala",
  "UA|Ukraine|Europe/Kiev Europe/Kyiv Europe/Simferopol Europe/Uzhgorod Europe/Zaporozhye",
  "AE|United Arab Emirates|Asia/Dubai",
  "GB|United Kingdom|Europe/Belfast Europe/London GB GB-Eire",
  "US|United States|America/Adak America/Anchorage America/Atka America/Boise America/Chicago America/Denver America/Detroit America/Fort_Wayne America/Indiana/Indianapolis America/Indiana/Knox America/Indiana/Marengo America/Indiana/Petersburg America/Indiana/Tell_City America/Indiana/Vevay America/Indiana/Vincennes America/Indiana/Winamac America/Indianapolis America/Juneau America/Kentucky/Louisville America/Kentucky/Monticello America/Knox_IN America/Los_Angeles America/Louisville America/Menominee America/Metlakatla America/New_York America/Nome America/North_Dakota/Beulah America/North_Dakota/Center America/North_Dakota/New_Salem America/Phoenix America/Shiprock America/Sitka America/Yakutat HST MST Navajo Pacific/Honolulu Pacific/Johnston US/Alaska US/Aleutian US/Arizona US/Central US/East-Indiana US/Eastern US/Hawaii US/Indiana-Starke US/Michigan US/Mountain US/Pacific",
  "UY|Uruguay|America/Montevideo",
  "UZ|Uzbekistan|Asia/Samarkand Asia/Tashkent",
  "VU|Vanuatu|Pacific/Efate",
  "VA|Vatican City|Europe/Vatican",
  "VE|Venezuela|America/Caracas",
  "VN|Vietnam|Asia/Ho_Chi_Minh Asia/Saigon",
  "WF|Wallis & Futuna|Pacific/Wallis",
  "EH|Western Sahara|Africa/El_Aaiun",
  "YE|Yemen|Asia/Aden",
  "ZM|Zambia|Africa/Lusaka",
  "ZW|Zimbabwe|Africa/Harare"
];
