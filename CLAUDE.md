# Hebrew Class

Static site for the teacher's weekly Hebrew class: per lesson, a printable one-page sheet and a quiz. Hosted on GitHub Pages. See README.md for the lesson format and results setup.

## Weekly workflow

The teacher gives Claude a YouTube link, a word list, or the Word/PDF they made. Claude:

1. Writes `lessons/YYYY-MM-DD-topic.js` (class date, short topic slug) in the format of the existing lesson files, with niqqud on all Hebrew.
2. Adds it to `lessons/index.js`.
3. Checks the sheet is readable (the font shrinks to fit one page; below 10px it moves onto two or three pages, so a long lesson may need trimming or splitting) and that the quiz runs.
4. Shows the teacher the result before committing and pushing.

Claude can't watch videos. If a YouTube page or transcript can't be read, ask for the word list.

Check Hebrew carefully: gender agreement (e.g. רוֹצָה, not רוֹצַת), and that transliteration matches the Hebrew.

## Tech

- Plain HTML, CSS, JavaScript. No frameworks or build step. Must work from `file://` too, so no ES modules or `fetch` for local data: lessons load as `<script>` files that call `HebrewClass.addLesson`.
- Insert lesson text with `textContent`, never `innerHTML`.
- Colours and radii use the CSS variables on `:root`. The printed sheet keeps the original Word document's look (blue header, light-blue section rows, Arial).
- `localStorage` only holds per-browser conveniences (who is signed in, niqqud toggle, whether today's word was practised). Everything that must last lives in the Google Sheet.
- Everyone signs in first: students with a name and an optional PIN, the teacher with the passcode. The script stores only a hash of the PIN and hands the browser a token; once a name has a PIN, its report, scores, practice and suggestions need that token.
- Quiz results, Word of the day practice, suggestions and students go to the Google Apps Script URL in `config.js` (`results-sheet/Code.gs`), which stores them in the teacher's Google Sheet. Students read their own report (`#/progress`); the Teacher page (`#/teacher`) reads everything with the passcode and polls every 30 seconds. All calls are text/plain POSTs, because Apps Script doesn't answer CORS preflights.
- The Word of the day comes from `words/daily-words.js` (single words on family and positivity, same row format as a lesson, niqqud required), not from the lessons.
- How to say uses Apps Script's built-in `LanguageApp.translate` (free, no niqqud) and the browser's speech recognition.
- An older deployed script answers `bad-request` to actions it doesn't know; the site treats that as "not switched on yet" and must keep working without the new actions.
- The Live class tab uses the same script: the teacher's current word is kept in the script cache (copied to script properties) and students poll it every few seconds; joins go to the Attendance sheet. Any `Code.gs` change needs the teacher to redeploy a new version.
- The live site is in use by the students. Don't push until the teacher says a version is ready; they test first at `http://localhost:5180`. On localhost the site uses `testResultsUrl` in `config.js` (a test copy of the sheet, shown by a "Test data" badge), so testing never touches real data. When releasing a `Code.gs` change, the real script is redeployed first, then the site is pushed.
- Never commit the real teacher passcode; `Code.gs` in the repo keeps the `change-me` placeholder.
