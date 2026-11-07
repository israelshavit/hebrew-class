// Google Apps Script that records Hebrew Class quiz results in this spreadsheet.
// Setup steps are in README.md ("Getting quiz results").

var SHEET_NAME = "Results";
var HEADERS = ["Finished", "Student", "Lesson", "Score", "Out of", "Percent", "Phrases missed"];

function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  var score = Number(data.score) || 0;
  var total = Number(data.total) || 0;
  sheet.appendRow([
    new Date(),
    safe(data.student, 60),
    safe(data.lessonTitle || data.lessonId, 120),
    score,
    total,
    total ? Math.round((score / total) * 100) + "%" : "",
    safe(data.missed, 2000)
  ]);
  return ContentService.createTextOutput("ok");
}

// Plain text only: stops a name like "=HYPERLINK(...)" becoming a formula.
function safe(value, maxLength) {
  var text = String(value || "").slice(0, maxLength);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
