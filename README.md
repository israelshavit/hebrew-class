# Hebrew Class

A small website for a weekly Hebrew class. Each lesson has (Lessons, Self study and Live class in the top menu; Self study opens the lesson last opened, or the latest one; Live class opens the running class, or the latest lesson):

- **Lesson sheet**: a printable table (English, transliteration, Hebrew) that students print or save as a PDF. The font size shrinks to fit one A4 page; if that would make it too small to read, the sheet moves onto two (or three) pages, splitting between sections.
- **Self study**: the *Quiz* and *Word by word* buttons open their page for the current lesson with a list of lessons on top; the one chosen is used there and by *Resources* (the lesson's video). *Word by word* shows one phrase per screen with a listen button; the section's explanation is under the buttons. The *Quiz* has up to five short quizzes per lesson, each on different phrases, with four English → Hebrew multiple-choice questions and one matching round that counts as one question. Students can take them in any order and as often as they like; a lesson's mark is the highest score among them.
- **Live class**: the teacher steps through the words during an online class and every student who joined sees the same word, with a video call on the same page (see [Video call](#video-call)).

Across the whole site (menu at the top of every page):

- **Sign-in**: students sign in with their name; an email and a PIN are optional. The email is saved on the **Students** tab of your sheet. The teacher signs in with the teacher passcode.
- **Self study** also has the *Word of the day* (one word a day about family or something positive, the same for everyone, with a one-question check; the words are in `words/daily-words.js`, and a word already used in a lesson is skipped. Buttons under the word open the past week's words, ticked once practised, so a student who missed a day can catch up) and *How to say* (type or say a short English phrase and get Google's Hebrew translation with audio).
- **Championship board** (top of the Lessons page): last week's champion and this week's top 3, with points for effort (see below).
- **Suggestions** (in the Self study menu): students suggest improvements or lesson topics; everyone sees the list and the teacher's responses.
- **My progress**: each student's quiz scores and Word of the day practice, lesson by lesson and week by week, with the phrases they miss most. The teacher sees everyone's on the Teacher page, with the class's totals for the week and its most missed phrases.
- **Download PDF** on a report opens the browser's print window; choose "Save as PDF" there. The teacher can save the class report or one student's.
- **Share** (in the top menu) sends the site's link (`siteUrl` in `config.js`) by the phone's share menu (on phones and tablets), WhatsApp, email or a copied link. A signed-in student's link is their own (see **Invites** below).
- **English / Español** (the menu in the blue top bar, also before signing in): the interface language, remembered on each device. It's English until someone chooses Español. See [English and Spanish](#english-and-spanish).

There is no build step. Open `index.html` in a browser to try it locally.

## Adding a lesson

1. Copy a file in `lessons/` and name it `YYYY-MM-DD-topic.js`.
2. Fill in its rows. A row is `["English", "Transliteration", "Hebrew", "Spanish"]`. For male/female forms use
   `["English (m/f)", ["translit m", "translit f"], ["Hebrew m", "Hebrew f"], "Spanish (m/f)"]`; write `(to m/f)` when the forms depend on who you're talking to (in the Spanish, `(a él/ella)`). In the Spanish, `cansado/a` shows as "cansado" or "cansada" in the quiz.
   A section can have an `explanation` (shown above its phrases on the sheet, and under the buttons in Word by word). Set `video` (and `videoTitle`) to link the lesson's video: it appears at the end of the sheet and under Self study → Resources.
   A lesson can also have a `picture`: `{ src, title, width, height }`, with the image in `lessons/pictures/` and its size in pixels (an SVG's `viewBox`), and its Spanish copy in `es.picture`. It appears under the table on the sheet's last page, shrinking with the text so the sheet still fits, and under Self study → Resources, where it can be opened full size.
   The lesson and each section also get `es: { ... }` with their title, subtitle, notes and explanation in Spanish (copy an existing lesson).
3. Add the file name (without `.js`) to `lessons/index.js`. Lessons are numbered by date: the oldest is shown as "Lesson 1".
4. Change the version in `version.js` (the date and time will do), then commit and push. GitHub Pages updates the site in a minute or two, and a page already open on a phone or computer reloads itself to get it the next time it comes back on screen (except in the middle of a quiz or with something typed and not sent; then it waits for the next time).

## English and Spanish

Each student picks **English** or **Español** in the top bar. Hebrew is what everyone learns; the language only changes what's around it:

- **Everything a student sees** switches: menus, sign-in and PIN help, quizzes, Word of the day, How to say, Live class, My progress and its PDF, Share, Suggestions and the championship board. The interface text is in `lang/es.js` ("English": "Spanish" per line). Text missing there shows in English, and on `localhost` the browser console lists it ("No Spanish yet for …").
- **The lessons**: in Spanish the sheet, Word by word, the quizzes and the Word of the day show each phrase's Spanish (the fourth item of a row) instead of the English, and the lesson's Spanish title, notes and explanations.
- **How to say** takes typed or spoken Spanish. It needs the latest `Code.gs`; with an older one, a student using Spanish is told it isn't switched on yet.
- **PIN emails**: the reset code comes in the language the student is using. The temporary PIN you send from the Teacher page is in both languages.
- **The Teacher page stays in English.** Quiz misses are saved in English, so your reports read the same whichever language a student uses; a student in Spanish sees their own misses in Spanish.

## Getting quiz results

When a student finishes a quiz, the score shows up on the **Teacher** page (in the top menu once you are signed in as the teacher, or `#/teacher`). It shows how many suggestions are waiting for a response, **Recent activity** (below), the week's progress for every student (tap a name for that student's full report), each student's best score per lesson, and every try with the phrases they missed. It refreshes every 30 seconds.

**Recent activity** starts with the number of students (everyone who has signed in, taken a quiz, practised or joined a live class), how many were active today and in the last 7 days, and how many are new in the last 7 days. These numbers leave out names with "test" in them (in any capitals), so test names you sign in with don't count. A live class join saved with only an email counts as the student with that email. Tap a number to list the names behind it, with each student's country; tap it again or **Close** to hide the list. Below that is everything students did, newest first: sign-ins, quizzes with their scores, Words of the day, live class joins and suggestions, with buttons to show only one kind and **Show more** for older lines. Each line shows the student's country with its flag (from their device's time zone, see below; students who only joined a live class have none). Windows has no flag emoji, so the flags are drawn with the free Twemoji Country Flags font, which the Teacher page loads from jsDelivr only when a flag is shown. The flags need the latest `Code.gs`; until then the country shows without one. Students stay signed in on their own devices, so a sign-in shows when a student signs in for the first time, on another device or after signing out. Sign-ins after the first one, and live class joins, need the latest `Code.gs`; until then those lines are missing and the card says how to switch them on.

Behind the scenes everything is stored in a Google Sheet you own, through a small Apps Script. The script makes the tabs it needs: **Results**, **Students**, **Practice** (Word of the day), **Suggestions**, **Attendance**, **PIN changes** and **Sign-ins**. One-time setup:

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
- The site also sends the time zone of the student's device (its clock setting, like `Asia/Jerusalem`, not its exact location). The script saves it with the country it belongs to in the **Country** and **Time zone** columns of the **Students** tab. It's sent after signing in, or on the next visit for a student already signed in, and again if the time zone changes (a phone usually switches time zone when travelling). The sign-in page tells students their teacher sees their country. The Teacher page shows how many students are in each country (**Where students are**) and the country in each student's report. It needs the latest `Code.gs`; until then nothing is sent or shown.

## Championship board

The top of the Lessons page shows **last week's Hebrew champion** and **this week's top 3** (everyone tied for a place is shown, up to 5 names). A signed-in student also sees their own points for the week; opening that line shows them broken down into quizzes, Word of the day and live class (the breakdown needs the latest `Code.gs`; with an older one the student sees just the total). Points reward effort, so a student who practises often can beat a stronger one who rarely logs in:

- 1 point for each correct quiz answer, counting the best try at each quiz that week (retaking a quiz can raise it, not add to it)
- 2 points for each Word of the day practised: today's, or one from the past week caught up on. Each word counts once, in the week it's practised, like a quiz taken late (the latest `Code.gs`; an older one counts it in the week of the word's own day)
- 10 points for each live class joined

Weeks run Sunday to Saturday in the Google Sheet's time zone (File → Settings), and everyone starts each week at zero. The Google script works the points out from the **Results**, **Practice** and **Attendance** tabs (at most once a minute, but straight away after a quiz, Word of the day or class join, so a student sees their new points as soon as they're back on the Lessons page) and sends only names and points, never emails or PINs.

On the Teacher page, **Championship board** lists every student's points this week and last week. **Hide** keeps a name off the board everyone sees, for test names or a student who'd rather not appear (that student still sees their own points, with a note that their name is hidden); **Show** puts it back. The hidden names are kept in the script's properties, not in the sheet.

The board needs the version of `Code.gs` that has it: paste it into Apps Script and deploy a new version (see above). Until then the Lessons page simply has no board, and the Teacher page says how to switch it on.

## Invites

Each signed-in student's Share page gives them their own link: the site's address with `?ref=` and an 8-character invite code made from their name (no name in the link). A friend who opens it signs in as usual: their browser keeps the code for up to 30 days, and their first sign-in sends it. The script then writes the student's name in the **Invited by** column of the **Students** tab. The code is taken off the address bar as soon as the page opens, so a friend who shares the site from there doesn't pass the code on. It only counts for someone signing in for the first time, and nobody can invite themselves.

The site can't see who a link is sent to (WhatsApp, email and the share menu are other apps), only who signs up with it. For now nothing on the site mentions invites: students and their friends see the same pages as before, apart from the code at the end of the link. Tell students when you start rewarding invites.

On the Teacher page, **Invites** lists each student who brought friends, with each friend marked **Active** once they've taken a quiz, practised the Word of the day or joined a live class, so a reward can go to invites that turned into real students. Test names (with "test" in them) are listed but not counted. New students' lines in **Recent activity** say who invited them.

Invites need the latest `Code.gs`. Until it's deployed, the Share page sends the plain link and the Teacher page says how to switch invites on.

## Running a live class

1. Sign in as the teacher and choose **Live class** in the top menu. It opens the latest lesson; **Change lesson** opens another one.
2. Press **Start live class** and send students the link to that page.
3. Students sign in, check their name (email is optional) and press **Join the class**. Their names appear under **Live now**, and each join is saved on the **Attendance** tab of your Google Sheet.
4. Move with **Next word** / **Previous** or the ← → arrow keys. Students' screens follow within a few seconds (they check every 2–3 seconds through the Google script). Each student can press 🔊 to hear the word.
5. To go on with another lesson, choose it under **Change lesson**. The class moves there at its first word: it's still the same class, so everyone who joined stays in it (and in the video call), and their pages follow within a few seconds.
6. Press **End class** when you're done. A class nobody ends stops being live after 4 hours.

Students can only join while a class is running. Names and emails aren't verified; they identify who attended.

The live class uses the same Google script as the quiz results, so after updating `Code.gs` paste the new version into Apps Script and deploy a new version (see above). Until then the Live class page says it can't reach the class service.

### Video call

With a free [Daily](https://www.daily.co) account, the Live class page also has a video call, under the word:

- Everyone who joined the class is in the call and can listen and talk. You and the first 10 students to join can also turn on a camera and see each other. Students who join after the first 10 have sound only, and the page tells them so.
- Students start muted with the camera off, and turn them on with **Unmute** and **Turn camera on**. You start with both on (the browser asks once to use your camera and microphone).
- **Show videos** hides the videos and stops downloading them, which saves phone data. The sound keeps playing. Each browser remembers the choice.
- Leaving the Live class page leaves the call, and coming back joins it again. **End class** closes the call for everyone. If a browser holds back the sound after a page reload, the page shows **Turn on sound**.
- The call goes through Daily's servers and isn't recorded. The page asks for camera and microphone only when someone turns them on.
- Daily gives 10,000 free participant minutes a month (each person in the call counts every minute), then charges the card $0.004 a minute with no limit of its own (see [daily.co/pricing](https://www.daily.co/pricing/video-sdk/)). So the Google script keeps the calls within the free minutes by itself:
  - A call takes at most 20 people at once, you included (19 students), and lasts at most 1 hour from when the class's call starts (when you press **Start live class**). Daily ends it at that time; the rest of the class goes on without the call. Students after the 19th to join follow the class without the call.
  - So one full call is at most 20 × 60 = 1,200 participant minutes, and two such classes a week come to about 9,600 in a 4-week month.
  - Before each class's call it adds up the minutes of the last 32 days (any billing month fits inside that), keeping under 9,000 to leave room for test calls. A call first counts as its most (1,200); once Daily has the call's records, it counts what it really used, which is less when fewer people come or some join late.
  - When the minutes left can't cover a full hour for 20 people, the call is shortened and the page says when it ends. With less than 15 minutes' worth left, the class has no call and the page says why. The minutes come back as old calls pass 32 days.
  - The numbers are at the top of the video call part of `Code.gs` (`CALL_MINUTES_LIMIT`, `CALL_MAX_PEOPLE`, `CALL_MAX_MINUTES`). **checkDaily** also logs the minutes counted so far.
  - Only calls made by this script are counted, so the test script and the real one each keep their own count, and calls made elsewhere on your Daily account (like trying it in the Daily dashboard) aren't counted. A second teacher must share this same script (one count for both) or use their own Daily account (their own free minutes). Two scripts with the same Daily key would each allow 9,000 and could pass the free minutes together.
- **Video minutes this month**, on Live class and the Teacher page (teacher only), shows the minutes used on your whole Daily account since the 1st of the month (UTC), every call included, as a share of the free 10,000. The script reads them from Daily's records of each call, every few minutes; it turns amber at 75% and red at 90%. Daily's dashboard (**Billing**) has the exact figure.

Setup, once for each Google script (the test copy and the real one):

1. Create a free account at [daily.co](https://www.daily.co), open **Developers** in the dashboard and copy the **API key**.
2. In Apps Script, open **Project Settings** (the gear). Under **Script properties** add a property named `DAILY_API_KEY` with the key as its value, and save. In the **test** script only, also add `CALL_MINUTES_LIMIT` with the value `600`: both scripts use the same Daily account, so the test script's calls are kept small (9,000 + 600 stays under the free 10,000). Test calls there last at most 30 minutes.
3. Paste in the new `Code.gs`. Choose the function **checkDaily** at the top of the editor and press **Run**, then allow the script to connect to an external service. The log should say "Daily is connected.", followed by the minutes this script has counted and the minutes on the whole Daily account this month.
4. Deploy a new version (see above).

The key stays in the script's properties, never in this public repository. The script makes a private room for each class and gives each person who joined their own pass to it, so the room's address alone doesn't let anyone in. Without a key, or with an older `Code.gs`, the Live class page works as before, with no call.
