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
- `localStorage` only holds per-browser conveniences (student name, niqqud toggle).
- Quiz results go to the Google Apps Script URL in `config.js` (`results-sheet/Code.gs`), which stores them in the teacher's Google Sheet. The Teacher page (`#/teacher`) reads them back with a passcode and polls every 30 seconds. All calls are text/plain POSTs, because Apps Script doesn't answer CORS preflights.
- The Live class tab uses the same script: the teacher's current word is kept in the script cache (copied to script properties) and students poll it every few seconds; joins go to the Attendance sheet. Any `Code.gs` change needs the teacher to redeploy a new version.
- Never commit the real teacher passcode; `Code.gs` in the repo keeps the `change-me` placeholder.
