# Hebrew Class

A small website for a weekly Hebrew class. Each lesson has:

- **Lesson sheet**: a one-page table (English, transliteration, Hebrew) that students print or save as a PDF. The font size shrinks automatically so it always fits on one A4 page.
- **Word by word**: one phrase per screen with a listen button, for practising alone.
- **Quiz**: English → Hebrew multiple choice, then matching rounds, built from that lesson's phrases. Scores can be sent to the teacher's Google Sheet.
- **Live class**: the teacher steps through the words during an online class and every student who joined sees the same word.

There is no build step. Open `index.html` in a browser to try it locally.

## Adding a lesson

1. Copy a file in `lessons/` and name it `YYYY-MM-DD-topic.js`.
2. Fill in its rows. A row is `["English", "Transliteration", "Hebrew"]`. For male/female forms use
   `["English (m/f)", ["translit m", "translit f"], ["Hebrew m", "Hebrew f"]]`; write `(to m/f)` when the forms depend on who you're talking to.
3. Add the file name (without `.js`) to `lessons/index.js`.
4. Commit and push. GitHub Pages updates the site in a minute or two.

## Getting quiz results

When a student finishes a quiz, the score shows up on the **Teacher** page (link at the bottom of every page, or `#/teacher`). It lists each student's best score per lesson, every try with the phrases they missed, and the latest quizzes. It refreshes every 30 seconds.

Behind the scenes the scores are stored in a Google Sheet you own, through a small Apps Script. One-time setup:

1. Create a new Google Sheet, for example "Hebrew Class results".
2. In the sheet choose **Extensions → Apps Script**, delete the sample code and paste in `results-sheet/Code.gs`.
3. On the line `var TEACHER_PASSCODE = "change-me";` replace `change-me` with a passcode of your own. Save.
4. Choose **Deploy → New deployment**, type **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and allow the permissions it asks for.
5. Copy the **Web app URL** (it ends in `/exec`) into `resultsUrl` in `config.js`, then commit and push.
6. Open the Teacher page and enter your passcode once.

Only someone with the passcode can see the scores. Students type their own name, so anyone with the link could add a score; that's fine for a small class. The same name typed with different capitals or spaces counts as one student.

If you change `Code.gs` later (including the passcode), use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same.

## Running a live class

1. Open the lesson, go to the **Live class** tab and open **Teacher? Sign in to run the class** at the bottom. Enter your teacher passcode (once per browser).
2. Press **Start live class** and send students the link to that page.
3. Students enter their email and press **Join the class**. Their names appear under **Live now**, and each join is saved on the **Attendance** tab of your Google Sheet.
4. Move with **Next word** / **Previous** or the ← → arrow keys. Students' screens follow within a few seconds (they check every 2–3 seconds through the Google script). Each student can press 🔊 to hear the word.
5. Press **End class** when you're done. A class nobody ends stops being live after 4 hours.

Students can only join while a class is running. The email isn't verified; it identifies who attended.

The live class uses the same Google script as the quiz results, so after updating `Code.gs` paste the new version into Apps Script and deploy a new version (see above). Until then the Live class tab says it can't reach the class service.
