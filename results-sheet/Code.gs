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
  return saveResult(data);
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
  if (TEACHER_PASSCODE === "change-me" || String(data.passcode || "") !== TEACHER_PASSCODE) {
    return reply({ ok: false, error: "wrong-passcode" });
  }
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
