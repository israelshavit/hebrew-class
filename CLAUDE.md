# Hebrew Class

Static site for the teacher's weekly Hebrew class: per lesson, a printable one-page sheet and a quiz. Hosted on GitHub Pages. See README.md for the lesson format and results setup.

## Weekly workflow

The teacher gives Claude a YouTube link, a word list, or the Word/PDF they made. Claude:

1. Writes `lessons/YYYY-MM-DD-topic.js` (class date, short topic slug) in the format of the existing lesson files, with niqqud on all Hebrew, and the Spanish too: a fourth item on every row, and `es: { ... }` on the lesson and each section (title, subtitle, notes, explanation).
2. Adds it to `lessons/index.js`.
3. Checks the sheet is readable (the font shrinks to fit one page; below 10px it moves onto two or three pages, so a long lesson may need trimming or splitting) and that the quiz runs.
4. Shows the teacher the result before committing and pushing.

Every push (a lesson or any other change) also changes the version in `version.js`, to the date and time: pages left open on students' phones check it when they come back on screen and reload themselves to get the new files.

Claude can't watch videos. If a YouTube page or transcript can't be read, ask for the word list.

Check Hebrew carefully: gender agreement (e.g. רוֹצָה, not רוֹצַת), and that transliteration matches the Hebrew.

Spanish is neutral Latin American with "tú", and "docente" for the teacher. In a row's Spanish, write `(m/f)` for the speaker's gender and `(a él/ella)` for who is spoken to, and `cansado/a` where Spanish changes too (the quiz picks "cansado" or "cansada"). Two rows in a lesson must not share the same Spanish (e.g. "Mañana (el día siguiente)" and "La mañana"), or a quiz question is ambiguous.

## Tech

- Plain HTML, CSS, JavaScript. No frameworks or build step. Must work from `file://` too, so no ES modules or `fetch` for local data: lessons load as `<script>` files that call `HebrewClass.addLesson`.
- Insert lesson text with `textContent`, never `innerHTML`.
- The interface is in English or Spanish (menu in the top bar). Every text a student sees goes through `t("English text", { vars })`, and its Spanish goes in `lang/es.js` under the same English. On localhost the console warns about text with no Spanish. The Teacher page stays English. Quiz misses and practised words are saved in English, for the teacher.
- Chrome's Translate must never change the Hebrew. Give Hebrew `lang: "he"` (`el()` then adds `translate="no"`), put mixed text with Hebrew in it through `mixed()`, and mark transliteration and student names `translate: "no"`. In Spanish the whole page is `translate="no"`, and so is the Teacher page.
- Colours and radii use the CSS variables on `:root`. The printed sheet keeps the original Word document's look (blue header, light-blue section rows, Arial).
- `localStorage` only holds per-browser conveniences (who is signed in, the interface language, niqqud and transliteration toggles, whether today's word was practised, the last championship board seen, shown instantly while a fresh one loads, which time zone was last sent for the student's country, the invite code from a classmate's Share link until the first sign-in, the student's own invite code for their Share link, the name, email and class a student joined the live class with, and whether the live class videos are shown). Everything that must last lives in the Google Sheet.
- Everyone signs in first: students with a name and an optional PIN, the teacher with the passcode. The script stores only a hash of the PIN and hands the browser a token; once a name has a PIN, its report, scores, practice and suggestions need that token.
- Quiz results, Word of the day practice, suggestions and students go to the Google Apps Script URL in `config.js` (`results-sheet/Code.gs`), which stores them in the teacher's Google Sheet. Students read their own report (`#/progress`); the Teacher page (`#/teacher`) reads everything with the passcode and polls every 30 seconds. All calls are text/plain POSTs, because Apps Script doesn't answer CORS preflights.
- Students can add the site to their phone's home screen (`manifest.json`, the aleph icons in `icons/`, and the apple-* tags in `index.html`). Opened from the icon it is full screen and starts on the Word of the day (`openedFromHomeScreen` in `app.js`). There's no service worker, so `version.js` keeps the site up to date there too.
- The Word of the day comes from `words/daily-words.js` (single words on family and positivity, same row format as a lesson, niqqud required), not from the lessons.
- How to say uses Apps Script's built-in `LanguageApp.translate` (free, no niqqud) and the browser's speech recognition.
- An older deployed script answers `bad-request` to actions it doesn't know; the site treats that as "not switched on yet" and must keep working without the new actions.
- The Live class tab uses the same script: the teacher's current word is kept in the script cache (copied to script properties) and students poll it every few seconds; joins go to the Attendance sheet. Any `Code.gs` change needs the teacher to redeploy a new version.
- So a class isn't left running by mistake, as the teacher asked: every 30 minutes the teacher's page asks "Still teaching?" (a `<dialog>` outside `#app`, on any page) and ends the class if Continue isn't pressed within 10 minutes. The script keeps the time (`keptAt`, sent as `askIn`; Continue is `liveKeep`) and ends a forgotten class itself 2 minutes after that, in case the page was closed.
- The Live class video call uses Daily. The script makes a private room per class with the `DAILY_API_KEY` script property (never in the repository) and gives each person a token: the teacher and the first 10 students to join can send video ("v-" user IDs), the rest sound only. The page draws the call itself with Daily's call object (daily-js from unpkg, loaded only when a class has a call), so Show videos can hide videos while sound keeps playing. Without a key or with an older script, the call is just left out. Daily has no spending limit, so the script keeps calls within the free minutes itself: at most 20 people (teacher included) and 1 hour per call, as the teacher chose, and a ledger of the last 32 days' calls (script property `callLedger`) that shortens or skips a call so the total stays under 9,000 participant minutes (the test script has a `CALL_MINUTES_LIMIT` property of 600, since it shares the Daily account). Never loosen this without the teacher asking: they don't want to be charged. The teacher also sees a meter of this month's minutes on the whole Daily account (`callUsage`, added up from Daily's meeting records) against the free 10,000, on Live class and the Teacher page.
- The live site is in use by the students. Don't push until the teacher says a version is ready; they test first at `http://localhost:5180`. On localhost the site uses `testResultsUrl` in `config.js` (a test copy of the sheet, shown by a "Test data" badge), so testing never touches real data. When releasing a `Code.gs` change, the real script is redeployed first, then the site is pushed.
- The teacher's own copy of `results-sheet/Code.gs` on this computer has the real passcode on the `TEACHER_PASSCODE` line, the same for the test and production scripts, so it can be pasted into Apps Script as is. Never change that line in the file. Never commit it either: the repository is public, so the committed `Code.gs` keeps the `change-me` placeholder. When committing other `Code.gs` changes, stage everything except that line.
