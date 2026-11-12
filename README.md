# Hebrew Class

A small website for a weekly Hebrew class. Each lesson has:

- **Lesson sheet**: a printable table (English, transliteration, Hebrew) that students print or save as a PDF. The font size shrinks to fit one A4 page; if that would make it too small to read, the sheet moves onto two (or three) pages, splitting between sections.
- **Self study**: *Word by word* (one phrase per screen with a listen button) and the *Quiz*: up to five short quizzes per lesson, each on different phrases, with four English → Hebrew multiple-choice questions and one matching round that counts as one question. Students can take them in any order and as often as they like; a lesson's mark is the highest score among them.
- **Live class**: the teacher steps through the words during an online class and every student who joined sees the same word.

Across the whole site (menu at the top of every page):

- **Sign-in**: students sign in with their name; an email and a PIN are optional. The email is saved on the **Students** tab of your sheet. The teacher signs in with the teacher passcode.
- **Self study** also has the *Word of the day* (one word a day about family or something positive, the same for everyone, with a one-question check; the words are in `words/daily-words.js`, and a word already used in a lesson is skipped) and *How to say* (type or say a short English phrase and get Google's Hebrew translation with audio).
- **Suggestions**: students suggest improvements or lesson topics; everyone sees the list and the teacher's responses.
- **My progress**: each student's quiz scores and Word of the day practice, lesson by lesson and week by week, with the phrases they miss most. The teacher sees everyone's on the Teacher page, with the class's totals for the week and its most missed phrases.
- **Download PDF** on a report opens the browser's print window; choose "Save as PDF" there. The teacher can save the class report or one student's.
- **Share** (in the top menu) sends the site's link (`siteUrl` in `config.js`) by the phone's share menu (on phones and tablets), WhatsApp, email or a copied link.

There is no build step. Open `index.html` in a browser to try it locally.

## Adding a lesson

1. Copy a file in `lessons/` and name it `YYYY-MM-DD-topic.js`.
2. Fill in its rows. A row is `["English", "Transliteration", "Hebrew"]`. For male/female forms use
   `["English (m/f)", ["translit m", "translit f"], ["Hebrew m", "Hebrew f"]]`; write `(to m/f)` when the forms depend on who you're talking to.
   A section can have an `explanation` (shown above its phrases on the sheet and on each word card). Set `video` (and `videoTitle`) to link the lesson's video.
3. Add the file name (without `.js`) to `lessons/index.js`. Lessons are numbered by date: the oldest is shown as "Lesson 1".
4. Commit and push. GitHub Pages updates the site in a minute or two.

## Getting quiz results

When a student finishes a quiz, the score shows up on the **Teacher** page (in the top menu once you are signed in as the teacher, or `#/teacher`). It shows the week's progress for every student (tap a name for that student's full report), how many suggestions are waiting for a response, each student's best score per lesson, every try with the phrases they missed, and the latest quizzes. It refreshes every 30 seconds.

Behind the scenes everything is stored in a Google Sheet you own, through a small Apps Script. The script makes the tabs it needs: **Results**, **Students**, **Practice** (Word of the day), **Suggestions**, **Attendance** and **PIN changes**. One-time setup:

1. Create a new Google Sheet, for example "Hebrew Class results".
2. In the sheet choose **Extensions → Apps Script**, delete the sample code and paste in `results-sheet/Code.gs`.
3. On the line `var TEACHER_PASSCODE = "change-me";` replace `change-me` with a passcode of your own. Save.
4. Choose **Deploy → New deployment**, type **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then **Deploy** and allow the permissions it asks for.
5. Copy the **Web app URL** (it ends in `/exec`) into `resultsUrl` in `config.js`, then commit and push.
6. Open the site, choose **Teacher? Sign in here** and enter your passcode once.

If you change `Code.gs` later (including the passcode), paste the new file into Apps Script, put your passcode back on the `TEACHER_PASSCODE` line, and use **Deploy → Manage deployments → Edit → Version: New version** so the URL stays the same. Google may ask you to allow permissions again (How to say uses Google's translator). For the PIN reset emails, choose the function **allowEmail** at the top of the Apps Script editor and press **Run** once, then allow the script to send email as you. Until the script is updated, new features say they aren't switched on yet; the lessons and quizzes keep working.

## Students, PINs and privacy

- A student signs in with a name. The same name typed with different capitals or spaces counts as one student, so two students need different names (add a surname initial).
- A PIN (4 to 8 digits) is optional. A student sets one by typing it when signing in. From then on that name's progress report, scores, practice and suggestions need the PIN; without a PIN, anyone who types the name can see that student's report.
- The sheet keeps a scrambled form of the PIN, never the PIN itself. A student who forgets it can choose **Forgot your PIN?** on the sign-in page: a 6-digit code goes to the email saved for their name (it works for 15 minutes; up to 3 codes an hour), and with it they choose a new PIN. The emails are sent from the Google account that owns the script. If no email is saved for the name, it tells them straight away to ask the teacher.
- The teacher can also help, on the student's report on the Teacher page (tap their name):
  - **Email temporary PIN** (when the student has an email saved): a 3-digit temporary PIN goes to that email only; your screen doesn't show it. Their old PIN stops working. It is kept in their **PIN** cell on the **Students** tab as "Temporary: 482" until they use it. They sign in with it and must then choose their own PIN.
  - **Clear PIN** (for a student with no email who asks you): their name works without a PIN until they sign in and type a new one, so ask them to do that soon.
- Either way their scores are kept. Five wrong PINs pause sign-in for that name for 10 minutes; a reset ends the pause.
- Every PIN chosen, reset or changed, every code emailed and every pause after wrong PINs is listed under **PIN changes** on the Teacher page (and under **PIN history** in each student's report), and kept on the **PIN changes** tab of the sheet. The PINs themselves are never listed.
- Only the teacher passcode opens everyone's reports. This is light protection suited to a class, not for sensitive data.
- How to say sends the typed phrase to Google to be translated. The translation has no vowel marks and can be wrong.

## Running a live class

1. Sign in as the teacher, open the lesson and go to the **Live class** tab.
2. Press **Start live class** and send students the link to that page.
3. Students sign in, check their name (email is optional) and press **Join the class**. Their names appear under **Live now**, and each join is saved on the **Attendance** tab of your Google Sheet.
4. Move with **Next word** / **Previous** or the ← → arrow keys. Students' screens follow within a few seconds (they check every 2–3 seconds through the Google script). Each student can press 🔊 to hear the word.
5. Press **End class** when you're done. A class nobody ends stops being live after 4 hours.

Students can only join while a class is running. Names and emails aren't verified; they identify who attended.

The live class uses the same Google script as the quiz results, so after updating `Code.gs` paste the new version into Apps Script and deploy a new version (see above). Until then the Live class tab says it can't reach the class service.
