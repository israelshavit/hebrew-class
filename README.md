# Hebrew Class

A small website for a weekly Hebrew class. Each lesson has:

- **Lesson sheet**: a one-page table (English, transliteration, Hebrew) that students print or save as a PDF. The font size shrinks automatically so it always fits on one A4 page.
- **Quiz**: English → Hebrew multiple choice, then matching rounds, built from that lesson's phrases. Scores can be sent to the teacher's Google Sheet.

There is no build step. Open `index.html` in a browser to try it locally.

## Adding a lesson

1. Copy a file in `lessons/` and name it `YYYY-MM-DD-topic.js`.
2. Fill in its rows. A row is `["English", "Transliteration", "Hebrew"]`. For male/female forms use
   `["English (m/f)", ["translit m", "translit f"], ["Hebrew m", "Hebrew f"]]`; write `(to m/f)` when the forms depend on who you're talking to.
3. Add the file name (without `.js`) to `lessons/index.js`.
4. Commit and push. GitHub Pages updates the site in a minute or two.

## Getting quiz results

Results go to a Google Sheet you own, through a small Apps Script.

1. Create a new Google Sheet, for example "Hebrew Class results".
2. In the sheet choose **Extensions → Apps Script**, delete the sample code and paste in `results-sheet/Code.gs`. Save.
3. Choose **Deploy → New deployment**, type **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and allow the permissions it asks for.
4. Copy the **Web app URL** (it ends in `/exec`) into `resultsUrl` in `config.js`, then commit and push.

Each finished quiz adds a row: time, student name, lesson, score and the phrases they missed. Students type their own name, so anyone with the link could add a row; that's fine for a small class.

If you change `Code.gs` later, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.
