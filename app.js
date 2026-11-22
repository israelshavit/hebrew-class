(function () {
  "use strict";

  var HC = (window.HebrewClass = window.HebrewClass || {});
  var config = HC.config || {};

  // A4 at 96 dpi, matching .page in styles.css.
  var PAGE_W = 794;
  var PAGE_H = 1123;
  var PAGE_PAD = 34;
  var MAX_FONT = 15;
  var MIN_FONT = 7;
  // Below this the sheet moves onto more pages (up to MAX_PAGES) instead of shrinking further.
  var READABLE_FONT = 10;
  var MAX_PAGES = 3;

  // Each lesson has up to QUIZ_COUNT short quizzes: CHOICES_PER_QUIZ
  // multiple-choice questions, then one matching round that counts as one question.
  var QUIZ_COUNT = 5;
  var CHOICES_PER_QUIZ = 4;
  var PAIRS_PER_QUIZ = 4;

  // Recent activity on the Teacher page shows this many lines, and this many more per "Show more".
  var ACTIVITY_PAGE = 15;

  // Vowel points and other marks, but not maqaf (U+05BE) or sof pasuq (U+05C3).
  var NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

  var lessons = [];

  var signedInStudent = readStudent();

  var state = {
    route: { view: "home" },
    lessonId: null,   // the lesson last opened; Self study and Live class follow it
    niqqud: readSetting("hebrewClass.niqqud", "1") !== "0",
    showTr: readSetting("hebrewClass.transliteration", "1") !== "0", // transliteration on the quiz answers
    student: signedInStudent,          // { name, token } once signed in; token is empty without a PIN
    studentName: signedInStudent ? signedInStudent.name : "",
    // forgot: the "Forgot your PIN?" steps while open; choose: choosing a PIN after a temporary one
    // name, email: what's typed in the sign-in form, kept in memory only
    auth: { busy: false, error: "", forgot: null, choose: null, name: "", email: "" },
    quiz: null,       // the quiz being taken; null shows the list of quizzes
    quizDone: {},     // best score per "lessonId|quiz number" since the page was opened
    cards: null,
    wotd: null,
    wotdDay: null,      // the Word of the day chosen: today's, or one from the past week
    wotdPractised: {},  // words practised since the page opened, by "day|student"
    say: { text: "", busy: false, error: "", result: null, listening: false },
    suggestions: { items: null, loading: false, error: "", sending: false, sendError: "", saving: "" },
    report: { data: null, loading: false, error: "" },
    // The championship board on the Lessons page. off: the Google script is from before the board.
    // meOpen/howOpen: which parts of the board are opened, kept when the board refreshes
    board: { data: null, loading: false, off: false, at: 0, again: false, meOpen: false, howOpen: false },
    loadErrors: [],
    // The signed-in student's own invite code, for their Share link. off: an
    // older Google script, or a name it doesn't know, so the plain link.
    invite: { code: "", forKey: "", loading: false, off: false },
    teacher: {
      passcode: readSetting("hebrewClass.teacherPasscode", ""),
      results: null,
      practice: [],
      students: [],
      signIns: null,  // null: a Google script from before the sign-in log
      classes: null,  // the latest live class joins; null as for signIns
      classNames: null, // everyone who ever joined a live class; null: use the names in classes
      activityKind: "all",     // the Recent activity filter
      activityOpen: null,      // the Recent activity number whose names are listed
      activityShown: ACTIVITY_PAGE,
      loading: false,
      error: "",
      updatedAt: null,
      selected: null,
      week: 0,        // 0 is this week, -1 last week…
      report: null,   // the student whose full report is open
      board: null,    // everyone's points, to hide or show names on the championship board
      boardLoading: false,
      boardOff: false,
      boardBusy: "",  // the name being hidden or shown
      boardError: ""
    }
  };

  var REFRESH_MS = 30000;

  /* ---------- Storage (per-browser conveniences only) ---------- */

  function readSetting(key, fallback) {
    try {
      var value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function writeSetting(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function removeSetting(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------- Interface language ----------
     English or Spanish, chosen on each browser with the menu in the top bar.
     lang/es.js has the Spanish for each English text; anything missing there
     shows in English. Hebrew is still what's taught: in Spanish, a lesson's
     meanings, titles and notes come from its Spanish ("es") parts. */

  var LANGUAGES = [{ code: "en", name: "English" }, { code: "es", name: "Español" }];
  // English until someone chooses Español on this browser.
  var uiLang = readSetting("hebrewClass.lang", "") === "es" ? "es" : "en";
  var missingText = {};
  document.documentElement.lang = uiLang;

  // The interface text in the chosen language; {name} is filled in from vars.
  // "Live class|menu" is "Live class" in English, with its own Spanish (a
  // shorter one, for the top menu to fit across a phone).
  function t(text, vars) {
    var out = text.split("|")[0];
    if (uiLang === "es") {
      var table = (HC.text && HC.text.es) || {};
      if (Object.prototype.hasOwnProperty.call(table, text)) out = table[text];
      else if (config.testing && !missingText[text]) {
        missingText[text] = true;
        console.warn("No Spanish yet for: " + text); // on localhost only, to catch new text
      }
    }
    return vars ? out.replace(/\{(\w+)\}/g, function (m, key) { return key in vars ? String(vars[key]) : m; }) : out;
  }

  // Dates: the browser's own format in English, Spanish month and day names in Spanish.
  function dateLocale() {
    return uiLang === "es" ? "es" : undefined;
  }

  function setLanguage(code) {
    if (code === uiLang || (code !== "en" && code !== "es")) return;
    uiLang = code;
    writeSetting("hebrewClass.lang", code);
    document.documentElement.lang = code;
    stopListening(); // How to say listens for the language chosen
    render();
  }

  // The language menu in the top bar, there before and after signing in.
  function languageMenu() {
    return el("select", {
      class: "lang-select",
      "aria-label": "Language / Idioma",
      title: "Language / Idioma",
      onchange: function (e) { setLanguage(e.target.value); }
    }, LANGUAGES.map(function (l) {
      return el("option", { value: l.code, selected: l.code === uiLang, text: l.name });
    }));
  }

  // A student's email and live class are kept only while they're signed in, so
  // a shared computer opens on an empty sign-in form.
  function forgetSavedPerson() {
    removeSetting("hebrewClass.liveEmail");
    removeSetting("hebrewClass.liveSession");
    removeSetting("hebrewClass.liveName");
  }

  removeSetting("hebrewClass.studentName"); // earlier versions kept the last name typed, even after signing out
  if (!signedInStudent) forgetSavedPerson();

  // The student signed in on this browser, if any.
  function readStudent() {
    try {
      var saved = JSON.parse(readSetting("hebrewClass.student", "null"));
      return saved && saved.name ? { name: String(saved.name), token: String(saved.token || "") } : null;
    } catch (e) {
      return null;
    }
  }

  /* ---------- Lessons ---------- */

  HC.addLesson = function (raw) {
    lessons.push(normalizeLesson(raw));
  };

  // Rows are ["English", "translit", "Hebrew"], or for male/female forms
  // ["English (m/f)", ["translit m", "translit f"], ["Hebrew m", "Hebrew f"]].
  // A fourth item is the meaning in Spanish. A lesson and each of its sections
  // can have es: { title, subtitle, notes, explanation } in Spanish. A lesson's
  // picture is { src, title, width, height } (es: { picture } for its Spanish copy).
  function normalizeLesson(raw) {
    var forms = [];
    var sections = (raw.sections || []).map(function (section, si) {
      return {
        title: section.title,
        explanation: section.explanation || "",
        es: section.es || {},
        rows: (section.rows || []).map(function (r, ri) {
          var row = { id: si + "-" + ri, en: r[0], es: r[3] || "", forms: [] };
          var tr = r[1];
          var he = r[2];
          if (Array.isArray(he)) {
            he.forEach(function (h, i) {
              row.forms.push({
                g: i === 0 ? "m" : "f",
                tr: Array.isArray(tr) ? tr[i] || "" : tr,
                he: h,
                row: row
              });
            });
          } else {
            row.forms.push({ g: "", tr: tr, he: he, row: row });
          }
          forms = forms.concat(row.forms);
          return row;
        })
      };
    });
    return {
      id: raw.id,
      date: raw.date || "",
      title: raw.title || "Untitled lesson",
      subtitle: raw.subtitle || "",
      video: raw.video || "",
      videoTitle: raw.videoTitle || "",
      notes: raw.notes || "",
      picture: raw.picture || null,
      es: raw.es || {},
      sections: sections,
      forms: forms
    };
  }

  function loadLessons(done) {
    var files = HC.lessonFiles || [];
    var pending = files.length;
    if (!pending) { done(); return; }
    files.forEach(function (name) {
      var script = document.createElement("script");
      script.src = "lessons/" + name + ".js";
      script.onload = script.onerror = function (event) {
        if (event.type === "error") state.loadErrors.push(name);
        pending -= 1;
        if (pending === 0) {
          // Scripts can finish in any order; newest lesson first.
          lessons.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
          // The oldest lesson is Lesson 1.
          lessons.forEach(function (lesson, i) {
            lesson.number = lessons.length - i;
          });
          done();
        }
      };
      document.body.appendChild(script);
    });
  }

  function findLesson(id) {
    for (var i = 0; i < lessons.length; i++) {
      if (lessons[i].id === id) return lessons[i];
    }
    return null;
  }

  // A lesson's or section's title, subtitle, notes or explanation in the
  // interface language, when the lesson file has it in Spanish.
  function localText(item, field) {
    return (uiLang === "es" && item.es && item.es[field]) || item[field];
  }

  // A phrase's meaning: its Spanish in Spanish (when the row has it), otherwise its English.
  function meaning(row, language) {
    return ((language || uiLang) === "es" && row.es) || row.en;
  }

  // "Lesson 2 – Small Talk"
  function lessonName(lesson) {
    return t("Lesson {n} – {title}", { n: lesson.number, title: localText(lesson, "title") });
  }

  /* ---------- Helpers ---------- */

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === "text") node.textContent = value;
        else if (key === "class") node.className = value;
        else if (key.slice(0, 2) === "on") node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? "" : value);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    });
    return node;
  }

  function heb(text) {
    return state.niqqud ? text : text.replace(NIQQUD, "");
  }

  function plain(text) {
    return text.replace(NIQQUD, "").trim();
  }

  /* ---------- Speech (the browser's built-in Hebrew voice) ---------- */

  var speech = window.speechSynthesis || null;

  function hebrewVoice() {
    var voices = speech ? speech.getVoices() : [];
    var he = voices.filter(function (v) { return /^(he|iw)\b/i.test(v.lang); });
    // Prefer the higher-quality online/natural voices when there is a choice.
    he.sort(function (a, b) { return voiceScore(b) - voiceScore(a); });
    return he[0] || null;
  }

  function voiceScore(v) {
    return (/natural|online|google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  }

  // "מָה נִשְׁמַע? / מָה קוֹרֶה?" reads as two phrases; "קוֹרְאִים לִי..." drops the dots.
  function speakableText(text) {
    return text.replace(/\s*\/\s*/g, ", ").replace(/\.{2,}|…/g, " ").trim();
  }

  // Uses the device's Hebrew voice when it has one; otherwise plays Google's
  // Hebrew text-to-speech audio (only the phrase text is sent).
  function speak(texts) {
    texts = [].concat(texts).map(speakableText);
    stopSpeaking();
    var voice = hebrewVoice();
    if (voice) {
      texts.forEach(function (text) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "he-IL";
        u.voice = voice;
        u.rate = 0.85;
        speech.speak(u);
      });
    } else {
      playOnline(texts, 0);
    }
  }

  var currentAudio = null;

  function stopSpeaking() {
    if (speech) speech.cancel();
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  }

  function playOnline(texts, i) {
    if (i >= texts.length) return;
    var audio = new Audio(TTS_URL + encodeURIComponent(texts[i]));
    currentAudio = audio;
    audio.playbackRate = 0.9;
    audio.onended = function () { if (currentAudio === audio) playOnline(texts, i + 1); };
    audio.onerror = function () { if (currentAudio === audio) warnNoVoice(); };
    var played = audio.play();
    if (played && played.catch) played.catch(function () { if (currentAudio === audio) warnNoVoice(); });
  }

  var TTS_URL = "https://translate.google.com/translate_tts?ie=UTF-8&tl=iw&client=tw-ob&q=";

  function warnNoVoice() {
    var message = t("Couldn't play the sound. Check your internet connection and volume, or open the site in Microsoft Edge or on a phone.");
    var old = document.getElementById("speech-toast");
    if (old) old.remove();
    var toast = el("div", { class: "toast no-print", id: "speech-toast", role: "status", text: message });
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 6000);
  }

  if (speech) {
    speech.getVoices();
    if ("onvoiceschanged" in speech) speech.onvoiceschanged = function () { speech.getVoices(); };
  }

  var SVG_NS = "http://www.w3.org/2000/svg";

  // A 24×24 line icon; the first path is filled in.
  function lineIcon(paths) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    paths.forEach(function (d, i) {
      var p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      if (i === 0) p.setAttribute("class", "fill");
      svg.appendChild(p);
    });
    return svg;
  }

  // The arrow on a button that opens a list (no filled part).
  function chevronIcon() {
    var svg = lineIcon([]);
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", "M6 9l6 6 6-6");
    svg.appendChild(p);
    svg.setAttribute("class", "subtab-caret");
    return svg;
  }

  function speakerIcon() {
    return lineIcon(["M4 9h4l5-4v14l-5-4H4z", "M16 8.5a4.5 4.5 0 0 1 0 7", "M18.5 6a8 8 0 0 1 0 12"]);
  }

  function micIcon() {
    return lineIcon(["M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z", "M5.5 11a6.5 6.5 0 0 0 13 0", "M12 17.5V21", "M8.5 21h7"]);
  }

  // texts: one Hebrew string, or several (male and female forms) read one after another.
  function speakButton(texts, extraClass) {
    var btn = el("button", {
      class: "speak-btn no-print" + (extraClass ? " " + extraClass : ""),
      type: "button",
      title: t("Listen"),
      "aria-label": t("Listen to the Hebrew"),
      onclick: function (e) { e.stopPropagation(); speak(texts); }
    });
    btn.appendChild(speakerIcon());
    return btn;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function formatDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return iso || "";
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" });
  }

  // A row's gender marks: "(to m/f)" for talking to a man or a woman (in
  // Spanish "(a él/ella)"), and "(m/f)" for a male or female speaker.
  var TO_MARK = /\s*\((?:to m\/f|a él\/ella)\)/;
  var MF_MARK = /\s*\(m\/f\)/;
  var GENDER_WORDS = {
    en: { toM: "(to a man)", toF: "(to a woman)", m: "(male)", f: "(female)" },
    es: { toM: "(a un hombre)", toF: "(a una mujer)", m: "(hombre)", f: "(mujer)" }
  };

  // The prompt for one form, in the interface language or the one asked for
  // (quiz misses are saved in English for the teacher), making the gender
  // explicit. In Spanish, "cansado/a" becomes "cansado" or "cansada".
  function promptFor(form, language) {
    language = language === "en" || language === "es" ? language : uiLang;
    var row = form.row;
    var text = meaning(row, language);
    if (!form.g) return text;
    var male = form.g === "m";
    var words = GENDER_WORDS[language];
    if (language === "es" && row.es) {
      text = text.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\/a(?![A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, function (m, word) {
        return male ? word : /o$/.test(word) ? word.slice(0, -1) + "a" : word + "a";
      });
    }
    if (TO_MARK.test(row.en)) {
      var to = male ? words.toM : words.toF;
      return TO_MARK.test(text) ? text.replace(TO_MARK, " " + to) : text + " " + to;
    }
    var who = male ? words.m : words.f;
    return MF_MARK.test(text) ? text.replace(MF_MARK, " " + who) : text + " " + who;
  }

  // A lesson's tabs besides its sheet, as they appear in the address.
  var LESSON_TABS = ["cards", "quiz", "resources", "live"];
  // The ones that sit in the Self study menu.
  var STUDY_TABS = ["cards", "quiz", "resources"];
  // The Self study lesson list that is open ("quiz" or "cards"), so it stays
  // open when the page is drawn again, and whether to put the keyboard on it then.
  var openLessonMenu = null;
  var focusLessonMenu = false;

  function lessonUrl(lesson, tab) {
    return "#/lesson/" + encodeURIComponent(lesson.id) + (LESSON_TABS.indexOf(tab) >= 0 ? "/" + tab : "");
  }

  /* ---------- Routing ---------- */

  function parseHash() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    if (parts[0] === "teacher") return { view: "teacher" };
    if (parts[0] === "study") return { view: "study", tab: parts[1] === "say" ? "say" : "word" };
    if (parts[0] === "suggestions") return { view: "suggestions" };
    if (parts[0] === "progress") return { view: "progress" };
    if (parts[0] === "share") return { view: "share" };
    if (parts[0] === "lesson" && parts[1]) {
      return {
        view: "lesson",
        lessonId: decodeURIComponent(parts[1]),
        tab: LESSON_TABS.indexOf(parts[2]) >= 0 ? parts[2] : "sheet"
      };
    }
    return { view: "home" };
  }

  function rememberLesson() {
    if (state.route.view === "lesson" && findLesson(state.route.lessonId)) state.lessonId = state.route.lessonId;
  }

  // The lesson Self study and Live class are about: the one last opened, or the latest.
  function currentLesson() {
    return (state.lessonId && findLesson(state.lessonId)) || lessons[0] || null;
  }

  var routedHash = null; // the address onRouteChange last handled

  function onRouteChange() {
    if (location.hash === routedHash) return; // handled already, by goTo
    routedHash = location.hash;
    state.route = parseHash();
    if (state.route.tab !== openLessonMenu) openLessonMenu = null; // only the Quiz or Word by word button keeps its list open on its own page
    rememberLesson();
    if (state.quiz && state.quiz.lessonId !== state.route.lessonId) state.quiz = null;
    if (state.cards && state.cards.lessonId !== state.route.lessonId) state.cards = null;
    stopListening();
    if (clearPrint) clearPrint(); // a phone may never say the report finished printing
    loadForRoute();
    render();
    window.scrollTo(0, 0);
    if (focusLessonMenu) {
      focusLessonMenu = false;
      var menu = document.querySelector(".lesson-menu:not([hidden])");
      if (menu) (menu.querySelector("a.current") || menu.querySelector("a")).focus();
    }
    startLivePolling();
  }

  // Opens another page now, not when the browser gets round to it, so nothing
  // draws the old page in between (a live class moving lessons keeps its call).
  function goTo(hash) {
    if (location.hash === hash) return;
    location.hash = hash;
    onRouteChange();
  }

  // Fetch what the current page shows.
  function loadForRoute() {
    var view = state.route.view;
    if (view === "teacher") { loadResults(); loadSuggestions(); }
    if (!signedIn()) return;
    if (view === "home") loadBoard();
    if (view === "suggestions") loadSuggestions();
    // Ahead of the Share page, so its link is ready (once per browser: it's kept).
    if (state.student) loadInviteCode();
    if (view === "progress") {
      if (isTeacher()) loadResults(); else loadReport();
    }
    // The list of quizzes shows the student's best score on each, and the
    // Word of the day which of the past week's words they've practised.
    if ((onQuizTab() || onWordTab()) && !state.report.data) loadReport();
  }

  /* ---------- Rendering ---------- */

  var PAGE_TITLES = { teacher: "Teacher dashboard", study: "Self study", suggestions: "Suggestions box", progress: "My progress", share: "Share" };

  function render() {
    var app = document.getElementById("app");
    var view = state.route.view;
    var lesson = view === "lesson" ? findLesson(state.route.lessonId) : null;
    app.textContent = "";
    renderNav();
    if (view === "teacher") app.appendChild(renderTeacher());
    else if (!signedIn()) app.appendChild(renderSignIn());
    else if (view === "lesson") app.appendChild(lesson ? renderLesson(lesson) : renderNotFound());
    else if (view === "study") app.appendChild(renderStudy());
    else if (view === "suggestions") app.appendChild(renderSuggestions());
    else if (view === "progress") app.appendChild(isTeacher() ? renderTeacher() : renderMyProgress());
    else if (view === "share") app.appendChild(renderShare());
    else app.appendChild(renderHome());
    var title = lesson ? lessonName(lesson) : PAGE_TITLES[view] && t(PAGE_TITLES[view]);
    document.title = (title ? title + " · " : "") + t("Hebrew Class");
    markTitle();
    fitSheet();
    syncCall();
  }

  /* ---------- Signing in ---------- */

  function isTeacher() {
    return !!state.teacher.passcode;
  }

  function signedIn() {
    return !!state.student || isTeacher();
  }

  // Who a request is from: the student's name, with their token when they have a PIN.
  function asStudent(body) {
    body.name = state.student.name;
    body.token = state.student.token;
    return body;
  }

  function setStudent(name, token) {
    state.student = { name: name, token: token || "" };
    state.studentName = name;
    writeSetting("hebrewClass.student", JSON.stringify(state.student));
    state.report.data = null;
    state.wotd = null;
    state.invite = { code: "", forKey: "", loading: false, off: false };
    resetBoard(); // "Your points" belong to whoever is signed in
  }

  function resetBoard() {
    state.board.data = null;
    state.board.at = 0;
  }

  function signOut() {
    state.student = null;
    state.studentName = "";
    writeSetting("hebrewClass.student", "");
    forgetSavedPerson();
    state.auth.name = "";
    state.auth.email = "";
    live.email = "";
    live.joinedSession = "";
    live.joinedAs = "";
    live.joinedThisVisit = false;
    state.report = { data: null, loading: false, error: "" };
    state.quiz = null;
    state.wotd = null;
    state.invite = { code: "", forKey: "", loading: false, off: false };
    resetBoard();
    forgetMyPoints();
    var t = state.teacher;
    t.passcode = "";
    t.board = null;
    t.boardError = "";
    t.results = null;
    t.updatedAt = null;
    t.selected = null;
    t.report = null;
    t.error = "";
    writeSetting("hebrewClass.teacherPasscode", "");
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    else render();
  }

  // This device's time zone, so the teacher can see which country each student
  // is in (the Google script works the country out). Sent after signing in, and
  // again when the time zone changes. An older script answers "bad-request",
  // so it tries again on the next visit.
  function sendPlace() {
    if (!state.student || !config.resultsUrl) return;
    var timeZone = "";
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* very old browser */ }
    if (!timeZone) return;
    var sent = studentKey(state.student.name) + "|" + timeZone;
    if (readSetting("hebrewClass.placeSent", "") === sent) return;
    callBackend(asStudent({ action: "place", timeZone: timeZone })).then(function (res) {
      if (res && res.ok && res.saved) writeSetting("hebrewClass.placeSent", sent);
    }, function () { /* offline: next time */ });
  }

  var SIGN_IN_ERRORS = {
    "bad-name": "Please enter your name.",
    "bad-pin": "A PIN is 4 to 8 digits (a temporary PIN from the email is 3).",
    "bad-email": "That email doesn't look right. You can also leave it empty.",
    "pin-needed": "This name is protected by a PIN. Enter the PIN to sign in. Forgot it? Use “Forgot your PIN?” below.",
    "wrong-pin": "That PIN isn't right. Try again, or use “Forgot your PIN?” below.",
    "too-many-tries": "Too many wrong PINs. Wait 10 minutes and try again, or use “Forgot your PIN?” below."
  };

  // newPin: the PIN a student chooses after signing in with a temporary one.
  function signInStudent(name, pin, email, newPin) {
    var auth = state.auth;
    function done(error) {
      auth.busy = false;
      auth.error = error || "";
      if (!error) {
        if (email) {
          live.email = email; // ready for joining the live class
          writeSetting("hebrewClass.liveEmail", email);
        }
        loadForRoute();
        sendPlace();
      }
      render();
    }
    if (!config.resultsUrl) { setStudent(name, ""); done(); return; }
    auth.busy = true;
    auth.error = "";
    render();
    callBackend({ action: "signIn", name: name, pin: pin, email: email, newPin: newPin || "", ref: pendingInvite() }).then(function (res) {
      if (res && res.ok) {
        auth.choose = null;
        removeSetting(INVITE_KEY); // used: the script noted it if this was a first sign-in
        setStudent(res.name || name, res.token);
        done();
      } else if (res && res.error === "choose-pin") {
        // The temporary PIN was right: now the student picks their own.
        auth.choose = { name: name, pin: pin, email: email };
        auth.busy = false;
        auth.error = "";
        render();
      } else if (res && res.error === "bad-request") {
        // A Google script from before sign-in existed: carry on with the name alone.
        removeSetting(INVITE_KEY);
        setStudent(name, "");
        done();
      } else {
        done(t(SIGN_IN_ERRORS[res && res.error] || "Couldn't sign you in. Try again."));
      }
    }, function () {
      done(t("Couldn't reach the class service. Check your connection and try again."));
    });
  }

  /* ---------- Invites ----------
     A student's Share link ends in ?ref= and their invite code. A friend who
     opens it keeps the code on this browser (for up to INVITE_DAYS) until they
     first sign in; the sign-in sends it, and the Google script notes who
     invited them. */

  var INVITE_KEY = "hebrewClass.invite";
  var INVITE_DAYS = 30;

  function keepInvite() {
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    if (!params.has("ref")) return;
    var code = String(params.get("ref") || "").toLowerCase();
    // Off the address, so a link copied from it doesn't pass the code on.
    params.delete("ref");
    var rest = params.toString();
    try { history.replaceState(null, "", location.pathname + (rest ? "?" + rest : "") + location.hash); } catch (e) { /* file:// in some browsers */ }
    // Someone already signed in on this browser is in the class already.
    if (/^[0-9a-f]{8}$/.test(code) && !signedIn()) writeSetting(INVITE_KEY, JSON.stringify({ code: code, at: Date.now() }));
  }

  function pendingInvite() {
    try {
      var saved = JSON.parse(readSetting(INVITE_KEY, "null"));
      if (saved && /^[0-9a-f]{8}$/.test(saved.code) && Date.now() - saved.at < INVITE_DAYS * 86400000) return saved.code;
    } catch (e) { /* ignore */ }
    return "";
  }

  // The signed-in student's own code, for the Share page. It never changes for
  // a name, so this browser keeps it and the page opens straight away next time.
  var MY_INVITE_KEY = "hebrewClass.myInvite";

  function loadInviteCode() {
    var inv = state.invite;
    if (!state.student || !config.resultsUrl || inv.loading) return;
    var key = studentKey(state.student.name);
    if (inv.forKey === key && (inv.code || inv.off)) return;
    inv.forKey = key;
    inv.code = "";
    inv.off = false;
    try {
      var saved = JSON.parse(readSetting(MY_INVITE_KEY, "null"));
      if (saved && saved.key === key && /^[0-9a-f]{8}$/.test(saved.code)) { inv.code = saved.code; return; }
    } catch (e) { /* ask the script */ }
    inv.loading = true;
    callBackend(asStudent({ action: "inviteCode" })).then(function (res) {
      if (res && res.ok && /^[0-9a-f]{8}$/.test(res.code)) {
        inv.code = res.code;
        writeSetting(MY_INVITE_KEY, JSON.stringify({ key: key, code: res.code }));
      } else inv.off = true;
    }, function () {
      inv.forKey = ""; // offline: the plain link for now, and it tries again next time
    }).then(function () {
      inv.loading = false;
      if (state.route.view === "share") render();
    });
  }

  /* ---------- Forgotten PIN: a code by email ---------- */

  var FORGOT_ERRORS = {
    "bad-name": "Please enter your name.",
    "bad-pin": "A PIN is 4 to 8 digits.",
    "not-found": "There's no student with that name. Check it's spelt the way you signed in.",
    "no-pin": "That name has no PIN, so you can sign in with just your name.",
    "no-email": "There's no email saved for that name, so we can't send a code. Ask your teacher to reset your PIN.",
    "too-many-codes": "You've asked for several codes in the last hour. Use the newest one, wait an hour, or ask your teacher to reset your PIN.",
    "mail-failed": "The email couldn't be sent. Ask your teacher to reset your PIN.",
    "wrong-code": "That code isn't right. Check the newest email and try again.",
    "code-expired": "That code has run out or was typed wrong too many times. Ask for a new code."
  };

  function forgotCall(body, onOk) {
    var f = state.auth.forgot;
    f.busy = true;
    f.error = "";
    render();
    callBackend(body).then(function (res) {
      f.busy = false;
      if (res && res.ok) onOk(res);
      else if (res && res.error === "no-email") f.step = "no-email"; // a code can't help: send them to the teacher
      else if (res && res.error === "bad-request") f.error = t("Resetting by email isn't switched on yet. Ask your teacher to reset your PIN.");
      else f.error = t(FORGOT_ERRORS[res && res.error] || "Something went wrong. Try again, or ask your teacher to reset your PIN.");
      render();
    }, function () {
      f.busy = false;
      f.error = t("Couldn't reach the class service. Check your connection and try again.");
      render();
    });
  }

  // Before offering anything, ask the script whether this name has an email
  // saved, so a student without one goes straight to "Ask your teacher".
  function checkForgotName(name) {
    var f = state.auth.forgot;
    f.name = name;
    f.step = "checking";
    f.error = "";
    render();
    function back(step, error) {
      f.step = step;
      f.error = error || "";
      render();
    }
    callBackend({ action: "pinOptions", name: name }).then(function (res) {
      if (state.auth.forgot !== f) return; // they went back meanwhile
      if (res && res.ok) {
        f.name = res.name || name;
        f.sentTo = res.sentTo || "";
        if (!res.hasPin) back("name", t(FORGOT_ERRORS["no-pin"]));
        else back(res.hasEmail ? "email" : "no-email");
      } else if (res && res.error === "bad-request") {
        // A Google script from before this check: ask for the code straight away.
        f.legacy = true;
        back("name");
      } else {
        back("name", t(FORGOT_ERRORS[res && res.error] || "Something went wrong. Try again, or ask your teacher to reset your PIN."));
      }
    }, function () {
      if (state.auth.forgot === f) back("name", t("Couldn't reach the class service. Check your connection and try again."));
    });
  }

  function renderForgotPin() {
    var auth = state.auth;
    var f = auth.forgot;
    function back() { if (f.name) auth.name = f.name; auth.forgot = null; render(); }
    function sendCode(name) {
      f.name = name;
      f.code = "";
      forgotCall({ action: "pinCode", name: name, lang: uiLang }, function (res) { // the email comes in this language
        f.step = "code";
        f.sentTo = res.sentTo || t("your email");
      });
    }
    var error = f.error ? el("p", { class: "notice error", role: "alert", text: f.error }) : null;
    var backButton = el("button", { class: "btn", type: "button", text: t("Back to sign in"), onclick: back });

    if (f.step === "checking") {
      return el("section", { class: "signin" }, [
        el("h1", { text: t("Forgot your PIN?") }),
        el("div", { class: "card" }, [
          el("p", { style: "margin-top:0", role: "status", text: t("Checking how we can help {name}…", { name: f.name }) }),
          el("div", { class: "actions" }, [backButton])
        ])
      ]);
    }

    if (f.step === "no-email") {
      return el("section", { class: "signin" }, [
        el("h1", { text: t("Ask your teacher") }),
        el("div", { class: "card" }, [
          el("p", { style: "margin-top:0", text: t("There's no email saved for {name}, so we can't send a code.", { name: f.name }) }),
          el("p", { text: t("Ask your teacher to clear your PIN. Then sign in with just your name and type a new PIN. Your scores are kept.") }),
          el("p", { class: "hint", text: t("Tip: when you sign in, add your email too. Next time you can reset your PIN yourself.") }),
          el("div", { class: "actions" }, [
            el("button", { class: "btn primary", type: "button", text: t("Back to sign in"), onclick: back })
          ])
        ])
      ]);
    }

    if (f.step === "email") {
      return el("section", { class: "signin" }, [
        el("h1", { text: t("Forgot your PIN?") }),
        el("div", { class: "card" }, [
          el("p", { style: "margin-top:0", text: t("We'll email a 6-digit code to {email}, the address saved for {name}. With the code you choose a new PIN.", { email: f.sentTo, name: f.name }) }),
          error,
          el("div", { class: "actions" }, [
            el("button", { class: "btn primary", type: "button", disabled: f.busy, text: f.busy ? t("Sending…") : t("Email me a code"), onclick: function () { if (!f.busy) sendCode(f.name); } }),
            backButton
          ]),
          el("p", { class: "hint", text: t("Not your email, or no email arriving? Look in your spam folder, or ask your teacher.") })
        ])
      ]);
    }

    if (f.step === "name") {
      var nameInput = el("input", { type: "text", id: "forgot-name", required: true, maxlength: "60", autocomplete: "name", value: f.name || "" });
      return el("section", { class: "signin" }, [
        el("h1", { text: t("Forgot your PIN?") }),
        el("p", { class: "lede", text: t("Type your name and we'll see how to help: a code by email, or your teacher.") }),
        el("form", { class: "card", onsubmit: function (e) {
          e.preventDefault();
          var name = nameInput.value.trim().replace(/\s+/g, " ");
          if (!name || f.busy) return;
          if (f.legacy) sendCode(name);
          else checkForgotName(name);
        } }, [
          el("div", { class: "field" }, [
            el("label", { for: "forgot-name", text: t("Your name") }),
            nameInput,
            el("span", { class: "field-hint", text: t("Exactly as you sign in.") })
          ]),
          error,
          el("div", { class: "actions" }, [
            el("button", { class: "btn primary", type: "submit", disabled: f.busy, text: f.busy ? t("Sending…") : f.legacy ? t("Email me a code") : t("Continue") }),
            backButton
          ])
        ])
      ]);
    }

    // What was typed survives the redraw after a wrong code.
    var codeInput = el("input", { type: "text", id: "forgot-code", required: true, inputmode: "numeric", pattern: "[0-9 ]{6,7}", maxlength: "7", autocomplete: "one-time-code", value: f.code || "" });
    var pinInput = el("input", { type: "password", id: "forgot-pin", required: true, inputmode: "numeric", pattern: "[0-9]{4,8}", maxlength: "8", autocomplete: "off", title: t("4 to 8 digits"), value: f.pin || "" });
    return el("section", { class: "signin" }, [
      el("h1", { text: t("Choose a new PIN") }),
      el("p", { class: "lede", text: t("We sent a 6-digit code to {email}. It works for 15 minutes. If it isn't there, look in your spam folder.", { email: f.sentTo }) }),
      el("form", { class: "card", onsubmit: function (e) {
        e.preventDefault();
        var code = codeInput.value.replace(/\s+/g, "");
        var pin = pinInput.value.trim();
        if (!code || !pin || f.busy) return;
        f.code = code;
        f.pin = pin;
        forgotCall({ action: "pinCodeReset", name: f.name, code: code, pin: pin }, function (res) {
          auth.forgot = null;
          auth.error = "";
          setStudent(res.name || f.name, res.token);
          loadForRoute();
        });
      } }, [
        el("div", { class: "field" }, [el("label", { for: "forgot-code", text: t("Code from the email") }), codeInput]),
        el("div", { class: "field" }, [
          el("label", { for: "forgot-pin", text: t("New PIN") }),
          pinInput,
          el("span", { class: "field-hint", text: t("4 to 8 digits. You'll use it to sign in from now on.") })
        ]),
        error,
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", type: "submit", disabled: f.busy, text: f.busy ? t("Saving…") : t("Save PIN and sign in") }),
          el("button", { class: "btn", type: "button", disabled: f.busy, text: t("Send a new code"), onclick: function () { sendCode(f.name); } }),
          el("button", { class: "btn", type: "button", text: t("Back to sign in"), onclick: back })
        ])
      ])
    ]);
  }

  // After signing in with the teacher's temporary PIN.
  function renderChoosePin() {
    var auth = state.auth;
    var c = auth.choose;
    var pinInput = el("input", { type: "password", id: "choose-pin", required: true, inputmode: "numeric", pattern: "[0-9]{4,8}", maxlength: "8", autocomplete: "off", title: t("4 to 8 digits") });
    return el("section", { class: "signin" }, [
      el("h1", { text: t("Choose your own PIN") }),
      el("p", { class: "lede", text: t("That's your temporary PIN. Now choose a PIN only you know.") }),
      el("form", { class: "card", onsubmit: function (e) {
        e.preventDefault();
        var newPin = pinInput.value.trim();
        if (newPin && !auth.busy) signInStudent(c.name, c.pin, c.email, newPin);
      } }, [
        el("div", { class: "field" }, [
          el("label", { for: "choose-pin", text: t("New PIN") }),
          pinInput,
          el("span", { class: "field-hint", text: t("4 to 8 digits. You'll use it to sign in from now on; the temporary PIN stops working.") })
        ]),
        auth.error ? el("p", { class: "notice error", role: "alert", text: auth.error }) : null,
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", type: "submit", disabled: auth.busy, text: auth.busy ? t("Saving…") : t("Save PIN and sign in") }),
          el("button", { class: "btn", type: "button", text: t("Back to sign in"), onclick: function () { auth.choose = null; auth.error = ""; render(); } })
        ])
      ])
    ]);
  }

  function renderSignIn() {
    var auth = state.auth;
    var teacher = state.teacher;
    if (auth.forgot) return renderForgotPin();
    if (auth.choose) return renderChoosePin();
    // Empty unless typed since the page opened, so the last person's name never shows.
    var nameInput = el("input", { type: "text", id: "signin-name", required: true, maxlength: "60", autocomplete: "name", value: auth.name,
      oninput: function (e) { auth.name = e.target.value; } });
    var emailInput = el("input", { type: "email", id: "signin-email", maxlength: "120", autocomplete: "email", value: auth.email,
      oninput: function (e) { auth.email = e.target.value; } });
    var pinInput = el("input", { type: "password", id: "signin-pin", inputmode: "numeric", pattern: "[0-9]{3,8}", maxlength: "8", autocomplete: "off", title: t("4 to 8 digits, or a 3-digit temporary PIN from your email") });
    var passInput = el("input", { type: "password", id: "signin-passcode", required: true, autocomplete: "current-password" });

    return el("section", { class: "signin" }, [
      el("h1", { text: t("Welcome to Hebrew Class") }),
      el("p", { class: "lede", text: t("Sign in with your name to see the lessons and keep track of your progress.") }),
      el("form", {
        class: "card",
        onsubmit: function (e) {
          e.preventDefault();
          var name = nameInput.value.trim().replace(/\s+/g, " ");
          if (name && !auth.busy) {
            var email = emailInput.value.trim();
            auth.name = name;
            auth.email = email;
            signInStudent(name, pinInput.value.trim(), email);
          }
        }
      }, [
        el("div", { class: "field" }, [
          el("label", { for: "signin-name", text: t("Your name") }),
          nameInput,
          el("span", { class: "field-hint", text: t("Use the same name every time.") })
        ]),
        el("div", { class: "field" }, [
          el("label", { for: "signin-email", text: t("Email (optional)") }),
          emailInput,
          el("span", { class: "field-hint", text: t("Only your teacher sees it.") })
        ]),
        el("div", { class: "field" }, [
          el("label", { for: "signin-pin", text: t("PIN (optional)") }),
          pinInput,
          el("span", { class: "field-hint", text: t("Choose 4 digits and only you can see your progress report. You'll need it to sign in again.") }),
          el("span", { class: "field-hint" }, [
            el("button", { class: "linklike", type: "button", text: t("Forgot your PIN?"), onclick: function () {
              auth.error = "";
              var name = nameInput.value.trim().replace(/\s+/g, " ");
              auth.forgot = { step: "name", name: name };
              if (name) checkForgotName(name); // the name is already typed: check it straight away
              else render();
            } }),
            document.createTextNode(" " + t("Get a code by email, or ask your teacher. Your scores are kept."))
          ])
        ]),
        auth.error ? el("p", { class: "notice error", role: "alert", text: auth.error }) : null,
        el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", disabled: auth.busy, text: auth.busy ? t("Signing in…") : t("Sign in") })]),
        config.resultsUrl ? el("p", { class: "field-hint signin-note", text: t("Your teacher also sees which country you're in, from your device's time zone.") }) : null
      ]),
      config.resultsUrl ? el("details", { class: "teacher-signin", open: !!teacher.error }, [
        el("summary", { text: t("Teacher? Sign in here") }),
        teacher.error ? el("p", { class: "notice error", role: "alert", text: t(teacher.error) }) : null,
        el("form", {
          onsubmit: function (e) {
            e.preventDefault();
            var code = passInput.value.trim();
            if (code) signInTeacher(code);
          }
        }, [
          el("div", { class: "field" }, [el("label", { for: "signin-passcode", text: t("Teacher passcode") }), passInput]),
          el("button", { class: "btn", type: "submit", text: t("Sign in as teacher") })
        ])
      ]) : null
    ]);
  }

  // The passcode is checked by loading the results; a wrong one signs out again.
  function signInTeacher(code) {
    var t = state.teacher;
    t.passcode = code;
    t.error = "";
    writeSetting("hebrewClass.teacherPasscode", code);
    loadResults();
    loadForRoute();
    render();
    startLivePolling();
  }

  /* ---------- Top menu ---------- */

  function renderNav() {
    var nav = document.getElementById("topnav");
    var user = document.getElementById("topuser");
    if (!nav || !user) return;
    nav.textContent = "";
    user.textContent = "";
    nav.hidden = !signedIn();
    var brand = document.querySelector(".brand");
    if (brand && brand.firstChild && brand.firstChild.nodeType === 3) brand.firstChild.nodeValue = t("Hebrew Class") + " ";
    // On this computer the site talks to the test copy of the sheet; say so.
    if (config.testing) user.appendChild(el("span", { class: "test-badge", title: t("Using the test copy of the Google Sheet"), text: t("Test data") }));
    user.appendChild(languageMenu());
    var view = state.route.view;
    function link(href, text, active, icon) {
      return el("a", { class: "mainnav-link" + (active ? " active" : ""), href: href, "aria-current": active ? "page" : null }, [icon, text]);
    }
    if (!signedIn()) {
      user.appendChild(el("a", { class: "topnav-out", href: "#/teacher", text: t("Teacher") }));
      return;
    }
    var tab = view === "lesson" ? state.route.tab : "";
    var inStudy = view === "study" || view === "suggestions" || STUDY_TABS.indexOf(tab) >= 0;
    var lesson = currentLesson();
    // Live class goes to the running class (known once the Live class page has
    // checked), otherwise to the latest lesson; the teacher can choose another there.
    var liveLesson = (live.remote && live.remote.running && findLesson(live.remote.lessonId)) || lessons[0] || null;
    nav.appendChild(el("div", { class: "mainnav-inner" }, [
      link("#/", t("Lessons"), view === "home" || tab === "sheet"),
      link(lesson ? lessonUrl(lesson, "cards") : "#/study", t("Self study"), inStudy),
      link(liveLesson ? lessonUrl(liveLesson, "live") : "#/", t("Live class|menu"), tab === "live", liveDot()),
      isTeacher()
        ? link("#/teacher", t("Teacher"), view === "teacher" || view === "progress")
        : link("#/progress", t("My progress"), view === "progress"),
      link("#/share", t("Share"), view === "share")
    ]));
    if (!isTeacher()) user.appendChild(el("span", { class: "topnav-name", text: state.student.name }));
    user.appendChild(el("button", { class: "topnav-out", type: "button", text: t("Sign out"), onclick: signOut }));
  }

  function renderHome() {
    var wrap = el("section", null, [
      renderBoard(),
      el("h1", { text: t("Weekly lessons") }),
      el("p", { class: "lede", text: t("Open a lesson to see and print its one-page sheet.") })
    ]);
    if (state.loadErrors.length) {
      wrap.appendChild(el("p", { class: "notice error", text: t("Some lessons could not be loaded: ") + state.loadErrors.join(", ") }));
    }
    if (!lessons.length) {
      wrap.appendChild(el("p", { class: "notice", text: t("No lessons yet.") }));
      return wrap;
    }
    var list = el("ul", { class: "lesson-list" });
    lessons.forEach(function (lesson, i) {
      list.appendChild(el("li", null, [
        el("a", { class: "lesson-card", href: lessonUrl(lesson, "sheet") }, [
          i === 0 ? el("span", { class: "lesson-latest", text: t("Latest") }) : null,
          el("span", { class: "lesson-title", text: lessonName(lesson) }),
          el("span", { class: "lesson-meta", text: t("{phrases} phrases in {sections} sections", { phrases: lesson.sections.reduce(function (n, sec) { return n + sec.rows.length; }, 0), sections: lesson.sections.length }) })
        ])
      ]));
    });
    wrap.appendChild(list);
    return wrap;
  }

  /* ---------- Championship board ----------
     Last week's champion and this week's top 3, from the Google script, which
     counts points for effort (the rules are in "How to earn points" below).
     The script takes a second or two to answer, so the browser keeps the last
     board it saw and shows that straight away while it asks again, also after
     signing out and in. A student's own points in it are shown only to that
     student, and signing out removes them. With no saved board the card stays
     hidden until the script answers, and with a script from before the board. */

  var BOARD_REFRESH_MS = 60000;
  var BOARD_SAVED = "hebrewClass.board";
  var MEDALS = ["🥇", "🥈", "🥉"];

  // Who the board was read for: "Your points" belong to that student only.
  function boardOwner() {
    return state.student ? "student:" + studentKey(state.student.name) : "teacher";
  }

  function readSavedBoard() {
    try {
      var saved = JSON.parse(readSetting(BOARD_SAVED, "") || "null");
      return saved && saved.data ? saved : null;
    } catch (e) {
      return null;
    }
  }

  // The board this browser saw last, if it is from this week (the week starts
  // on Sunday), with "Your points" only if it was read for whoever is signed in now.
  function savedBoard() {
    var saved = readSavedBoard();
    var sunday = dayKey(addDays(new Date(), -new Date().getDay()));
    if (!saved || saved.data.weekStart !== sunday) return null;
    if (saved.owner !== boardOwner()) saved.data.me = null;
    return saved.data;
  }

  // Signing out keeps the saved board everyone sees, for the next sign-in,
  // but not the student's own points.
  function forgetMyPoints() {
    var saved = readSavedBoard();
    if (!saved) return;
    saved.data.me = null;
    writeSetting(BOARD_SAVED, JSON.stringify({ owner: "", data: saved.data }));
  }

  function loadBoard() {
    var b = state.board;
    if (!config.resultsUrl || b.off) return;
    if (!b.data) b.data = savedBoard();
    if (b.loading) return;
    if (b.at && Date.now() - b.at < BOARD_REFRESH_MS) return;
    b.loading = true;
    var owner = boardOwner();
    var body = { action: "board" };
    if (state.student) asStudent(body); // to show the student their own points
    callBackend(body).then(function (res) {
      if (owner !== boardOwner() || !signedIn()) return; // signed out or someone else signed in meanwhile
      if (res && res.ok && res.leaders) {
        b.data = res;
        b.at = Date.now();
        writeSetting(BOARD_SAVED, JSON.stringify({ owner: owner, data: res }));
      }
      else if (res && res.error === "bad-request") b.off = true;
    }, function () { /* no board this time */ }).then(function () {
      b.loading = false;
      if (b.again) {
        // Points changed while this was on its way: read them again.
        b.again = false;
        b.at = 0;
        if (state.route.view === "home") { loadBoard(); return; }
      }
      if (state.route.view === "home") render();
    });
  }

  // A quiz, Word of the day or live class just saved: the student's points
  // changed, so the board is read again (straight away if it's on screen).
  function boardChanged() {
    var b = state.board;
    b.at = 0;
    if (b.loading) b.again = true;
    else if (state.route.view === "home") loadBoard();
  }

  function pointsText(n) {
    return t(n === 1 ? "{n} point" : "{n} points", { n: n });
  }

  // "Dana", "Dana and Moshe", "Dana, Moshe and Rina"
  function namesText(list) {
    var names = list.map(function (s) { return s.name; });
    if (names.length < 2) return names[0];
    var last = names[names.length - 1];
    var joined = t("{list} and {last}", { list: names.slice(0, -1).join(", "), last: last });
    // Spanish "y" becomes "e" before an "i" sound: "Dana e Isabel".
    var tail = " y " + last;
    if (uiLang === "es" && /^h?i(?![aeiouáéíóú])/i.test(last) && joined.slice(-tail.length) === tail) {
      return joined.slice(0, -tail.length) + " e " + last;
    }
    return joined;
  }

  function renderBoard() {
    var d = state.board.data;
    if (!d) return null;
    var champions = d.champions || [];
    var leaders = d.leaders || [];
    var myKey = state.student ? studentKey(state.student.name) : "";
    return el("section", { class: "card champ-board no-print", "aria-labelledby": "champ-title" }, [
      el("h2", { id: "champ-title", class: "visually-hidden", text: t("Championship board") }),
      champions.length ? el("p", { class: "champ-last" }, [
        el("span", { class: "champ-cup", "aria-hidden": "true", text: "🏆" }),
        el("span", null, [
          t(champions.length > 1 ? "Last week's Hebrew champions:" : "Last week's Hebrew champion:") + " ",
          el("strong", { text: namesText(champions) }),
          el("span", { class: "champ-last-points", text: " · " + pointsText(champions[0].points) })
        ])
      ]) : null,
      el("h3", { class: "champ-title", text: t("This week so far") }),
      leaders.length ? el("ul", { class: "champ-list" }, leaders.map(function (s) {
        var mine = myKey && studentKey(s.name) === myKey;
        return el("li", { class: mine ? "mine" : null }, [
          el("span", { class: "champ-place", text: MEDALS[s.place - 1] || String(s.place) }),
          el("span", { class: "champ-name", text: s.name + (mine ? " " + t("(you)") : "") }),
          el("span", { class: "champ-points", text: pointsText(s.points) })
        ]);
      })) : el("p", { class: "champ-empty", text: d.me && d.me.points
        ? t("Nobody is on the board yet this week.") // the student has points but their name is hidden
        : t("No points yet this week. Take a quiz or practise the Word of the day to lead the board!") }),
      renderMyPoints(d.me, leaders.length > 0),
      el("details", { class: "champ-how", open: state.board.howOpen, ontoggle: function (e) { state.board.howOpen = e.target.open; } }, [
        el("summary", { text: t("How to earn points") }),
        el("ul", null, [
          el("li", { text: t("1 point for each correct quiz answer (your best try at each quiz counts)") }),
          el("li", { text: t("2 points for each Word of the day you practise, today's or one from the past week") }),
          el("li", { text: t("10 points for joining the live class") })
        ]),
        el("p", { text: t("Weeks run from Sunday to Saturday, and everyone starts the new week at zero.") })
      ])
    ]);
  }

  // The signed-in student's points this week. Opening the line shows where
  // they came from (with a Google script from before the breakdown, just the total).
  function renderMyPoints(me, anyLeaders) {
    if (!me) return null;
    if (!me.points) return anyLeaders ? el("p", { class: "champ-me", text: t("You don't have any points yet this week.") }) : null;
    var total = t("You have {points} this week.", { points: pointsText(me.points) });
    var hidden = me.hidden ? el("p", { class: "champ-hidden", text: t("Your name is hidden from the board, so only you see your points.") }) : null;
    if (!me.parts) return el("div", null, [el("p", { class: "champ-me", text: total }), hidden]);
    return el("div", null, [
      el("details", { class: "champ-me-more", open: state.board.meOpen, ontoggle: function (e) { state.board.meOpen = e.target.open; } }, [
        el("summary", { text: total }),
        renderPointParts(me.parts)
      ]),
      hidden
    ]);
  }

  function renderPointParts(parts) {
    function count(n, one, many) {
      return n ? " (" + t(n === 1 ? one : many, { n: n }) + ")" : "";
    }
    function row(label, points) {
      return el("li", null, [
        el("span", { text: label }),
        el("span", { class: "champ-parts-points", text: pointsText(points) })
      ]);
    }
    return el("ul", { class: "champ-parts", "aria-label": t("Your points this week") }, [
      row(t("Quizzes") + count(parts.quizzes, "{n} quiz", "{n} quizzes"), parts.quizPoints || 0),
      row(t("Word of the day") + count(parts.days, "{n} word", "{n} words"), parts.practicePoints || 0),
      row(t("Live class") + count(parts.classes, "{n} class", "{n} classes"), parts.classPoints || 0)
    ]);
  }

  /* ---------- Sharing the site ---------- */

  var SHARE_TEXT = "Hebrew Class: the weekly lesson sheet, short quizzes and a Hebrew word of the day.";

  function touchScreen() {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  }

  // A signed-in student shares their own link (it ends in their invite code),
  // so the teacher sees who joined through them. Nothing on the page mentions
  // it yet. Until the code arrives (it's fetched ahead, see loadInviteCode),
  // the plain link shows.
  function renderShare() {
    var inv = state.invite;
    var base = config.siteUrl || location.href.split("#")[0].split("?")[0];
    var own = !!(state.student && inv.code && inv.forKey === studentKey(state.student.name));
    var url = own ? base + "?ref=" + inv.code : base;
    var message = t(SHARE_TEXT) + " " + url;
    var status = el("span", { class: "share-status", role: "status" });
    function copyLink() {
      function failed() { status.textContent = t("Couldn't copy it. Select the link above and copy it."); }
      if (!navigator.clipboard || !navigator.clipboard.writeText) return failed();
      navigator.clipboard.writeText(url).then(function () { status.textContent = t("Link copied."); }, failed);
    }
    return el("section", { class: "no-print" }, [
      el("h1", { text: t("Share Hebrew Class") }),
      el("p", { class: "lede", text: t("Send the link to a classmate or a friend.") }),
      el("div", { class: "card share-card" }, [
        el("p", { class: "share-link", text: url }),
        el("div", { class: "actions" }, [
          // The phone's own share sheet (WhatsApp, Messages, …). Only on touch
          // screens: on a computer it opens Windows' share window, which the
          // buttons beside it already cover.
          navigator.share && touchScreen() ? el("button", { class: "btn primary", type: "button", text: t("Share…"), onclick: function () {
            navigator.share({ title: t("Hebrew Class"), text: t(SHARE_TEXT), url: url }).catch(function () { /* closed without sharing */ });
          } }) : null,
          el("a", { class: "btn", href: "https://wa.me/?text=" + encodeURIComponent(message), target: "_blank", rel: "noopener", text: t("WhatsApp") }),
          el("a", { class: "btn", href: "mailto:?subject=" + encodeURIComponent(t("Hebrew Class")) + "&body=" + encodeURIComponent(message), text: t("Email") }),
          el("button", { class: "btn", type: "button", text: t("Copy link"), onclick: copyLink })
        ]),
        status
      ])
    ]);
  }

  function renderNotFound() {
    return el("section", null, [
      el("a", { class: "back", href: "#/", text: t("← All lessons") }),
      el("h1", { text: t("Lesson not found") }),
      el("p", { class: "lede", text: t("This link may be out of date. Pick a lesson from the list.") })
    ]);
  }

  function renderLesson(lesson) {
    var tab = state.route.tab;
    var study = STUDY_TABS.indexOf(tab) >= 0;
    // Kept short so the word card fits on a phone screen. Self study and Live
    // class are in the top menu, the video is under Resources, and only the
    // sheet (opened from the list of lessons) links back to that list. On the
    // Self study pages the menu is at the top and the title is for screen readers only.
    // So is it for a student on Live class until this lesson is live. On the
    // Quiz and Word by word it shows under the Self study buttons instead, as
    // the lesson chosen from their lists.
    var named = tab === "quiz" || tab === "cards";
    var quietTitle = study || (tab === "live" && !isLiveTeacher() && !liveHere(lesson));
    var title = el("h1", { class: named ? "study-lesson" : quietTitle ? "visually-hidden" : null, text: lessonName(lesson) });
    var head = el("div", { class: "lesson-head no-print" }, [
      tab === "sheet" ? el("a", { class: "back", href: "#/", text: t("← All lessons") }) : null,
      named ? null : title
    ]);
    var body = tab === "quiz" ? renderQuiz(lesson)
      : tab === "cards" ? renderCards(lesson)
      : tab === "resources" ? renderResources(lesson)
      : tab === "live" ? renderLive(lesson)
      : renderSheetTab(lesson);
    return el("section", null, [head, study ? studyNav(tab, lesson) : null, named ? title : null, body]);
  }

  // The Self study menu. The Quiz, Word by word and Resources belong to a
  // lesson: the one that is open, or the one last opened, or the latest one.
  function studyNav(active, lesson) {
    lesson = lesson || currentLesson();
    function item(key, href, text) {
      return el("a", { class: "subtab" + (active === key ? " active" : ""), href: href, "aria-current": active === key ? "page" : null, text: text });
    }
    var quiz = lesson ? lessonPicker("quiz", t("Quiz"), active, lesson) : {};
    var cards = lesson ? lessonPicker("cards", t("Word by word"), active, lesson) : {};
    return el("nav", { class: "subtabs no-print", "aria-label": t("Self study") }, [
      quiz.button,
      cards.button,
      item("word", "#/study/word", t("Word of the day")),
      item("say", "#/study/say", t("How to say")),
      lesson ? item("resources", lessonUrl(lesson, "resources"), t("Resources")) : null,
      item("suggestions", "#/suggestions", t("Suggestions")),
      quiz.menu, // the lesson lists open below all the buttons
      cards.menu
    ]);
  }

  // The Quiz and Word by word buttons open their page for the current lesson,
  // with the list of lessons on top. Choosing one opens that lesson there, and
  // the other Self study pages follow it. Returns { button, menu }.
  // opts.choose, when given, is called with the lesson chosen instead of opening
  // it (a running live class moves there); opts.title replaces the list's title.
  function lessonPicker(tab, text, active, current, opts) {
    opts = opts || {};
    var id = "lesson-menu-" + tab;
    var open = openLessonMenu === tab;
    var menu = el("div", { class: "lesson-menu", id: id, hidden: !open }, [
      el("p", { class: "lesson-menu-title", text: opts.title || t("Choose a lesson") }),
      el("ul", null, lessons.map(function (lesson, i) {
        var here = lesson === current;
        return el("li", null, [
          el("a", {
            href: lessonUrl(lesson, tab),
            class: here ? "current" : null,
            "aria-current": here ? (active === tab ? "page" : "true") : null,
            onclick: function (e) {
              closeLessonMenus(); // needed when it's the page already open: the address doesn't change
              if (opts.choose && !here) {
                e.preventDefault();
                opts.choose(lesson);
              }
            }
          }, [
            el("span", { class: "lesson-menu-text" }, [
              el("span", { class: "lesson-menu-number", text: t("Lesson {n}", { n: lesson.number }) + (i === 0 ? " · " + t("Latest") : "") }),
              el("span", { class: "lesson-menu-name", text: localText(lesson, "title") })
            ]),
            here ? el("span", { class: "lesson-menu-check", "aria-hidden": "true", text: "✓" }) : null
          ])
        ]);
      }))
    ]);
    var button = el("button", {
      type: "button",
      class: "subtab subtab-picker" + (active === tab ? " active" : ""),
      "aria-expanded": open ? "true" : "false",
      "aria-controls": id,
      onclick: function (e) {
        // From another page, go to this one first: the button turns blue and
        // the quiz or the cards show behind the list.
        if (active !== tab) {
          closeLessonMenus();
          openLessonMenu = tab;
          focusLessonMenu = e.detail === 0;
          location.hash = lessonUrl(current, tab);
          return;
        }
        var opening = menu.hidden;
        closeLessonMenus();
        if (!opening) return;
        menu.hidden = false;
        openLessonMenu = tab;
        button.setAttribute("aria-expanded", "true");
        // Opened from the keyboard: go straight to the list, which comes after the other buttons.
        if (e.detail === 0) (menu.querySelector("a.current") || menu.querySelector("a")).focus();
      }
    }, [text, chevronIcon()]);
    return { button: button, menu: menu };
  }

  // Closes an open lesson list; returns its button, or null if none was open.
  function closeLessonMenus() {
    var opener = null;
    openLessonMenu = null;
    document.querySelectorAll(".lesson-menu:not([hidden])").forEach(function (menu) {
      menu.hidden = true;
      opener = document.querySelector('[aria-controls="' + menu.id + '"]');
      if (opener) opener.setAttribute("aria-expanded", "false");
    });
    return opener;
  }

  // The lesson's video and picture (more kinds of resource can be added here later).
  function renderResources(lesson) {
    var items = [];
    var picture = localText(lesson, "picture");
    if (lesson.video) {
      items.push(el("a", { class: "resource", href: lesson.video, target: "_blank", rel: "noopener" }, [
        el("span", { class: "resource-icon", "aria-hidden": "true", text: "▶" }),
        el("span", { class: "resource-text" }, [
          el("span", { class: "resource-kind", text: t("Video") }),
          el("span", { class: "resource-title", text: lesson.videoTitle || lesson.video }),
          el("span", { class: "resource-meta", text: t("Opens in a new tab") })
        ])
      ]));
    }
    if (picture) {
      // Opening it on its own lets a phone zoom in on it.
      items.push(el("figure", { class: "resource-picture" }, [
        el("figcaption", { class: "resource-text" }, [
          el("span", { class: "resource-kind", text: t("Picture") }),
          el("span", { class: "resource-title", text: picture.title || "" })
        ]),
        el("a", { href: picture.src, target: "_blank", rel: "noopener" }, [
          el("img", { src: picture.src, alt: picture.title || "", width: picture.width, height: picture.height })
        ]),
        el("a", { class: "resource-meta", href: picture.src, target: "_blank", rel: "noopener", text: t("Open full size") })
      ]));
    }
    return el("div", { class: "resources" }, [
      el("h2", { text: t("Resources"), style: "margin-top:0" }),
      items.length
        ? el("div", { class: "resource-list" }, items)
        : el("p", { class: "notice", text: t("No resources for this lesson yet.") })
    ]);
  }

  function niqqudToggle() {
    return settingToggle(t("Show vowel marks (niqqud)"), "niqqud", "hebrewClass.niqqud");
  }

  // Shown where answers are picked (the quiz and the Word of the day check).
  function trToggle() {
    return settingToggle(t("Show transliteration"), "showTr", "hebrewClass.transliteration");
  }

  // A checkbox for a state flag that this browser remembers.
  function settingToggle(label, key, setting) {
    return el("label", { class: "toggle" }, [
      el("input", {
        type: "checkbox",
        checked: state[key],
        onchange: function (e) {
          state[key] = e.target.checked;
          writeSetting(setting, state[key] ? "1" : "0");
          render();
        }
      }),
      label
    ]);
  }

  /* ---------- Lesson sheet ---------- */

  function renderSheetTab(lesson) {
    var toolbar = el("div", { class: "toolbar no-print" }, [
      niqqudToggle(),
      el("button", { class: "btn primary", type: "button", onclick: function () { window.print(); }, text: t("Print or save as PDF") })
    ]);
    var hint = el("p", { class: "hint no-print", text: t("To download the sheet, press Print and choose “Save as PDF” as the printer.") });
    // fitSheet fills this with one or more pages once it is on screen.
    var pages = el("div", { class: "sheet-pages", id: "sheet-pages" });
    pages.lesson = lesson;
    return el("div", null, [toolbar, hint, pages]);
  }

  // One printed page holding the sections numbered from..to-1 (0-based).
  function buildSheet(lesson, from, to, pageNo, pageCount) {
    var tbody = el("tbody");
    lesson.sections.slice(from, to).forEach(function (section, i) {
      var si = from + i;
      tbody.appendChild(el("tr", { class: "section" }, [
        el("td", { colspan: "3", text: (si + 1) + ". " + localText(section, "title") })
      ]));
      var explanation = localText(section, "explanation");
      if (explanation) {
        tbody.appendChild(el("tr", { class: "explain" }, [
          el("td", { colspan: "3", text: heb(explanation) })
        ]));
      }
      section.rows.forEach(function (row) {
        tbody.appendChild(el("tr", null, [
          el("td", { text: meaning(row) }),
          el("td", { class: "tr" }, formSpans(row, function (f) {
            return f.tr + (f.g ? " (" + f.g + ")" : "");
          })),
          el("td", { class: "he", lang: "he", dir: "rtl" }, formSpans(row, function (f) {
            return heb(f.he);
          }, true).concat([
            // Sits in the page's right margin so it never changes the sheet's fit.
            speakButton(row.forms.map(function (f) { return f.he; }), "sheet-speak")
          ]))
        ]));
      });
    });

    var table = el("table", null, [
      el("colgroup", null, [
        el("col", { style: "width:36%" }),
        el("col", { style: "width:35%" }),
        el("col", { style: "width:29%" })
      ]),
      el("thead", null, [el("tr", null, [
        el("th", { text: t("English") }),
        el("th", { text: t("Transliteration") }),
        el("th", { class: "he" }, [t("Hebrew") + " ", el("span", { lang: "he", dir: "rtl", text: heb("עִבְרִית") })])
      ])]),
      tbody
    ]);

    var first = pageNo === 1;
    var last = pageNo === pageCount;
    var pageLabel = pageCount > 1 ? t("Page {n} of {count}", { n: pageNo, count: pageCount }) : "";
    var picture = localText(lesson, "picture");
    return el("div", { class: "sheet" }, [
      first ? el("h2", { class: "sheet-title", text: localText(lesson, "title") }) : null,
      el("p", { class: "sheet-subtitle", text: (first
        ? [localText(lesson, "subtitle"), pageLabel]
        : [localText(lesson, "title"), pageLabel]).filter(Boolean).join(" · ") }),
      table,
      // Its width and height let fitSheet measure it before it has loaded.
      last && picture ? el("img", { class: "sheet-picture", src: picture.src, alt: picture.title || "", width: picture.width, height: picture.height }) : null,
      last && lesson.notes ? el("p", { class: "sheet-notes" }, [el("strong", { text: t("Notes: ") }), localText(lesson, "notes")]) : null,
      last && lesson.video ? el("p", { class: "sheet-notes" }, [
        el("strong", { text: t("Video: ") }),
        // The address stays visible so it still works on paper; in a saved PDF it is clickable.
        el("a", { href: lesson.video, target: "_blank", rel: "noopener", text: (lesson.videoTitle ? lesson.videoTitle + " – " : "") + lesson.video })
      ]) : null
    ]);
  }

  // Male and female forms share a line when there is room; each form stays whole.
  // With speakable, clicking a Hebrew form reads just that form aloud.
  function formSpans(row, textOf, speakable) {
    var nodes = [];
    row.forms.forEach(function (f, i) {
      if (i > 0) nodes.push(el("span", { class: "sep", text: " · " }));
      nodes.push(el("span", {
        class: "form" + (speakable ? " speakable" : ""),
        title: speakable ? t("Click to listen") : null,
        onclick: speakable ? function () { speak(f.he); } : null,
        text: textOf(f)
      }));
    });
    return nodes;
  }

  // Lay the sheet out on as few pages as keep the font readable: one page if it
  // fits at READABLE_FONT or more, otherwise split the sections between pages
  // (never inside a section) and pick the split with the largest font.
  function fitSheet() {
    var holder = document.getElementById("sheet-pages");
    if (!holder || !holder.lesson) return;
    var lesson = holder.lesson;
    var n = lesson.sections.length;
    var best = null;
    for (var count = 1; count <= Math.min(MAX_PAGES, Math.max(1, n)); count++) {
      splits(n, count).forEach(function (cuts) {
        var pages = layoutPages(holder, lesson, cuts);
        var size = Math.min.apply(null, pages.map(fitPage));
        if (!best || size > best.size) best = { cuts: cuts, size: size };
      });
      if (best.size >= READABLE_FONT) break;
    }
    // Same font size on every page, so the pages look alike.
    layoutPages(holder, lesson, best.cuts).forEach(function (page) {
      page.firstChild.style.fontSize = best.size + "px";
    });
    scalePage();
  }

  // Every way to cut n sections into count non-empty runs, as lists of start indexes.
  function splits(n, count) {
    if (count === 1) return [[0]];
    var out = [];
    (function pick(cuts, from, left) {
      if (left === 0) { out.push(cuts); return; }
      for (var i = from; i <= n - left; i++) pick(cuts.concat([i]), i + 1, left - 1);
    })([0], 1, count - 1);
    return out;
  }

  function layoutPages(holder, lesson, cuts) {
    holder.textContent = "";
    var pages = cuts.map(function (from, i) {
      var to = i + 1 < cuts.length ? cuts[i + 1] : lesson.sections.length;
      var page = el("div", { class: "page" }, [buildSheet(lesson, from, to, i + 1, cuts.length)]);
      holder.appendChild(el("div", { class: "page-frame" }, [page]));
      return page;
    });
    return pages;
  }

  // Largest font size (in 0.25px steps) at which this page's sheet fits.
  function fitPage(page) {
    var sheet = page.firstChild;
    var maxHeight = PAGE_H - 2 * PAGE_PAD;
    var lo = MIN_FONT * 4;
    var hi = MAX_FONT * 4;
    while (lo < hi) {
      var mid = Math.ceil((lo + hi) / 2);
      sheet.style.fontSize = mid / 4 + "px";
      if (sheet.offsetHeight <= maxHeight) lo = mid; else hi = mid - 1;
    }
    sheet.style.fontSize = lo / 4 + "px";
    return lo / 4;
  }

  function scalePage() {
    var frames = document.querySelectorAll("#sheet-pages .page-frame");
    Array.prototype.forEach.call(frames, function (frame) {
      var scale = Math.min(1, frame.clientWidth / PAGE_W);
      frame.firstChild.style.transform = "scale(" + scale + ")";
      frame.style.height = Math.ceil(PAGE_H * scale) + "px";
    });
  }

  /* ---------- Word by word ---------- */

  // Every row of the lesson in order, with its section, for stepping through one at a time.
  function cardList(lesson) {
    var list = [];
    lesson.sections.forEach(function (section, si) {
      section.rows.forEach(function (row) {
        list.push({ row: row, section: section, sectionNo: si + 1 });
      });
    });
    return list;
  }

  function moveCard(step) {
    var c = state.cards;
    if (!c) return;
    var next = Math.max(0, Math.min(c.count - 1, c.index + step));
    if (next === c.index) return;
    c.index = next;
    render();
  }

  function genderLabel(row, g) {
    var toSomeone = TO_MARK.test(row.en);
    if (g === "m") return t(toSomeone ? "To a man" : "Male");
    return t(toSomeone ? "To a woman" : "Female");
  }

  function renderCards(lesson) {
    var list = cardList(lesson);
    if (!state.cards) state.cards = { lessonId: lesson.id, index: 0 };
    var c = state.cards;
    c.count = list.length;
    if (!list.length) return el("p", { class: "notice", text: t("This lesson has no phrases yet.") });
    if (c.index >= list.length) c.index = list.length - 1;
    var first = c.index === 0;
    var last = c.index === list.length - 1;
    var card = wordCard(list[c.index]);
    addSwipe(card);

    var pct = Math.round(((c.index + 1) / list.length) * 100);
    var nav = el("div", { class: "card-nav" }, [
      el("button", { class: "btn", type: "button", disabled: first, onclick: function () { moveCard(-1); }, text: t("← Previous") }),
      el("span", { class: "card-count", "aria-live": "polite", text: (c.index + 1) + " / " + list.length }),
      last
        ? el("button", { class: "btn primary", type: "button", onclick: function () { c.index = 0; render(); }, text: t("Start over") })
        : el("button", { class: "btn primary", type: "button", onclick: function () { moveCard(1); }, text: t("Next word →") })
    ]);

    return el("div", { class: "cards-view" }, [
      el("div", { class: "toolbar study-toolbar no-print" }, [niqqudToggle()]),
      el("div", { class: "progress-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + pct + "%" })]),
      card,
      nav,
      sectionExplanation(list[c.index]),
      el("p", { class: "hint card-hint", text: t("Tip: use the ← → arrow keys to move between words.") })
    ]);
  }

  // One phrase as a big card: section at the top, then English, then Hebrew
  // (both forms when there are two) with transliteration.
  function wordCard(item) {
    return el("div", { class: "card word-card" }, [
      el("p", { class: "card-section", text: item.sectionNo + ". " + localText(item.section, "title") }),
      cardBody(item.row)
    ]);
  }

  // The section's explanation goes under the buttons, so on a phone the word
  // and Next are on screen without scrolling.
  function sectionExplanation(item) {
    var text = localText(item.section, "explanation");
    return text ? el("p", { class: "card-explain", text: heb(text) }) : null;
  }

  // English, then each Hebrew form with its transliteration and a listen button.
  function cardBody(row) {
    var forms = row.forms.map(function (f) {
      return el("div", { class: "card-form" }, [
        f.g ? el("span", { class: "card-gender", text: genderLabel(row, f.g) }) : null,
        el("p", { class: "card-he", lang: "he", dir: "rtl", text: heb(f.he) }),
        el("p", { class: "card-tr", text: f.tr }),
        speakButton(f.he, "big")
      ]);
    });

    var en = meaning(row).replace(TO_MARK, "").replace(MF_MARK, "");
    // Whole sentences get smaller type on a phone, so Next still fits on screen.
    var long = en.length > 30 || row.forms.some(function (f) { return plain(f.he).length > 24; });
    return el("div", { class: "card-body" + (long ? " long" : "") }, [
      el("p", { class: "card-en", text: en }),
      el("div", { class: "card-forms" + (forms.length > 1 ? " two" : "") }, forms)
    ]);
  }

  // Swipe left for the next word, right for the previous one.
  function addSwipe(node, move) {
    move = move || moveCard;
    var startX = null;
    var startY = null;
    node.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { startX = null; return; }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    node.addEventListener("touchend", function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
    });
  }

  /* ---------- Quiz ---------- */

  // A lesson's phrases are dealt out once, in a fixed mixed order, into up to
  // QUIZ_COUNT short quizzes, so Quiz 1 always covers the same phrases and
  // the quizzes don't repeat each other. Each quiz is CHOICES_PER_QUIZ
  // multiple-choice questions and one matching round.
  function quizPlan(lesson) {
    if (lesson.quizPlan) return lesson.quizPlan;
    var seen = {};
    var rows = [];
    lesson.sections.forEach(function (section) {
      section.rows.forEach(function (row) {
        // Two rows with the same Hebrew can't both be in a matching round.
        var key = plain(row.forms[0].he);
        if (seen[key]) return;
        seen[key] = true;
        rows.push(row);
      });
    });
    seededShuffle(rows, hashText(lesson.id));
    var size = CHOICES_PER_QUIZ + PAIRS_PER_QUIZ;
    var count = Math.max(rows.length ? 1 : 0, Math.min(QUIZ_COUNT, Math.floor(rows.length / size)));
    var plan = [];
    for (var i = 0; i < count; i++) {
      var chunk = rows.slice(i * size, (i + 1) * size);
      var pairs = chunk.slice(CHOICES_PER_QUIZ);
      // A short lesson: too few left for a matching round, so ask them as choices.
      plan.push(pairs.length >= 3 ? { choice: chunk.slice(0, CHOICES_PER_QUIZ), match: pairs } : { choice: chunk, match: [] });
    }
    lesson.quizPlan = plan;
    return plan;
  }

  // The same order every time for the same seed.
  function seededShuffle(list, seed) {
    var s = seed >>> 0;
    function random() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function anyForm(row) {
    return row.forms[Math.floor(Math.random() * row.forms.length)];
  }

  // Quiz number `number` (1-based) of the lesson. The matching round counts as one question.
  function buildQuiz(lesson, number) {
    var part = quizPlan(lesson)[number - 1];
    var items = part.choice.map(function (row) {
      var form = anyForm(row);
      return { type: "choice", form: form, options: makeOptions(form, lesson.forms), picked: null };
    });
    if (part.match.length) {
      var forms = part.match.map(anyForm);
      items.push({
        type: "match",
        pairs: forms.map(function (form) { return { form: form, matched: false, wrong: false }; }),
        heOrder: shuffle(forms.map(function (_, i) { return i; })),
        selEn: null,
        selHe: null,
        flash: null
      });
    }
    return {
      lessonId: lesson.id,
      number: number,
      index: 0,
      items: items,
      score: 0,
      total: items.length,
      missed: [],
      done: false,
      sendStatus: ""
    };
  }

  function makeOptions(form, allForms) {
    var seen = {};
    seen[plain(form.he)] = true;
    var distractors = [];
    shuffle(allForms.slice()).forEach(function (f) {
      if (distractors.length >= 3 || f.row === form.row || seen[plain(f.he)]) return;
      seen[plain(f.he)] = true;
      distractors.push(f);
    });
    return shuffle([form].concat(distractors));
  }

  function renderQuiz(lesson) {
    var quiz = state.quiz;
    var body;
    if (!quiz) body = renderQuizPicker(lesson);
    else if (quiz.done) body = renderQuizResults(lesson, quiz);
    else {
      var item = quiz.items[quiz.index];
      body = item.type === "choice" ? renderChoice(quiz, item) : renderMatch(quiz, item);
    }
    return el("div", null, [el("div", { class: "toolbar study-toolbar no-print" }, [niqqudToggle(), trToggle()]), body]);
  }

  // The student's best score on each quiz of this lesson: from their report,
  // and from quizzes finished since the page was opened.
  function quizBests(lesson) {
    var best = {};
    function note(number, score, total) {
      if (!total) return;
      number = number || 0; // 0 holds scores from before a lesson had several quizzes
      if (!best[number] || score / total > best[number].score / best[number].total) best[number] = { score: score, total: total };
    }
    if (state.student && state.report.data) {
      state.report.data.results.forEach(function (r) {
        if (r.lessonId === lesson.id) note(r.quiz, r.score, r.total);
      });
    }
    Object.keys(state.quizDone).forEach(function (key) {
      var parts = key.split("|");
      if (parts[0] === lesson.id) note(Number(parts[1]), state.quizDone[key].score, state.quizDone[key].total);
    });
    return best;
  }

  function renderQuizPicker(lesson) {
    var plan = quizPlan(lesson);
    if (!plan.length) return el("p", { class: "notice", text: t("This lesson has no phrases yet.") });
    var best = quizBests(lesson);
    var saving = !!config.resultsUrl && !!state.student;
    var top = null;
    Object.keys(best).forEach(function (n) {
      if (!top || best[n].score / best[n].total > top.score / top.total) top = best[n];
    });
    var intro = t(plan.length === 1
      ? "One short quiz: multiple choice, then a matching round that counts as one question. Take it as often as you like."
      : "{n} short quizzes, each on different phrases: multiple choice, then a matching round that counts as one question. Take them in any order, as often as you like.", { n: plan.length })
      + (saving ? " " + t("Your highest score is the one that counts for this lesson.") : "");
    return el("div", { class: "card" }, [
      el("h2", { text: t("Choose a quiz"), style: "margin-top:0" }), // the lesson's name is above, under the buttons
      el("p", { text: intro }),
      top ? el("p", { class: "quiz-best" }, [
        t("Your highest score for this lesson:") + " ",
        el("strong", { class: "score-pill " + scoreClass(top.score, top.total), text: top.score + " / " + top.total })
      ]) : null,
      state.student ? null : el("p", { class: "hint", text: t("You're signed in as the teacher, so your scores won't be saved.") }),
      el("div", { class: "quiz-picks" }, plan.map(function (part, i) {
        var number = i + 1;
        var mine = best[number];
        return el("button", {
          class: "quiz-pick",
          type: "button",
          onclick: function () { state.quiz = buildQuiz(lesson, number); render(); }
        }, [
          el("span", { class: "quiz-pick-name", text: t("Quiz {n}", { n: number }) }),
          el("span", { class: "quiz-pick-meta", text: t("{n} questions", { n: part.choice.length + (part.match.length ? 1 : 0) }) }),
          mine
            ? el("span", { class: "score-pill " + scoreClass(mine.score, mine.total), text: t("Best {score}", { score: mine.score + " / " + mine.total }) })
            : el("span", { class: "quiz-pick-meta", text: t("Not taken yet") })
        ]);
      }))
    ]);
  }

  function renderProgress(quiz) {
    var pct = Math.round((quiz.index / quiz.items.length) * 100);
    return [
      el("p", { class: "quiz-progress", text: t("Quiz {n} · Question {q} of {count} · Score {score}", { n: quiz.number, q: quiz.index + 1, count: quiz.items.length, score: quiz.score }) }),
      el("div", { class: "progress-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + pct + "%" })])
    ];
  }

  function renderChoice(quiz, item) {
    var answered = item.picked !== null;
    var options = el("div", { class: "options" }, item.options.map(function (opt) {
      var cls = "option";
      if (answered) {
        if (opt === item.form) cls += " correct";
        else if (opt === item.picked) cls += " wrong";
        else cls += " faded";
      }
      // The listen button sits beside the option, not inside it (buttons can't nest).
      return el("div", { class: "option-row" }, [
        el("button", {
          class: cls,
          type: "button",
          lang: "he",
          dir: "rtl",
          disabled: answered,
          onclick: function () { answerChoice(quiz, item, opt); }
        }, heWithTr(opt)),
        speakButton(opt.he, "option-speak")
      ]);
    }));

    var children = renderProgress(quiz).concat([
      el("p", { class: "prompt", text: promptFor(item.form) }),
      options
    ]);
    if (answered) {
      var right = item.picked === item.form;
      children.push(el("p", { class: "feedback " + (right ? "good" : "bad") }, [
        right ? t("Correct!") + " " : t("Not quite. The answer is") + " ",
        right ? null : el("span", { lang: "he", dir: "rtl", text: heb(item.form.he) }),
        right ? null : " ",
        el("span", { class: "tr", text: "(" + item.form.tr + ")" }),
        " ",
        speakButton(item.form.he)
      ]));
      children.push(nextButton(quiz));
    }
    return el("div", { class: "card" }, children);
  }

  // A Hebrew answer button's content: the Hebrew, then its transliteration
  // (on the left of the button, or under the Hebrew when there's no room),
  // unless the student has turned it off.
  function heWithTr(form) {
    return [
      el("span", { class: "opt-he", text: heb(form.he) }),
      form.tr && state.showTr ? el("span", { class: "opt-tr", lang: "en", dir: "ltr", text: form.tr }) : null
    ];
  }

  function answerChoice(quiz, item, opt) {
    if (item.picked !== null) return;
    item.picked = opt;
    if (opt === item.form) quiz.score++;
    else quiz.missed.push(item.form);
    render();
  }

  function renderMatch(quiz, round) {
    var done = round.pairs.every(function (p) { return p.matched; });
    function itemClass(side, i) {
      var cls = "match-item " + side;
      if (round.pairs[i].matched) cls += " matched";
      else if (round.flash && round.flash[side === "en" ? 0 : 1] === i) cls += " wrong";
      else if ((side === "en" ? round.selEn : round.selHe) === i) cls += " selected";
      return cls;
    }
    var enCol = el("div", { class: "match-col" }, round.pairs.map(function (pair, i) {
      return el("button", {
        class: itemClass("en", i),
        type: "button",
        disabled: pair.matched,
        "aria-pressed": round.selEn === i ? "true" : "false",
        onclick: function () { pickMatch(quiz, round, "en", i); },
        text: promptFor(pair.form)
      });
    }));
    var heCol = el("div", { class: "match-col" }, round.heOrder.map(function (i) {
      return el("button", {
        class: itemClass("he", i),
        type: "button",
        lang: "he",
        dir: "rtl",
        disabled: round.pairs[i].matched,
        "aria-pressed": round.selHe === i ? "true" : "false",
        onclick: function () { pickMatch(quiz, round, "he", i); }
      }, heWithTr(round.pairs[i].form));
    }));
    var children = renderProgress(quiz).concat([
      el("p", { class: "prompt", text: t("Match each English phrase to its Hebrew.") }),
      el("p", { class: "hint", style: "margin-top:-12px", text: t("This round is one question: match them all without a wrong pairing to get the point.") }),
      el("div", { class: "match-grid" }, [enCol, heCol])
    ]);
    if (done) {
      var clean = round.pairs.every(function (p) { return !p.wrong; });
      children.push(el("p", { class: "feedback " + (clean ? "good" : "bad"), text: clean ? t("All matched, with no mistakes!") : t("All matched, but with a wrong pairing on the way, so no point this time.") }));
      children.push(nextButton(quiz));
    }
    return el("div", { class: "card" }, children);
  }

  function pickMatch(quiz, round, side, i) {
    if (round.pairs[i].matched || round.flash) return;
    if (side === "en") round.selEn = i; else round.selHe = i;
    if (round.selEn !== null && round.selHe !== null) {
      var e = round.selEn;
      var h = round.selHe;
      round.selEn = null;
      round.selHe = null;
      if (e === h) {
        var pair = round.pairs[e];
        pair.matched = true;
        if (pair.wrong) quiz.missed.push(pair.form);
        // The round is one question: a point when every pair was right first time.
        if (round.pairs.every(function (p) { return p.matched && !p.wrong; })) quiz.score++;
      } else {
        round.pairs[e].wrong = true;
        round.flash = [e, h];
        setTimeout(function () {
          round.flash = null;
          if (state.quiz === quiz) render();
        }, 700);
      }
    }
    render();
  }

  function nextButton(quiz) {
    var last = quiz.index === quiz.items.length - 1;
    return el("div", { class: "actions" }, [
      el("button", {
        class: "btn primary",
        type: "button",
        text: last ? t("See my score") : t("Next"),
        onclick: function () {
          if (last) finishQuiz(quiz);
          else quiz.index++;
          render();
        }
      })
    ]);
  }

  function finishQuiz(quiz) {
    quiz.done = true;
    var key = quiz.lessonId + "|" + quiz.number;
    var before = state.quizDone[key];
    if (!before || quiz.score / quiz.total > before.score / before.total) state.quizDone[key] = { score: quiz.score, total: quiz.total };
    if (!config.resultsUrl || !state.student) return;
    var lesson = findLesson(quiz.lessonId);
    quiz.sendStatus = "sending";
    state.report.data = null;
    var payload = {
      student: state.student.name,
      token: state.student.token,
      lessonId: quiz.lessonId,
      lessonTitle: lesson ? lesson.title : "",
      quiz: quiz.number,
      score: quiz.score,
      total: quiz.total,
      missed: quiz.missed.map(function (f) { return promptFor(f, "en") + " = " + plain(f.he); }).join("; "),
      finishedAt: new Date().toISOString()
    };
    callBackend(payload).then(function (res) {
      quiz.sendStatus = res && res.ok ? "sent" : "failed";
      if (res && res.ok) boardChanged();
    }, function () {
      quiz.sendStatus = "failed";
    }).then(function () {
      if (state.quiz === quiz) render();
    });
  }

  function renderQuizResults(lesson, quiz) {
    var pct = quiz.total ? Math.round((quiz.score / quiz.total) * 100) : 0;
    var message = pct === 100 ? t("Perfect! מְצוּיָן") : pct >= 80 ? t("Great work!") : pct >= 50 ? t("Good effort. Review the phrases below and try again.") : t("Keep practising with the lesson sheet, then try again.");
    var children = [
      el("p", { class: "quiz-progress", text: t("Quiz {n} · Your score", { n: quiz.number }) }),
      el("p", { class: "score", text: quiz.score + " / " + quiz.total }),
      el("p", { text: message })
    ];
    if (quiz.missed.length) {
      children.push(el("div", { class: "missed" }, [
        el("h3", { text: t("Phrases to review") }),
        el("ul", null, quiz.missed.map(function (f) {
          return el("li", null, [
            el("strong", { text: promptFor(f) }),
            el("span", { class: "he", lang: "he", dir: "rtl", text: heb(f.he) }),
            el("span", { class: "tr", text: f.tr }),
            " ",
            speakButton(f.he)
          ]);
        }))
      ]));
    }
    if (quiz.sendStatus) {
      var statusText = {
        sending: t("Saving your score…"),
        sent: t("Your score was saved in your progress report."),
        failed: t("Your score could not be saved. Check your connection and take the quiz again, or tell your teacher.")
      }[quiz.sendStatus];
      children.push(el("p", { class: "send-status" + (quiz.sendStatus === "failed" ? " bad" : ""), text: statusText }));
    }
    children.push(el("div", { class: "actions" }, [
      el("button", {
        class: "btn primary",
        type: "button",
        text: quizPlan(lesson).length > 1 ? t("Choose another quiz") : t("Done"),
        onclick: function () { state.quiz = null; render(); }
      }),
      el("button", {
        class: "btn",
        type: "button",
        text: t("Try this one again"),
        onclick: function () { state.quiz = buildQuiz(lesson, quiz.number); render(); }
      }),
      el("a", { class: "btn", href: lessonUrl(lesson, "sheet"), text: t("Back to the lesson sheet") })
    ]));
    return el("div", { class: "card" }, children);
  }

  /* ---------- Self study: Word of the day and How to say ---------- */

  var NOT_CONNECTED = "This needs the Google script connected (see README.md).";
  var NOT_SWITCHED_ON = "This isn't switched on yet. Teacher: update the Google script (see README.md).";

  // A message for a reply that isn't ok. An older Google script answers
  // "bad-request" to anything it doesn't know.
  function backendMessage(res, fallback) {
    var error = res && res.error;
    if (error === "bad-request") return t(NOT_SWITCHED_ON);
    if (error === "sign-in") return t("This name is protected by a PIN. Sign out, then sign in again with the PIN.");
    if (error === "wrong-passcode") return t("The teacher passcode didn't work. Sign out and sign in again.");
    return t(fallback);
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  // Local calendar day as YYYY-MM-DD.
  function dayKey(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
  }

  function parseDay(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function hashText(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // The word list in words/daily-words.js, in the same shape as a lesson.
  var dailyWords = null;

  HC.setDailyWords = function (sections) {
    dailyWords = normalizeLesson({ id: "daily-words", title: t("Word of the day"), sections: sections });
    seededShuffle(dailyWords.order = cardList(dailyWords), hashText("daily-words"));
  };

  // Every Hebrew word used in the lessons taught up to this day, without niqqud.
  function taughtWords(day) {
    var seen = {};
    lessons.forEach(function (lesson) {
      if (lesson.date && lesson.date > day) return;
      lesson.forms.forEach(function (form) {
        plain(form.he).split(/[^\u05D0-\u05EA]+/).forEach(function (word) { if (word) seen[word] = true; });
      });
    });
    return seen;
  }

  // The same word for everyone on a given day. The list is walked in a fixed
  // mixed order, one step a day, so no word repeats until all have been shown;
  // a word the class has already met in a lesson is passed over.
  function wordOfDay(day) {
    var date = parseDay(day);
    var order = dailyWords ? dailyWords.order : [];
    if (!date || !order.length) return null;
    var taught = taughtWords(day);
    var start = Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
    for (var i = 0; i < order.length; i++) {
      var item = order[(start + i) % order.length];
      if (!taught[plain(item.row.forms[0].he)]) return item;
    }
    return order[start % order.length];
  }

  function practisedKey(day) {
    return day + "|" + (state.student ? studentKey(state.student.name) : "teacher");
  }

  function renderStudy() {
    var tab = state.route.tab;
    return el("section", null, [
      // No visible title: the menu sits at the top, so the word fits on a phone.
      el("h1", { class: "visually-hidden", text: t("Self study") }),
      studyNav(tab, null),
      tab === "say" ? renderSay() : renderWordOfDay()
    ]);
  }

  // Besides today's word, a student can catch up on the words of this many days before.
  var WORD_DAYS_BACK = 7;

  // Today first, then the days before it.
  function wordDays(today) {
    var date = parseDay(today);
    var days = [];
    for (var i = 0; i <= WORD_DAYS_BACK; i++) days.push(dayKey(addDays(date, -i)));
    return days;
  }

  // Whether the word of that day has been practised: saved in the student's
  // report, done since the page opened, or (today's) on this browser.
  function practisedWord(day) {
    if (state.wotdPractised[practisedKey(day)]) return true;
    if (day === dayKey(new Date()) && readSetting("hebrewClass.wotdDone", "") === practisedKey(day)) return true;
    var data = state.student && state.report.data;
    return !!(data && data.practice.some(function (p) { return p.day === day; }));
  }

  function renderWordOfDay() {
    var today = dayKey(new Date());
    var days = wordDays(today);
    var day = days.indexOf(state.wotdDay) >= 0 ? state.wotdDay : today; // back to today once a chosen day is too old
    if (!state.wotd || state.wotd.day !== day) {
      var entry = wordOfDay(day);
      state.wotd = entry && {
        day: day,
        row: entry.row,
        form: entry.row.forms[0],
        step: "learn",
        options: null,
        picked: null,
        saved: ""
      };
    }
    var w = state.wotd;
    if (!w) return el("p", { class: "notice", text: t("There is no word of the day yet.") });
    // The word's own page always shows its transliteration; the checkbox is for the check.
    var toolbar = el("div", { class: "toolbar study-toolbar no-print" }, [niqqudToggle(), w.step === "ask" ? trToggle() : null]);
    return el("div", { class: "cards-view" }, w.step === "ask" ? [toolbar, renderWordCheck(w)] : [
      toolbar,
      renderWordLearn(w, day === today),
      renderWordDays(days, day)
    ]);
  }

  // Today's word and the past week's: a student who missed a day can catch up.
  function renderWordDays(days, chosen) {
    return el("div", { class: "wotd-days no-print" }, [
      el("p", { class: "wotd-days-title", id: "wotd-days-title", text: t("Catch up on the past week's words") }),
      el("div", { class: "wotd-day-list", role: "group", "aria-labelledby": "wotd-days-title" }, days.map(function (day, i) {
        var done = practisedWord(day);
        var date = parseDay(day);
        var label = i === 0 ? t("Today") : i === 1 ? t("Yesterday")
          : date.toLocaleDateString(dateLocale(), { weekday: "short" }) + " " + date.getDate(); // "Sun 15"
        return el("button", {
          type: "button",
          class: "subtab wotd-day" + (day === chosen ? " active" : ""),
          "aria-pressed": day === chosen ? "true" : "false",
          onclick: function () {
            if (day === chosen) return;
            state.wotdDay = day;
            stopSpeaking();
            render();
          }
        }, [
          label,
          done ? el("span", { class: "wotd-day-done", "aria-hidden": "true", text: "✓" }) : null,
          done ? el("span", { class: "visually-hidden", text: t(", practised") }) : null
        ]);
      }))
    ]);
  }

  function renderWordLearn(w, isToday) {
    var done = practisedWord(w.day);
    var savedText = {
      saving: t("Saving…"),
      saved: t("Saved in your progress report."),
      failed: t("Couldn't save this in your progress report. Check your connection and practise again."),
      off: t(NOT_SWITCHED_ON),
      pin: backendMessage({ error: "sign-in" })
    }[w.saved];
    return el("div", null, [
      el("div", { class: "card word-card wotd-card" }, [
        el("p", { class: "card-section", text: t("Word of the day") + " · " + formatDate(w.day) }),
        cardBody(w.row)
      ]),
      done ? el("p", { class: "notice good", role: "status", text: isToday ? t("Practised today. Come back tomorrow for a new word.") : t("You've practised this word.") }) : null,
      savedText ? el("p", { class: "send-status" + (w.saved === "saving" || w.saved === "saved" ? "" : " bad"), text: savedText }) : null,
      !state.student ? el("p", { class: "hint", text: t("You're signed in as the teacher, so your practice isn't recorded.") }) : null,
      el("div", { class: "actions wotd-actions" }, [
        el("button", {
          class: "btn" + (done ? "" : " primary"),
          type: "button",
          text: done ? t("Practise again") : t("Practise this word"),
          onclick: function () {
            w.step = "ask";
            w.picked = null;
            w.options = makeOptions(w.form, dailyWords.forms);
            stopSpeaking();
            render();
          }
        })
      ])
    ]);
  }

  // The word is hidden; pick its Hebrew from four.
  function renderWordCheck(w) {
    var wrong = w.picked !== null && w.picked !== w.form;
    // Each choice has its own listen button, beside it as in the lesson quiz.
    var options = el("div", { class: "options" }, w.options.map(function (opt) {
      return el("div", { class: "option-row" }, [
        el("button", {
          class: "option" + (wrong && opt === w.picked ? " wrong" : ""),
          type: "button",
          lang: "he",
          dir: "rtl",
          disabled: wrong,
          onclick: function () { answerWord(w, opt); }
        }, heWithTr(opt)),
        speakButton(opt.he, "option-speak")
      ]);
    }));
    return el("div", { class: "card" }, [
      el("p", { class: "quiz-progress", text: t("Word of the day · Which one is it?") }),
      el("p", { class: "prompt", text: promptFor(w.form) }),
      options,
      wrong ? el("p", { class: "feedback bad", role: "status", text: t("Not quite. Look at the word again, then try once more.") }) : null,
      wrong ? el("div", { class: "actions" }, [
        el("button", { class: "btn primary", type: "button", text: t("Back"), onclick: function () { w.step = "learn"; render(); } })
      ]) : null
    ]);
  }

  function answerWord(w, opt) {
    w.picked = opt;
    if (opt !== w.form) { render(); return; }
    w.step = "learn";
    state.wotdPractised[practisedKey(w.day)] = true;
    if (w.day === dayKey(new Date())) writeSetting("hebrewClass.wotdDone", practisedKey(w.day));
    if (state.student && config.resultsUrl) {
      w.saved = "saving";
      callBackend(asStudent({ action: "practice", day: w.day, word: w.row.en })).then(function (res) {
        w.saved = res && res.ok ? "saved" : res && res.error === "bad-request" ? "off" : res && res.error === "sign-in" ? "pin" : "failed";
        if (res && res.ok) {
          // Kept in the report already loaded, which also marks the day's button.
          var data = state.report.data;
          if (data && !data.practice.some(function (p) { return p.day === w.day; })) {
            data.practice.push({ at: new Date().toISOString(), student: state.student.name, day: w.day, word: w.row.en });
          }
          boardChanged();
        }
      }, function () {
        w.saved = "failed";
      }).then(function () {
        if (state.wotd === w && state.route.view === "study" && state.route.tab === "word") render();
      });
    }
    render();
  }

  /* How to say: type or say a short English phrase and get Google's Hebrew. */

  var SAY_MAX = 80;
  var LISTEN_MS = 6000;
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var recognition = null;

  function renderSay() {
    var say = state.say;
    if (!config.resultsUrl) return el("p", { class: "notice", text: t(NOT_CONNECTED) });
    var input = el("input", {
      type: "text",
      id: "say-text",
      required: true,
      maxlength: String(SAY_MAX),
      autocomplete: "off",
      placeholder: t("For example: Where is the bus stop?"),
      value: say.text,
      oninput: function (e) { say.text = e.target.value; }
    });
    var form = el("form", {
      class: "card",
      onsubmit: function (e) {
        e.preventDefault();
        translatePhrase(input.value);
      }
    }, [
      el("div", { class: "field wide" }, [
        el("label", { for: "say-text", text: t("A word or short phrase in English") }),
        // The microphone sits at the end of the box: say the phrase instead of typing it.
        el("div", { class: "say-input" + (Recognition ? " with-mic" : "") }, [input, Recognition ? micButton(say) : null])
      ]),
      say.listening ? el("p", { class: "say-listening", role: "status", text: t("Listening… say the phrase in English. Tap the microphone to stop.") }) : null,
      el("div", { class: "actions" }, [
        el("button", { class: "btn primary", type: "submit", disabled: say.busy, text: say.busy ? t("Translating…") : t("Translate to Hebrew") })
      ]),
      Recognition ? null : el("p", { class: "hint", text: t("To say the phrase instead of typing it, open the site in Chrome, Edge or Safari.") }),
      say.error ? el("p", { class: "notice error", role: "alert", text: say.error }) : null
    ]);
    var result = say.result ? el("div", { class: "card word-card say-result", "aria-live": "polite" }, [
      el("div", { class: "card-body" }, [
        el("p", { class: "card-en", text: say.result.text }),
        el("p", { class: "card-he", lang: "he", dir: "rtl", text: say.result.hebrew }),
        speakButton(say.result.hebrew, "big")
      ])
    ]) : null;
    return el("div", { class: "cards-view" }, [
      form,
      result,
      el("p", { class: "hint", text: t("This is Google's automatic translation, without vowel marks. It may pick the male or the female form, and it can be wrong, so check with your teacher. What you type is sent to Google to be translated.") })
    ]);
  }

  function micButton(say) {
    var btn = el("button", {
      class: "mic-btn" + (say.listening ? " listening" : ""),
      type: "button",
      disabled: say.busy,
      title: say.listening ? t("Stop listening") : t("Say it instead"),
      "aria-label": say.listening ? t("Stop listening") : t("Say it instead of typing"),
      "aria-pressed": say.listening ? "true" : "false",
      onclick: function () { if (say.listening) stopListening(); else startListening(); }
    });
    btn.appendChild(micIcon());
    return btn;
  }

  function translatePhrase(text) {
    var say = state.say;
    text = String(text || "").trim().replace(/\s+/g, " ").slice(0, SAY_MAX);
    if (!text || say.busy) return;
    say.text = text;
    say.busy = true;
    say.error = "";
    render();
    var from = uiLang; // the language the phrase is typed or said in
    callBackend({ action: "translate", text: text, from: from }).then(function (res) {
      if (res && res.ok && res.hebrew && from === "es" && res.from !== "es") {
        // A Google script from before Spanish translates from English only.
        say.error = t(NOT_SWITCHED_ON);
      } else if (res && res.ok && res.hebrew) {
        say.result = { text: res.text || text, hebrew: res.hebrew };
        // The English stays on the result card; the box is ready for the next phrase.
        if (say.text === text) say.text = "";
      } else {
        say.error = backendMessage(res, "Couldn't translate that. Try again in a moment.");
      }
    }, function () {
      say.error = t("Couldn't reach the translator. Check your connection and try again.");
    }).then(function () {
      say.busy = false;
      if (state.route.view === "study" && state.route.tab === "say") render();
    });
  }

  function startListening() {
    var say = state.say;
    if (!Recognition || say.listening) return;
    var heard = "";
    var rec = new Recognition();
    recognition = rec;
    rec.lang = uiLang === "es" ? spanishSpeech() : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      heard = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
    };
    rec.onerror = function (e) {
      say.error = e.error === "not-allowed" || e.error === "service-not-allowed"
        ? t("The microphone is blocked. Allow it for this site in your browser, or type the phrase.")
        : e.error === "no-speech" ? t("Didn't hear anything. Try again, or type the phrase.")
        : e.error === "aborted" ? ""
        : t("Couldn't hear that. Try again, or type the phrase.");
    };
    rec.onend = function () {
      if (recognition === rec) recognition = null;
      say.listening = false;
      if (state.route.view !== "study" || state.route.tab !== "say") return;
      if (heard) translatePhrase(heard); else render();
    };
    say.error = "";
    say.listening = true;
    try {
      rec.start();
    } catch (err) {
      say.listening = false;
      recognition = null;
      say.error = t("Couldn't start the microphone. Type the phrase instead.");
    }
    // A short phrase only: stop by itself after a few seconds.
    setTimeout(function () { if (recognition === rec) rec.stop(); }, LISTEN_MS);
    render();
  }

  // Spoken Spanish: the device's own kind (es-AR, es-ES…) if it is set to
  // Spanish, otherwise Mexican Spanish, which Chrome, Edge and Safari all know.
  function spanishSpeech() {
    var device = navigator.language || "";
    return /^es-/i.test(device) ? device : "es-MX";
  }

  function stopListening() {
    if (recognition) recognition.stop();
  }

  /* ---------- Suggestions box ---------- */

  function loadSuggestions() {
    var box = state.suggestions;
    if (!config.resultsUrl || box.loading) return;
    box.loading = true;
    callBackend({ action: "suggestions" }).then(function (res) {
      if (res && res.ok) { box.items = res.suggestions || []; box.error = ""; }
      else box.error = backendMessage(res, "Couldn't load the suggestions.");
    }, function () {
      box.error = t("Couldn't reach the suggestions box. Check your connection.");
    }).then(function () {
      box.loading = false;
      // The Teacher page shows the count on its next refresh, so nothing flickers.
      if (state.route.view === "suggestions") render();
    });
  }

  function sendSuggestion(text) {
    var box = state.suggestions;
    box.sending = true;
    box.sendError = "";
    render();
    var body = state.student ? asStudent({ action: "suggest", text: text })
      : { action: "suggest", name: "Teacher", passcode: state.teacher.passcode, text: text };
    callBackend(body).then(function (res) {
      if (res && res.ok) { box.items = res.suggestions || []; box.draft = ""; }
      else box.sendError = backendMessage(res, "Couldn't send your suggestion. Try again.");
    }, function () {
      box.sendError = t("Couldn't send your suggestion. Check your connection and try again.");
    }).then(function () {
      box.sending = false;
      if (state.route.view === "suggestions") render();
    });
  }

  function sendResponse(id, text) {
    var box = state.suggestions;
    box.saving = id;
    box.sendError = "";
    render();
    callBackend({ action: "suggestReply", passcode: state.teacher.passcode, id: id, response: text }).then(function (res) {
      if (res && res.ok) box.items = res.suggestions || [];
      else box.sendError = backendMessage(res, "Couldn't save your response. Try again.");
    }, function () {
      box.sendError = t("Couldn't save your response. Check your connection and try again.");
    }).then(function () {
      box.saving = "";
      if (state.route.view === "suggestions") render();
    });
  }

  function renderSuggestions() {
    var box = state.suggestions;
    // The Self study menu stays at the top, in the same place as on its other pages.
    var wrap = el("section", null, [
      studyNav("suggestions", null),
      el("h1", { text: t("Suggestions box") }),
      el("p", { class: "lede", text: t("Ideas to improve this site, or topics you'd like in a lesson. Everyone in the class can read the suggestions and the teacher's responses.") })
    ]);
    if (!config.resultsUrl) {
      wrap.appendChild(el("p", { class: "notice", text: t(NOT_CONNECTED) }));
      return wrap;
    }

    var textarea = el("textarea", { id: "suggestion-text", required: true, maxlength: "1000", rows: "4", oninput: function (e) { box.draft = e.target.value; } });
    textarea.value = box.draft || "";
    wrap.appendChild(el("form", {
      class: "card",
      onsubmit: function (e) {
        e.preventDefault();
        var text = textarea.value.trim();
        if (text && !box.sending) sendSuggestion(text);
      }
    }, [
      el("div", { class: "field wide" }, [el("label", { for: "suggestion-text", text: t("Your suggestion") }), textarea]),
      box.sendError ? el("p", { class: "notice error", role: "alert", text: box.sendError }) : null,
      el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", disabled: box.sending, text: box.sending ? t("Sending…") : t("Submit") })])
    ]));

    wrap.appendChild(el("h2", { class: "list-title", text: t("Suggestions so far") }));
    if (box.error) wrap.appendChild(el("p", { class: "notice error", text: box.error }));
    if (!box.items) {
      if (!box.error) wrap.appendChild(el("p", { class: "notice", text: t("Loading the suggestions…") }));
      return wrap;
    }
    if (!box.items.length) {
      wrap.appendChild(el("p", { class: "notice", text: t("No suggestions yet. Yours can be the first.") }));
      return wrap;
    }
    var newest = box.items.slice().sort(function (a, b) { return a.at < b.at ? 1 : -1; });
    wrap.appendChild(el("ul", { class: "suggestions" }, newest.map(suggestionItem)));
    return wrap;
  }

  function suggestionItem(item) {
    var box = state.suggestions;
    var children = [
      el("p", { class: "suggestion-head" }, [
        el("strong", { text: item.student }),
        el("span", { class: "muted", text: formatTime(item.at) })
      ]),
      el("p", { class: "suggestion-text", text: item.text })
    ];
    if (isTeacher()) {
      var id = "response-" + item.id;
      var textarea = el("textarea", { id: id, maxlength: "1000", rows: "2" });
      textarea.value = item.response;
      children.push(el("form", {
        class: "response-form",
        onsubmit: function (e) {
          e.preventDefault();
          if (!box.saving) sendResponse(item.id, textarea.value.trim());
        }
      }, [
        el("div", { class: "field wide" }, [el("label", { for: id, text: t("Your response") + (item.respondedAt ? " · " + formatTime(item.respondedAt) : "") }), textarea]),
        el("button", { class: "btn", type: "submit", disabled: !!box.saving, text: box.saving === item.id ? t("Saving…") : item.response ? t("Update response") : t("Save response") })
      ]));
    } else if (item.response) {
      children.push(el("div", { class: "response" }, [
        el("p", { class: "suggestion-head" }, [
          el("strong", { text: t("Teacher's response") }),
          item.respondedAt ? el("span", { class: "muted", text: formatTime(item.respondedAt) }) : null
        ]),
        el("p", { class: "suggestion-text", text: item.response })
      ]));
    } else {
      children.push(el("p", { class: "muted response-none", text: t("No response yet.") }));
    }
    return el("li", { class: "card suggestion" }, children);
  }

  /* ---------- Progress reports ---------- */

  var WEEKS_SHOWN = 26;
  var DAY_LETTERS = { en: ["S", "M", "T", "W", "T", "F", "S"], es: ["D", "L", "M", "X", "J", "V", "S"] };
  var DAY_NAMES = {
    en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    es: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
  };

  // Weeks run Sunday to Saturday.
  function weekStart(date) {
    return addDays(date, -date.getDay());
  }

  function weekLabel(start) {
    var opts = { day: "numeric", month: "short" };
    return start.toLocaleDateString(dateLocale(), opts) + " – " + addDays(start, 6).toLocaleDateString(dateLocale(), opts);
  }

  // One entry per week, newest first, from the first week with anything in it to this week.
  function weeklyProgress(results, practice) {
    var weeks = {};
    function week(start) {
      var key = dayKey(start);
      return weeks[key] || (weeks[key] = { start: start, quizzes: [], days: {} });
    }
    results.forEach(function (r) {
      var d = new Date(r.finishedAt);
      if (!isNaN(d)) week(weekStart(d)).quizzes.push(r);
    });
    // The day it was practised, which for a word caught up on is after the word's own day.
    practice.forEach(function (p) {
      var d = practisedOn(p);
      if (d) week(weekStart(d)).days[d.getDay()] = p.word || "practised";
    });
    var current = weekStart(new Date());
    var first = Object.keys(weeks).sort()[0];
    var from = first ? parseDay(first) : current;
    var out = [];
    for (var start = current; start >= from && out.length < WEEKS_SHOWN; start = addDays(start, -7)) out.push(week(start));
    return out;
  }

  // A lesson's mark is the best score among its quizzes; this averages those marks.
  function averagePercent(quizzes) {
    var best = bestScores(quizzes);
    if (!best.length) return null;
    var sum = 0;
    best.forEach(function (r) { sum += r.total ? r.score / r.total : 0; });
    return Math.round((sum / best.length) * 100);
  }

  function countDays(days) {
    return Object.keys(days).length;
  }

  // When a Word of the day was practised (a word from an earlier day can be
  // caught up on), as a local date; older rows without the time use the word's day.
  function practisedOn(p) {
    var d = new Date(p.at);
    if (isNaN(d)) return parseDay(p.day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Sunday to Saturday, filled where the word of the day was practised.
  function dayDots(days) {
    return el("span", { class: "day-dots", role: "img", "aria-label": t("{n} of 7 days practised", { n: countDays(days) }) }, DAY_LETTERS[uiLang].map(function (letter, i) {
      return el("span", { class: "day-dot" + (days[i] ? " on" : ""), title: DAY_NAMES[uiLang][i] + (days[i] ? ": " + t("practised") : ""), text: letter });
    }));
  }

  // Best score per lesson among these quizzes.
  function bestScores(quizzes) {
    var byLesson = {};
    var order = [];
    quizzes.forEach(function (r) {
      var best = byLesson[r.lessonId];
      if (!best) order.push(r.lessonId);
      if (!best || r.score / r.total > best.score / best.total) byLesson[r.lessonId] = r;
    });
    return order.map(function (id) { return byLesson[id]; });
  }

  function statTile(value, label) {
    return el("div", { class: "stat" }, [el("span", { class: "stat-value", text: String(value) }), el("span", { class: "stat-label", text: label })]);
  }

  // The phrases missed in these quizzes, most missed first. Each quiz is saved
  // with its misses as "English = Hebrew; English = Hebrew".
  function missedPhrases(results) {
    var found = {};
    var list = [];
    results.forEach(function (r) {
      String(r.missed || "").split(";").forEach(function (part) {
        var text = part.trim().replace(/^'/, "");
        if (!text) return;
        if (!found[text]) list.push(found[text] = { text: text, count: 0, students: {} });
        found[text].count += 1;
        found[text].students[studentKey(r.student || "")] = true;
      });
    });
    list.forEach(function (m) { m.studentCount = Object.keys(m.students).length; });
    return list;
  }

  // Quiz misses are saved with the English, for the teacher; in Spanish the
  // site shows the Spanish of the same phrase.
  var formsByEnglish = null;

  function missedMeaning(english) {
    if (uiLang === "en") return english;
    if (!formsByEnglish) {
      formsByEnglish = {};
      lessons.forEach(function (lesson) {
        lesson.forms.forEach(function (f) { formsByEnglish[promptFor(f, "en")] = f; });
      });
    }
    var form = formsByEnglish[english];
    return form ? promptFor(form) : english;
  }

  // perStudent: count how many students missed it, not how many times.
  function missedList(items, limit, perStudent) {
    var sorted = items.slice().sort(function (a, b) {
      return perStudent ? b.studentCount - a.studentCount || b.count - a.count : b.count - a.count;
    });
    return el("ul", { class: "missed-list" }, sorted.slice(0, limit).map(function (m) {
      var cut = m.text.lastIndexOf(" = ");
      var n = perStudent ? m.studentCount : m.count;
      return el("li", null, [
        el("span", { class: "missed-en", text: cut === -1 ? m.text : missedMeaning(m.text.slice(0, cut)) }),
        cut === -1 ? null : el("span", { class: "missed-he", lang: "he", dir: "rtl", text: m.text.slice(cut + 3) }),
        el("span", { class: "missed-count", text: perStudent ? t(n === 1 ? "1 student" : "{n} students", { n: n }) : t(n === 1 ? "once" : "{n} times", { n: n }) })
      ]);
    }));
  }

  // One row per lesson, newest first: best score, how many of its quizzes
  // were tried, and when the last one was taken.
  function lessonTable(results) {
    var byLesson = {};
    results.forEach(function (r) { (byLesson[r.lessonId] || (byLesson[r.lessonId] = [])).push(r); });
    var ids = lessons.map(function (l) { return l.id; });
    Object.keys(byLesson).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
    var rows = ids.map(function (id) {
      var lesson = findLesson(id);
      var tries = byLesson[id] || [];
      var name = el("th", { scope: "row", text: lesson ? lessonName(lesson) : tries[0].lessonTitle || id });
      if (!tries.length) return el("tr", null, [name, el("td", { class: "empty", colspan: "3", text: t("Not started") })]);
      var best = bestScores(tries)[0];
      var tried = {};
      tries.forEach(function (r) { if (r.quiz) tried[r.quiz] = true; });
      var quizCount = lesson ? quizPlan(lesson).length : 0;
      var last = tries.reduce(function (a, r) { return r.finishedAt > a ? r.finishedAt : a; }, "");
      return el("tr", null, [
        name,
        el("td", null, [el("strong", { class: "score-pill " + scoreClass(best.score, best.total), text: best.score + " / " + best.total })]),
        // Results from before a lesson had several short quizzes carry no quiz number.
        el("td", { text: (!countDays(tried) ? t("Earlier long quiz") : quizCount ? t("{n} of {count}", { n: Math.min(countDays(tried), quizCount), count: quizCount }) : String(countDays(tried)))
          + " · " + t(tries.length === 1 ? "1 try" : "{n} tries", { n: tries.length }) }),
        el("td", { class: "nowrap", text: isNaN(new Date(last)) ? "" : new Date(last).toLocaleDateString(dateLocale(), { day: "numeric", month: "short" }) })
      ]);
    });
    return el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid week-grid lesson-grid" }, [
      el("thead", null, [el("tr", null, [
        el("th", { scope: "col", text: t("Lesson") }),
        el("th", { scope: "col", text: t("Best score") }),
        el("th", { scope: "col", text: t("Quizzes tried") }),
        el("th", { scope: "col", text: t("Last quiz") })
      ])]),
      el("tbody", null, rows)
    ])]);
  }

  // The report itself: totals, lesson by lesson, week by week, then what to
  // review. Used for a student's own page, the teacher's view of that student,
  // and the PDF of either.
  function reportNodes(results, practice) {
    var avg = averagePercent(results);
    var practisedDays = {};
    practice.forEach(function (p) { practisedDays[p.day] = true; });
    var started = {};
    results.forEach(function (r) { started[r.lessonId] = true; });
    var nodes = [el("div", { class: "stats" }, [
      statTile(results.length, t(results.length === 1 ? "quiz taken" : "quizzes taken")),
      statTile(avg === null ? "–" : avg + "%", t("average of best scores")),
      statTile(t("{n} of {count}", { n: countDays(started), count: Math.max(lessons.length, countDays(started)) }), t("lessons started")),
      statTile(countDays(practisedDays), t("words of the day practised"))
    ])];
    nodes.push(el("h3", { class: "report-title", text: t("Lesson by lesson") }), lessonTable(results));
    nodes.push(el("h3", { class: "report-title", text: t("Week by week") }));
    var thisWeek = dayKey(weekStart(new Date()));
    var rows = weeklyProgress(results, practice).map(function (w) {
      var scores = bestScores(w.quizzes);
      return el("tr", null, [
        el("th", { scope: "row" }, [
          el("span", { class: "week-name", text: weekLabel(w.start) }),
          dayKey(w.start) === thisWeek ? el("span", { class: "col-date", text: t("This week") }) : null
        ]),
        el("td", { class: w.quizzes.length ? null : "empty", text: w.quizzes.length ? String(w.quizzes.length) : "–" }),
        el("td", { class: "scores-cell" + (scores.length ? "" : " empty") }, scores.length ? scores.map(function (r) {
          var lesson = findLesson(r.lessonId);
          return el("span", { class: "score-line" }, [
            el("strong", { class: "score-pill " + scoreClass(r.score, r.total), text: r.score + " / " + r.total }),
            el("span", { text: lesson ? lessonName(lesson) : r.lessonTitle || r.lessonId })
          ]);
        }) : ["–"]),
        el("td", null, [dayDots(w.days)])
      ]);
    });
    nodes.push(el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid week-grid" }, [
      el("thead", null, [el("tr", null, [
        el("th", { scope: "col", text: t("Week") }),
        el("th", { scope: "col", text: t("Quizzes taken") }),
        el("th", { scope: "col", text: t("Best score per lesson") }),
        el("th", { scope: "col", text: t("Word of the day") })
      ])]),
      el("tbody", null, rows)
    ])]));
    var missed = missedPhrases(results);
    if (missed.length) {
      nodes.push(
        el("h3", { class: "report-title", text: t("Phrases to review") }),
        el("p", { class: "hint", text: t("The ones missed most often in quizzes.") }),
        missedList(missed, 12, false)
      );
    }
    return nodes;
  }

  /* ---------- Report as PDF ----------
     The browser's own print window saves a PDF ("Save as PDF"), so no PDF
     library is needed. Only the report is printed, with normal page margins
     (the lesson sheet prints edge to edge). */

  var clearPrint = null;

  function printReport(title, subtitle, nodes) {
    if (clearPrint) clearPrint();
    var area = el("div", { id: "print-area" }, [
      el("div", { class: "print-head" }, [
        el("strong", { text: t("Hebrew Class") }),
        el("span", { text: new Date().toLocaleDateString(dateLocale(), { day: "numeric", month: "long", year: "numeric" }) })
      ]),
      el("h1", { text: title }),
      subtitle ? el("p", { class: "lede", text: subtitle }) : null
    ].concat(nodes));
    var pageRule = el("style", { text: "@page { size: A4; margin: 14mm; }" });
    var oldTitle = document.title;
    document.body.appendChild(area);
    document.head.appendChild(pageRule);
    document.documentElement.classList.add("print-report");
    document.title = t("Hebrew Class") + " - " + title + " - " + dayKey(new Date()); // the PDF's suggested file name
    clearPrint = function () {
      clearPrint = null;
      document.documentElement.classList.remove("print-report");
      pageRule.remove();
      area.remove();
      document.title = oldTitle;
    };
    window.addEventListener("afterprint", function done() {
      window.removeEventListener("afterprint", done);
      if (clearPrint) clearPrint();
    });
    window.print();
  }

  function pdfButton(makeReport) {
    return el("button", {
      class: "btn no-print",
      type: "button",
      title: t("Opens the print window: choose “Save as PDF” there"),
      text: t("Download PDF"),
      onclick: makeReport
    });
  }

  function loadReport() {
    var report = state.report;
    if (!config.resultsUrl || !state.student || report.loading) return;
    report.loading = true;
    callBackend(asStudent({ action: "myReport" })).then(function (res) {
      if (res && res.ok) { report.data = { results: res.results || [], practice: res.practice || [] }; report.error = ""; }
      else report.error = backendMessage(res, "Couldn't load your progress.");
    }, function () {
      report.error = t("Couldn't reach the class service. Check your connection.");
    }).then(function () {
      report.loading = false;
      if (state.route.view === "progress" || (onQuizTab() && !state.quiz) || (onWordTab() && !(state.wotd && state.wotd.step === "ask"))) render();
    });
  }

  function onQuizTab() {
    return state.route.view === "lesson" && state.route.tab === "quiz";
  }

  function onWordTab() {
    return state.route.view === "study" && state.route.tab === "word";
  }

  function renderMyProgress() {
    var report = state.report;
    var wrap = el("section", null, [
      el("h1", { text: t("My progress") }),
      el("p", { class: "lede", text: state.student.name + " · " + t("your quiz scores and Word of the day practice, week by week.") })
    ]);
    if (!config.resultsUrl) {
      wrap.appendChild(el("p", { class: "notice", text: t(NOT_CONNECTED) }));
      return wrap;
    }
    if (report.error) wrap.appendChild(el("p", { class: "notice error", text: report.error }));
    if (!report.data) {
      if (!report.error) wrap.appendChild(el("p", { class: "notice", text: t("Loading your progress…") }));
      return wrap;
    }
    var empty = !report.data.results.length && !report.data.practice.length;
    if (!empty) {
      wrap.appendChild(el("div", { class: "actions report-actions" }, [
        pdfButton(function () {
          printReport(t("Progress report"), state.student.name, reportNodes(report.data.results, report.data.practice));
        }),
        el("span", { class: "hint no-print", text: t("Opens the print window. Choose “Save as PDF” there.") })
      ]));
    }
    wrap.appendChild(el("div", { class: "card dash-card" }, reportNodes(report.data.results, report.data.practice)));
    if (empty) wrap.appendChild(el("p", { class: "notice", text: t("Nothing here yet. Take a quiz or practise the word of the day and it will show up.") }));
    wrap.appendChild(el("p", { class: "hint", text: state.student.token
      ? t("Only you and your teacher can see this report.")
      : t("You signed in without a PIN, so anyone who types your name can see this page. To keep it private, sign out and sign in again with a PIN of your choice.") }));
    return wrap;
  }

  /* ---------- Results backend ---------- */

  // Apps Script web apps don't answer CORS preflights, so every call is a
  // "simple" text/plain POST. Its JSON reply is readable cross-origin.
  function callBackend(body) {
    return fetch(config.resultsUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ---------- Live class ---------- */

  // The teacher steps through the words; every student who joined sees the same
  // word. The current word lives in the Google script, which students check every
  // few seconds, so a change reaches them within about 2 to 5 seconds.
  var LIVE_POLL_JOINED_MS = 2500;
  var LIVE_POLL_WAITING_MS = 6000;
  var LIVE_POLL_TEACHER_MS = 8000;

  var live = {
    remote: null,          // { running, lessonId, index, sessionId } from the script
    checked: false,        // false until the first answer arrives
    error: "",
    email: readSetting("hebrewClass.liveEmail", ""),
    joinedSession: readSetting("hebrewClass.liveSession", ""),
    joining: false,
    joinError: "",
    attendees: [],
    teacherIndex: null,    // the teacher's own position, ahead of the script while a change is sending
    busy: false,
    seq: 0,
    joinedThisVisit: false,
    joinedAs: readSetting("hebrewClass.liveName", ""), // the name they joined with, which the video call asks for
    moving: false,         // the teacher is moving the class to another lesson
    moves: 0,              // counts the starts and ends of moves, so a check from before one isn't used
    timer: null,
    shownKey: ""
  };

  function isLiveTeacher() {
    return !!state.teacher.passcode;
  }

  function liveHere(lesson) {
    return !!(live.remote && live.remote.running && live.remote.lessonId === lesson.id);
  }

  // On while a class is running, as last seen by the Live class page.
  function liveDot() {
    var on = !!(live.remote && live.remote.running);
    return el("span", { class: "live-dot" + (on ? " on" : ""), "aria-hidden": "true" });
  }

  function startLivePolling() {
    clearTimeout(live.timer);
    live.timer = null;
    if (!config.resultsUrl) return;
    if (state.route.view !== "lesson" || state.route.tab !== "live") return;
    pollLive();
  }

  function scheduleLivePoll() {
    clearTimeout(live.timer);
    if (state.route.view !== "lesson" || state.route.tab !== "live") return;
    var lesson = findLesson(state.route.lessonId);
    var ms = isLiveTeacher() ? LIVE_POLL_TEACHER_MS
      : lesson && liveHere(lesson) && live.joinedSession === live.remote.sessionId ? LIVE_POLL_JOINED_MS
      : LIVE_POLL_WAITING_MS;
    live.timer = setTimeout(pollLive, document.hidden ? Math.max(ms, 15000) : ms);
  }

  function pollLive() {
    var teacher = isLiveTeacher();
    var moves = live.moves;
    if (teacher) loadCallUsage(); // every few minutes
    var request = teacher
      ? callBackend({ action: "liveAttendees", passcode: state.teacher.passcode }).then(function (res) {
        if (res && res.ok) live.attendees = res.attendees || [];
        else if (res && res.error === "wrong-passcode") {
          forgetTeacherPasscode();
          state.teacher.error = "That passcode didn't work. Check it matches the one in your Google script.";
        }
        return callBackend({ action: "liveState" });
      })
      : callBackend({ action: "liveState" });
    request.then(function (res) {
      if (!res || !res.ok) throw new Error("bad reply");
      if (live.moving || moves !== live.moves) return; // asked before the class moved lessons
      live.remote = res;
      live.error = "";
      if (!res.running) live.teacherIndex = null;
      if (teacher) noteKeep(res);
      else followClass();
    }).catch(function () {
      live.error = t("Couldn't reach the class service. Retrying…");
    }).then(function () {
      live.checked = true;
      renderLiveIfChanged();
      scheduleLivePoll();
    });
  }

  function forgetTeacherPasscode() {
    state.teacher.passcode = "";
    writeSetting("hebrewClass.teacherPasscode", "");
  }

  // Re-render only when what's shown changes, so a half-typed name isn't wiped.
  function renderLiveIfChanged() {
    if (state.route.view !== "lesson" || state.route.tab !== "live") return;
    if (liveKey() !== live.shownKey) render();
  }

  function liveKey() {
    var r = live.remote || {};
    return [live.checked, live.error, r.running, r.lessonId, r.sessionId, liveIndex(), live.joinedSession,
      isLiveTeacher(), live.attendees.map(attendeeLabel).join(",")].join("|");
  }

  function attendeeLabel(a) {
    return a.name || a.email || "";
  }

  function liveIndex() {
    if (live.teacherIndex !== null && isLiveTeacher()) return live.teacherIndex;
    return live.remote && live.remote.running ? live.remote.index : 0;
  }

  function moveLive(step) {
    var lesson = findLesson(state.route.lessonId);
    if (!lesson || !isLiveTeacher() || !liveHere(lesson)) return;
    var count = cardList(lesson).length;
    var next = Math.max(0, Math.min(count - 1, liveIndex() + step));
    if (next === liveIndex()) return;
    setLiveIndex(next);
  }

  function setLiveIndex(index) {
    live.teacherIndex = index;
    render();
    live.seq = Math.max(Date.now(), live.seq + 1); // strictly increasing, even for quick key presses
    callBackend({ action: "liveSet", passcode: state.teacher.passcode, index: index, seq: live.seq }).then(function (res) {
      if (res && res.error === "wrong-passcode") { forgetTeacherPasscode(); render(); }
    }, function () {
      live.error = t("That change may not have reached the students. Check your connection.");
      render();
    });
  }

  // Moves the running class to another lesson, at its first word. It stays the
  // same class, so everyone who joined stays in it and in the video call, and
  // their pages follow (followClass).
  function moveLiveClass(lesson) {
    var before = live.remote;
    if (!before || !before.running || before.lessonId === lesson.id || live.moving) return;
    var back = findLesson(before.lessonId);
    live.moving = true;
    live.moves += 1;
    live.seq = Math.max(Date.now(), live.seq + 1);
    // Shown at once, and this page opens there before anything draws the old one, so the call carries on.
    live.remote = { ok: true, running: true, lessonId: lesson.id, index: 0, sessionId: before.sessionId };
    live.teacherIndex = 0;
    live.error = "";
    goTo(lessonUrl(lesson, "live"));
    function undo(message) {
      live.remote = before;
      live.teacherIndex = null;
      live.error = message;
      if (back) goTo(lessonUrl(back, "live"));
    }
    callBackend({ action: "liveLesson", passcode: state.teacher.passcode, lessonId: lesson.id, seq: live.seq }).then(function (res) {
      if (res && res.ok) {
        live.remote = res;
        noteKeep(res);
      } else if (res && res.error === "wrong-passcode") {
        forgetTeacherPasscode();
        state.teacher.error = "That passcode didn't work. Check it matches the one in your Google script.";
      } else if (res && res.error === "not-live") {
        live.remote = { running: false };
        live.teacherIndex = null;
        noteKeep(live.remote);
      } else {
        // bad-request: a Google script from before moving lessons.
        undo(res && res.error === "bad-request"
          ? t("Moving the class to another lesson needs the new Google script. Until then, end the class and start it on the other lesson.")
          : t("Couldn't move the class. Try again."));
      }
    }, function () {
      undo(t("Couldn't reach the class service. Check your connection and try again."));
    }).then(function () {
      live.moving = false;
      live.moves += 1;
      render();
    });
  }

  // A student in the class goes along when the teacher moves it to another lesson.
  function followClass() {
    var r = live.remote;
    if (!r || !r.running || live.joinedSession !== r.sessionId) return;
    if (state.route.view !== "lesson" || state.route.tab !== "live" || state.route.lessonId === r.lessonId) return;
    var lesson = findLesson(r.lessonId);
    if (lesson) goTo(lessonUrl(lesson, "live")); // otherwise the page says to reload for the newest lessons
  }

  function startLiveClass(lesson) {
    live.busy = true;
    render();
    callBackend({
      action: "liveStart", passcode: state.teacher.passcode, lessonId: lesson.id,
      askMinutes: LIVE_ASK_MS / 60000, answerMinutes: LIVE_ANSWER_MS / 60000 // see Still teaching?
    }).then(function (res) {
      if (res && res.ok) {
        live.remote = res;
        live.teacherIndex = 0;
        live.attendees = [];
        live.error = "";
        noteKeep(res);
      } else if (res && res.error === "wrong-passcode") {
        forgetTeacherPasscode();
        state.teacher.error = "That passcode didn't work. Check it matches the one in your Google script.";
      } else {
        live.error = t("Couldn't start the class. Try again.");
      }
    }, function () {
      live.error = t("Couldn't reach the class service. Check your connection and try again.");
    }).then(function () {
      live.busy = false;
      render();
      scheduleLivePoll();
    });
  }

  function endLiveClass() {
    if (!window.confirm(t("End the live class for everyone?"))) return;
    finishLiveClass(false);
  }

  function onLivePage() {
    return state.route.view === "lesson" && state.route.tab === "live";
  }

  // auto: nobody pressed Continue in time (see Still teaching? below), and the
  // teacher may be on another page of the site, which isn't redrawn.
  function finishLiveClass(auto) {
    live.busy = true;
    if (!auto) keep.askAt = 0;
    closeKeep();
    if (onLivePage()) render();
    callBackend({ action: "liveEnd", passcode: state.teacher.passcode }).then(function (res) {
      if (res && res.ok) {
        live.remote = { running: false };
        live.teacherIndex = null;
        live.attendees = [];
        keep.askAt = 0;
        keep.session = "";
        if (auto) showKeepEnded(keepEndedText());
        // The meter catches up with the call in about 2 minutes, once Daily and the script have the numbers.
        usage.at = Math.min(usage.at, Date.now() - USAGE_REFRESH_MS + 150000);
      } else if (res && res.error === "wrong-passcode") {
        forgetTeacherPasscode();
        state.teacher.error = "That passcode didn't work. Check it matches the one in your Google script.";
      }
    }, function () {
      live.error = t("Couldn't end the class. Try again.");
      if (auto) keep.checked = ""; // tried again in a moment
    }).then(function () {
      live.busy = false;
      if (onLivePage()) render();
      if (auto) keepTick();
    });
  }

  /* ---------- Still teaching? ----------
     So a class isn't left running by mistake, the teacher's page asks every
     30 minutes (from the start, or the last Continue) and ends the class for
     everyone if Continue isn't pressed within 10. It shows on any page of the
     site, over everything. The script keeps the time (askIn in its replies),
     so every page the teacher has open agrees, and it ends a forgotten class
     itself 2 minutes later, in case the page was closed (see Code.gs). With an
     older script, this page counts from when it first saw the class. */

  var LIVE_ASK_MS = 30 * 60000;
  var LIVE_ANSWER_MS = 10 * 60000;

  function keepEndedText() {
    return t("Continue wasn't pressed within {n} minutes, so the class ended for everyone.", { n: LIVE_ANSWER_MS / 60000 });
  }

  var keep = {
    askAt: 0,         // when to ask, on this computer's clock; 0 with no class
    session: "",      // the class askAt is for
    stage: "",        // "ask" while the question shows, "ended" when it says the class ended
    checked: "",      // the step the script was last asked about, so it's asked once per step
    checking: false,
    sending: false,   // Continue is on its way to the script
    error: "",
    timer: null,
    box: null,        // the <dialog>, made the first time it's needed
    ui: null
  };

  // From the script's reply about the class: when to ask next.
  function noteKeep(res) {
    if (!isLiveTeacher()) return;
    if (!res || !res.running) {
      // Ended after the countdown ran out: by this page, or by the script if this page was asleep.
      var due = keep.askAt && Date.now() >= keep.askAt + LIVE_ANSWER_MS;
      keep.askAt = 0;
      keep.session = "";
      if (due) showKeepEnded(keepEndedText());
      else if (keep.stage === "ask") closeKeep();
    } else {
      var at = typeof res.askIn === "number" ? Date.now() + res.askIn
        : keep.session === res.sessionId ? keep.askAt
        : Date.now() + LIVE_ASK_MS; // an older script
      // A few seconds either way is just the time the reply took, and would make the countdown jump.
      if (keep.session !== res.sessionId || Math.abs(at - keep.askAt) > 5000) keep.askAt = at;
      keep.session = res.sessionId;
    }
    if (!keep.checking) keepTick();
  }

  // Shows the question when it's time, counts down, and ends the class when the time runs out.
  function keepTick() {
    clearTimeout(keep.timer);
    keep.timer = null;
    if (!keep.askAt || !isLiveTeacher()) {
      if (keep.stage === "ask") closeKeep();
      return;
    }
    var now = Date.now();
    if (now < keep.askAt) {
      if (keep.stage === "ask") closeKeep();
      keep.timer = setTimeout(keepTick, Math.min(keep.askAt - now, 60000)); // each minute, in case the computer slept
      return;
    }
    var left = keep.askAt + LIVE_ANSWER_MS - now;
    var step = (left > 0 ? "ask " : "end ") + keep.askAt;
    // The script is asked first, in case the class ended, or went on, from another page.
    if (keep.checked !== step) {
      checkKeep(step);
      return;
    }
    if (left > 0) {
      if (!keep.sending || keep.stage === "ask") showKeepAsk(left); // closed with Escape, it stays closed while Continue sends
      keep.timer = setTimeout(keepTick, left % 1000 || 1000);
    } else if (!live.busy) {
      finishLiveClass(true);
    } else {
      keep.timer = setTimeout(keepTick, 5000);
    }
  }

  function checkKeep(step) {
    if (keep.checking) return;
    keep.checking = true;
    callBackend({ action: "liveState" }).then(function (res) {
      if (!res || !res.ok || live.moving) return;
      live.remote = res;
      if (!res.running) live.teacherIndex = null;
      noteKeep(res);
    }, function () { /* goes ahead without it */ }).then(function () {
      keep.checking = false;
      keep.checked = step;
      keepTick();
      renderLiveIfChanged();
    });
  }

  function continueLiveClass() {
    if (keep.sending) return;
    keep.sending = true;
    keep.error = "";
    keepTick();
    callBackend({ action: "liveKeep", passcode: state.teacher.passcode }).then(function (res) {
      if (res && res.ok) {
        noteKeep(res);
      } else if (res && res.error === "not-live") {
        live.remote = { running: false };
        live.teacherIndex = null;
        keep.askAt = 0;
        keep.session = "";
        showKeepEnded(t("The class had already ended."));
      } else if (res && res.error === "wrong-passcode") {
        forgetTeacherPasscode();
        state.teacher.error = "That passcode didn't work. Check it matches the one in your Google script.";
      } else {
        // bad-request: a Google script from before Continue, so this page keeps the time.
        keep.askAt = Date.now() + LIVE_ASK_MS;
      }
    }, function () {
      keep.error = t("Couldn't reach the class service. Check your connection and try again.");
    }).then(function () {
      keep.sending = false;
      keepTick();
      renderLiveIfChanged();
    });
  }

  // Outside #app, so redrawing the page leaves it alone.
  function keepDialog() {
    if (keep.box) return;
    var ui = keep.ui = {};
    ui.title = el("h2", { id: "keep-title" });
    ui.count = el("p", { class: "keep-count" });
    ui.text = el("p", { id: "keep-text" });
    ui.hint = el("p", { class: "hint" });
    ui.error = el("p", { class: "notice error" });
    ui.go = el("button", { class: "btn primary", type: "button", onclick: function () {
      if (keep.stage === "ask") continueLiveClass(); else closeKeep();
    } });
    ui.end = el("button", { class: "btn", type: "button", onclick: function () { finishLiveClass(false); } });
    keep.box = el("dialog", {
      class: "keep-dialog no-print", role: "alertdialog", "aria-labelledby": "keep-title", "aria-describedby": "keep-text",
      // Escape closes it, which is Continue while it asks.
      onclose: function () {
        if (keep.box.open) return; // opened again since
        var asking = keep.stage === "ask";
        keep.stage = "";
        markTitle();
        if (asking) continueLiveClass();
      }
    }, [ui.title, ui.count, ui.text, ui.hint, ui.error, el("div", { class: "actions" }, [ui.go, ui.end])]);
    document.body.appendChild(keep.box);
  }

  function showKeepAsk(left) {
    keepDialog();
    var ui = keep.ui;
    var s = Math.ceil(left / 1000);
    ui.title.textContent = t("Still teaching?");
    ui.count.hidden = false;
    ui.count.textContent = Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
    ui.text.textContent = t("When this reaches 0:00, the live class ends for everyone, unless you press Continue.");
    ui.hint.hidden = false;
    ui.hint.textContent = t("You're asked every {n} minutes, so a class isn't left running by mistake.", { n: LIVE_ASK_MS / 60000 });
    ui.error.hidden = !keep.error;
    ui.error.textContent = keep.error;
    ui.go.textContent = keep.sending ? t("Continuing…") : t("Continue");
    ui.end.hidden = false;
    ui.end.disabled = keep.sending || live.busy;
    ui.end.textContent = t("End class now");
    openKeep("ask");
  }

  function showKeepEnded(message) {
    keepDialog();
    var ui = keep.ui;
    keep.error = "";
    ui.title.textContent = t("The live class has ended");
    ui.count.hidden = true;
    ui.text.textContent = message;
    ui.hint.hidden = true;
    ui.error.hidden = true;
    ui.go.textContent = t("OK");
    ui.end.hidden = true;
    openKeep("ended");
    ui.go.focus();
  }

  function openKeep(stage) {
    keep.stage = stage;
    if (!keep.box.open) keep.box.showModal(); // puts the focus on its first button
    markTitle();
  }

  function closeKeep() {
    keep.stage = "";
    keep.error = "";
    if (keep.box && keep.box.open) keep.box.close();
    markTitle();
  }

  // The tab's title starts with ⏰ while it asks, for a teacher who's on another tab.
  function markTitle() {
    var title = document.title.replace(/^⏰ /, "");
    document.title = (keep.stage === "ask" ? "⏰ " : "") + title;
  }

  function joinLiveClass(name, email) {
    live.joining = true;
    live.joinError = "";
    render();
    callBackend({ action: "liveJoin", name: name, email: email }).then(function (res) {
      if (res && res.ok) {
        live.remote = res;
        live.joinedSession = res.sessionId;
        live.joinedThisVisit = true;
        live.joinedAs = name;
        live.email = email;
        writeSetting("hebrewClass.liveEmail", email);
        writeSetting("hebrewClass.liveSession", res.sessionId);
        writeSetting("hebrewClass.liveName", name);
        boardChanged();
      } else if (res && res.error === "not-live") {
        live.remote = { running: false };
        live.joinError = t("The class isn't live right now.");
      } else if (res && res.error === "bad-name") {
        live.joinError = t("Please enter your name.");
      } else if (res && res.error === "bad-email") {
        live.joinError = t("That email doesn't look right. You can also leave it empty.");
      } else {
        live.joinError = t("Couldn't join. Try again.");
      }
    }, function () {
      live.joinError = t("Couldn't reach the class service. Check your connection and try again.");
    }).then(function () {
      live.joining = false;
      render();
      scheduleLivePoll();
    });
  }

  function renderLive(lesson) {
    live.shownKey = liveKey();

    if (!config.resultsUrl) {
      return el("p", { class: "notice", text: t("The live class needs the Google script connected (see README.md).") });
    }
    var parts = [];
    // Students see the vowel marks switch only once there are words to show.
    if (isLiveTeacher() || liveHere(lesson)) parts.push(el("div", { class: "toolbar study-toolbar no-print" }, [niqqudToggle()]));
    if (live.error) parts.push(el("p", { class: "notice error", text: live.error }));
    parts.push(isLiveTeacher() ? renderLiveTeacher(lesson) : renderLiveStudent(lesson));
    return el("div", { class: "live-view" }, parts);
  }

  function liveCard(lesson, index, teacher) {
    var list = cardList(lesson);
    if (!list.length) return [el("p", { class: "notice", text: t("This lesson has no phrases yet.") })];
    index = Math.min(index, list.length - 1);
    var pct = Math.round(((index + 1) / list.length) * 100);
    var card = wordCard(list[index]);
    var nodes = [
      el("div", { class: "progress-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + pct + "%" })]),
      card
    ];
    if (teacher) {
      addSwipe(card, moveLive);
      nodes.push(el("div", { class: "card-nav" }, [
        el("button", { class: "btn", type: "button", disabled: index === 0, onclick: function () { moveLive(-1); }, text: t("← Previous") }),
        el("span", { class: "card-count", "aria-live": "polite", text: (index + 1) + " / " + list.length }),
        el("button", { class: "btn primary", type: "button", disabled: index === list.length - 1, onclick: function () { moveLive(1); }, text: t("Next word →") })
      ]));
    } else {
      nodes.push(el("p", { class: "live-follow", "aria-live": "polite" }, [
        el("span", { class: "live-dot on", "aria-hidden": "true" }),
        t("Following your teacher") + " · " + (index + 1) + " / " + list.length
      ]));
    }
    var explanation = sectionExplanation(list[index]);
    if (explanation) nodes.push(explanation);
    return nodes;
  }

  function renderLiveTeacher(lesson) {
    var r = live.remote || {};
    var wrap = el("div");
    if (!live.checked) {
      wrap.appendChild(el("p", { class: "notice", text: t("Checking whether a class is live…") }));
      return wrap;
    }
    if (!liveHere(lesson)) {
      var other = r.running && findLesson(r.lessonId);
      // Before a class, the list opens another lesson to start it on.
      var picker = lessonPicker("live", t("Change lesson"), "live", lesson);
      wrap.appendChild(el("div", { class: "subtabs no-print" }, [picker.button, picker.menu]));
      // With a class running on another lesson (opened from an old link, or Back),
      // the class can come here, or a new one can start, which ends it.
      wrap.appendChild(el("div", { class: "card live-start" }, [
        el("h2", { text: t("Teach this lesson live") }),
        el("p", { text: t("Start the class, then share this page's link with your students. They join with their name and see whichever word you're on, a few seconds after you move.") }),
        r.running ? el("p", { class: "notice", text: t("A live class is running for “{lesson}”. Move it here to keep everyone in it, or start a new class here, which ends it.", { lesson: other ? lessonName(other) : r.lessonId }) }) : null,
        el("div", { class: "actions" }, [
          r.running ? el("button", { class: "btn primary", type: "button", disabled: live.busy || live.moving, onclick: function () { moveLiveClass(lesson); }, text: t("Move the class here") }) : null,
          el("button", { class: "btn" + (r.running ? "" : " primary"), type: "button", disabled: live.busy || live.moving, onclick: function () { startLiveClass(lesson); }, text: live.busy ? t("Starting…") : r.running ? t("Start a new class") : t("Start live class") })
        ])
      ]));
      var meter = usageMeter(t);
      if (meter) wrap.appendChild(meter);
      wrap.appendChild(teacherSignOut());
      return wrap;
    }

    // During the class, the list moves it to another lesson; everyone stays in it.
    var mover = lessonPicker("live", t("Change lesson"), "live", lesson, {
      choose: moveLiveClass,
      title: t("Move the class to another lesson. Everyone who joined stays in it.")
    });
    wrap.appendChild(el("div", { class: "subtabs no-print" }, [mover.button, mover.menu]));
    liveCard(lesson, liveIndex(), true).forEach(function (n) { wrap.appendChild(n); });
    wrap.appendChild(callPanel());
    var people = live.attendees;
    wrap.appendChild(el("div", { class: "card live-panel" }, [
      el("div", { class: "live-panel-head" }, [
        el("h2", null, [el("span", { class: "live-dot on", "aria-hidden": "true" }), t("Live now")]),
        el("button", { class: "btn", type: "button", disabled: live.busy, onclick: endLiveClass, text: t("End class") })
      ]),
      el("p", { class: "muted", text: people.length ? t(people.length === 1 ? "1 student has joined:" : "{n} students have joined:", { n: people.length }) : t("No students have joined yet. Share this page's link with them.") }),
      people.length ? el("ul", { class: "live-people" }, people.map(function (p) {
        return el("li", { text: attendeeLabel(p) });
      })) : null,
      el("p", { class: "hint", text: t("Use the ← → arrow keys or the buttons to move. Students' screens follow within a few seconds.") })
    ]));
    var meter = usageMeter(t);
    if (meter) wrap.appendChild(meter);
    return wrap;
  }

  /* ---------- Video minutes meter ----------
     For the teacher, on Live class and the Teacher page: this month's video
     minutes on the whole Daily account (every call, the test script's too)
     against Daily's 10,000 free ones, read by the script from Daily's records. */

  var USAGE_REFRESH_MS = 5 * 60000;
  var usage = { info: null, loading: false, at: 0 }; // info: { minutes, free, since } from the script

  function loadCallUsage() {
    if (!config.resultsUrl || !state.teacher.passcode || usage.loading || Date.now() - usage.at < USAGE_REFRESH_MS) return;
    usage.loading = true;
    var before = JSON.stringify(usage.info);
    callBackend({ action: "callUsage", passcode: state.teacher.passcode }).then(function (res) {
      if (res && res.ok) usage.info = { minutes: Number(res.minutes) || 0, free: Number(res.free) || 10000, since: res.since };
      // No meter without a Daily key, or with a script from before it (bad-request).
      else if (res && (res.error === "no-video" || res.error === "bad-request")) usage.info = null;
    }, function () { /* keep the last numbers */ }).then(function () {
      usage.loading = false;
      usage.at = Date.now();
      var onLive = state.route.view === "lesson" && state.route.tab === "live" && isLiveTeacher();
      if (JSON.stringify(usage.info) !== before && (onTeacherPage() || onLive)) render();
    });
  }

  // tr is t on Live class; the Teacher page passes english, as it stays in English.
  function usageMeter(tr) {
    var info = usage.info;
    if (!info) return null;
    var pct = info.minutes / info.free * 100;
    // Tenths below 10%, so the first minutes show; never more than the bar can hold.
    var shown = pct > 0 && pct < 10 ? Math.max(0.1, Math.round(pct * 10) / 10) : Math.round(pct);
    var level = pct >= 90 ? " high" : pct >= 75 ? " mid" : "";
    var locale = tr === t ? dateLocale() : undefined;
    var since = new Date(info.since).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" });
    return el("div", { class: "card usage-card no-print" + level }, [
      el("div", { class: "usage-head" }, [
        el("h2", { text: tr("Video minutes this month") }),
        el("span", { class: "usage-pct", text: shown.toLocaleString(locale) + "%" })
      ]),
      el("div", { class: "usage-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + Math.min(100, pct) + "%" })]),
      el("p", { class: "usage-text", text: tr("{used} of {free} free minutes", { used: info.minutes.toLocaleString(locale), free: info.free.toLocaleString(locale) }) }),
      el("p", { class: "hint", text: tr("Since {date}, for every call on your Daily account. Daily charges for minutes above the free ones.", { date: since }) })
    ]);
  }

  function english(text, vars) {
    return vars ? text.replace(/\{(\w+)\}/g, function (m, key) { return key in vars ? String(vars[key]) : m; }) : text;
  }

  function teacherSignOut() {
    return el("p", { class: "hint" }, [
      t("You're signed in as the teacher on this browser.") + " ",
      el("button", { class: "linklike", type: "button", text: t("Sign out"), onclick: signOut })
    ]);
  }

  function renderLiveStudent(lesson) {
    var r = live.remote || {};
    var wrap = el("div");
    if (!live.checked) {
      wrap.appendChild(el("p", { class: "notice", text: t("Checking whether the class is live…") }));
    } else if (!r.running) {
      wrap.appendChild(el("div", { class: "card live-start" }, [
        el("h2", { text: live.joinedThisVisit ? t("The live class has ended") : t("The class isn't live right now") }),
        el("p", { text: live.joinedThisVisit ? t("Thanks for joining! You can keep practising with Word by word or the quiz.") : t("When your teacher starts the class, you can join here. This page checks every few seconds, so you can leave it open.") })
      ]));
    } else if (r.lessonId !== lesson.id) {
      var other = findLesson(r.lessonId);
      wrap.appendChild(el("div", { class: "card live-start" }, [
        el("h2", { text: t("The live class is on another lesson") }),
        other ? el("a", { class: "btn primary", href: lessonUrl(other, "live"), text: t("Go to “{lesson}”", { lesson: lessonName(other) }) }) : el("p", { text: t("Reload the page to see the newest lessons.") })
      ]));
    } else if (live.joinedSession !== r.sessionId) {
      wrap.appendChild(joinForm());
    } else {
      live.joinedThisVisit = true;
      liveCard(lesson, liveIndex(), false).forEach(function (n) { wrap.appendChild(n); });
      wrap.appendChild(callPanel());
      wrap.appendChild(el("p", { class: "hint live-signed", text: t("Joined as {name}", { name: live.joinedAs || state.studentName }) }));
    }
    return wrap;
  }

  function joinForm() {
    var nameInput = el("input", {
      type: "text",
      id: "live-name",
      required: true,
      maxlength: "60",
      autocomplete: "name",
      value: state.studentName
    });
    var emailInput = el("input", {
      type: "email",
      id: "live-email",
      autocomplete: "email",
      value: live.email,
      oninput: function (e) { live.email = e.target.value; }
    });
    return el("form", {
      class: "card live-start",
      onsubmit: function (e) {
        e.preventDefault();
        var name = nameInput.value.trim();
        if (name && !live.joining) joinLiveClass(name, emailInput.value.trim());
      }
    }, [
      el("h2", null, [el("span", { class: "live-dot on", "aria-hidden": "true" }), t("The class is live")]),
      el("p", { text: t("Enter your name to join. You'll see the word your teacher is on.") }),
      el("div", { class: "field" }, [el("label", { for: "live-name", text: t("Your name") }), nameInput]),
      el("div", { class: "field" }, [el("label", { for: "live-email", text: t("Your email (optional)") }), emailInput]),
      live.joinError ? el("p", { class: "notice error", text: live.joinError }) : null,
      el("button", { class: "btn primary", type: "submit", disabled: live.joining, text: live.joining ? t("Joining…") : t("Join the class") })
    ]);
  }

  /* ---------- Live class video call ----------
     When the Google script has a Daily key, everyone in the live class is in a
     video call on the Live class page. The teacher and the first 10 students to
     join can turn on their camera and see each other; everyone can listen and
     talk. The page draws the videos itself with Daily's call object, so Show
     videos can hide them (and stop downloading them) while the sound keeps
     playing. Students start muted with the camera off; the teacher starts with
     both on. Leaving the Live class page leaves the call; coming back rejoins. */

  var DAILY_SCRIPT = "https://unpkg.com/@daily-co/daily-js@0.94.0/dist/daily.js";

  // Why there's no call, from the script or from Daily. The class goes on without it.
  // The script keeps calls within Daily's free minutes (see Code.gs).
  var CALL_STOPS = {
    "used-up": "This month's free video minutes are used up, so this class has no video call. Everything else works as usual.",
    "call-full": "The video call is full. Everything else works as usual.",
    "meeting-full": "The video call is full. Everything else works as usual.",
    "time-up": "The video call's time is up for this class. Everything else works as usual.",
    "exp-room": "The video call's time is up for this class. Everything else works as usual.",
    "exp-token": "The video call's time is up for this class. Everything else works as usual."
  };

  var call = {
    session: "",         // the class session the call is for, "" when there's none
    status: "",          // "starting", "joined", "failed" or "off" (no call for this class)
    error: "",           // a problem to show, such as a blocked camera
    frame: null,         // Daily's call object
    canVideo: false,     // the teacher, or one of the first students to join
    seats: 10,           // how many students get video, as the script says
    endsAt: 0,           // when Daily ends the call
    shortened: false,    // ended early to stay within the free minutes
    mic: false,
    cam: false,
    showVideos: readSetting("hebrewClass.showVideos", "1") !== "0",
    soundBlocked: false, // the browser wants a tap before it plays sound
    asked: {},           // what was last asked of Daily for each person, so it's asked once
    tiles: {},           // session id -> { box, video, initial, name, muted }
    audios: {},          // session id -> <audio>
    audioBox: null,      // outside the page's content, so re-drawing the page never stops the sound
    leaving: null,       // while the last call closes
    ui: null             // the panel's elements, kept across renders so the videos keep playing
  };
  var dailyLoading = null;

  // The class session this page should be in the call for, or "".
  function callWanted() {
    if (state.route.view !== "lesson" || state.route.tab !== "live") return "";
    var r = live.remote;
    if (!r || !r.running || r.lessonId !== state.route.lessonId) return "";
    return isLiveTeacher() || live.joinedSession === r.sessionId ? r.sessionId : "";
  }

  // Joins or leaves the call to match the page. Runs after every render.
  function syncCall() {
    var want = callWanted();
    if (call.session === want) return;
    if (call.session) leaveCall();
    if (want) joinCall(want);
  }

  function joinCall(session) {
    call.session = session;
    call.status = "starting";
    call.error = "";
    updateCallPanel();
    var body = isLiveTeacher()
      ? { action: "liveCall", passcode: state.teacher.passcode }
      : { action: "liveCall", name: live.joinedAs || state.studentName, email: live.email, token: state.student ? state.student.token : "" };
    callBackend(body).then(function (res) {
      if (call.session !== session) return; // they left meanwhile
      if (res && res.ok) {
        return Promise.all([loadDaily(), call.leaving]).then(function () {
          if (call.session === session) return startDaily(res);
        });
      }
      var error = res && res.error;
      if (error === "wrong-passcode") {
        forgetTeacherPasscode();
        render();
      } else if (error === "not-joined") {
        // The script has no join under this name for the class: join again.
        live.joinedSession = "";
        removeSetting("hebrewClass.liveSession");
        render();
      } else if (error === "bad-request" || error === "no-video" || error === "not-live") {
        // A script from before the call, no Daily key, or the class just ended.
        call.status = "off";
        updateCallPanel();
      } else if (CALL_STOPS[error]) {
        pauseCall(t(CALL_STOPS[error]));
      } else {
        failCall(error === "wrong-pin" ? t("Sign out and sign in again to use the video call.") : t("The video call couldn't start."));
      }
    }).catch(function () {
      if (call.session === session) failCall(t("The video call couldn't start. Check your connection."));
    });
  }

  // daily-js is loaded only for a live class that has the call.
  function loadDaily() {
    if (window.Daily || window.DailyIframe) return Promise.resolve();
    if (!dailyLoading) {
      dailyLoading = new Promise(function (resolve, reject) {
        var script = el("script", { src: DAILY_SCRIPT, crossorigin: "anonymous" });
        script.onload = resolve;
        script.onerror = function () {
          dailyLoading = null;
          script.remove();
          reject(new Error("daily-js didn't load"));
        };
        document.head.appendChild(script);
      });
    }
    return dailyLoading;
  }

  function startDaily(info) {
    var Daily = window.Daily || window.DailyIframe;
    var teacher = isLiveTeacher();
    var frame = Daily.createCallObject({ subscribeToTracksAutomatically: false });
    call.frame = frame;
    call.canVideo = !!info.video;
    call.seats = info.seats || call.seats;
    call.endsAt = info.endsAt || 0;
    call.shortened = !!info.shortened;
    call.mic = teacher;
    call.cam = teacher && call.canVideo;
    // Events from a call this page has since left are ignored.
    function current(fn) {
      return function (e) { if (call.frame === frame) fn(e); };
    }
    ["participant-joined", "participant-updated", "participant-left", "track-started", "track-stopped"].forEach(function (name) {
      frame.on(name, current(onCallChange));
    });
    frame.on("joined-meeting", current(function () {
      call.status = "joined";
      onCallChange();
    }));
    frame.on("camera-error", current(function (e) {
      call.mic = !!frame.localAudio();
      call.cam = !!frame.localVideo();
      call.error = deviceError(e && e.error);
      updateCallPanel();
    }));
    frame.on("error", current(function (e) {
      var type = e && e.error && e.error.type;
      if (CALL_STOPS[type]) pauseCall(t(CALL_STOPS[type]));
      else failCall(t("The video call was disconnected."));
    }));
    frame.on("left-meeting", current(function () { failCall(t("The video call was disconnected.")); }));
    return frame.join({ url: info.url, token: info.token, startAudioOff: !call.mic, startVideoOff: !call.cam });
  }

  function deviceError(error) {
    var type = (error && error.type) || "";
    if (type === "permissions") return t("Your browser blocked the camera or microphone. Allow them for this site (the icon next to the address), then try again.");
    if (type === "not-found") return t("No camera or microphone was found on this device.");
    if (/in-use/.test(type)) return t("Another app is using the camera or microphone. Close it and try again.");
    return t("The camera or microphone couldn't start.");
  }

  // Stays on this class's session, so it isn't tried again by itself: Try again does that.
  function failCall(message) {
    var session = call.session;
    closeCall();
    call.session = session;
    call.status = "failed";
    call.error = message;
    updateCallPanel();
  }

  // No call for the rest of this class, and no Try again: it wouldn't help.
  function pauseCall(message) {
    failCall(message);
    call.status = "paused";
    updateCallPanel();
  }

  function retryCall() {
    var session = call.session;
    closeCall();
    if (session) joinCall(session);
  }

  function leaveCall() {
    closeCall();
    updateCallPanel();
  }

  function closeCall() {
    var frame = call.frame;
    call.frame = null;
    call.session = "";
    call.status = "";
    call.error = "";
    call.canVideo = false;
    call.endsAt = 0;
    call.shortened = false;
    call.soundBlocked = false;
    call.asked = {};
    Object.keys(call.tiles).forEach(removeTile);
    Object.keys(call.audios).forEach(removeAudio);
    if (!frame) return;
    var closing = Promise.resolve().then(function () { return frame.destroy(); }).catch(function () { /* already gone */ });
    call.leaving = closing;
    closing.then(function () { if (call.leaving === closing) call.leaving = null; });
  }

  // The teacher and the first students to join have "v-" at the start of their call ID (see Code.gs).
  function hasVideoSeat(p) {
    return !!p.owner || /^v-/.test(p.user_id || "");
  }

  function personName(p) {
    var name = p.owner ? t("Teacher") : p.user_name || "?";
    return p.local ? name + " " + t("(you)") : name;
  }

  function micOn(p) {
    var audio = p.tracks && p.tracks.audio;
    return !!audio && audio.state !== "off" && audio.state !== "blocked";
  }

  function videoTrack(p) {
    var video = p.tracks && p.tracks.video;
    return video && video.state === "playable" && video.persistentTrack || null;
  }

  // Everyone's sound, always; videos only for someone with video who has Show videos on.
  function onCallChange() {
    var frame = call.frame;
    if (!frame) return;
    var people = frame.participants();
    var here = {};
    Object.keys(people).forEach(function (k) {
      var p = people[k];
      if (p.local) return;
      var id = p.session_id;
      here[id] = true;
      var video = call.canVideo && call.showVideos && hasVideoSeat(p);
      var ask = video ? "sound+video" : "sound";
      if (call.asked[id] !== ask) {
        call.asked[id] = ask;
        try {
          frame.updateParticipant(id, { setSubscribedTracks: { audio: true, video: video, screenVideo: false } });
        } catch (e) { delete call.asked[id]; }
      }
      playSound(id, p.tracks && p.tracks.audio);
    });
    Object.keys(call.audios).forEach(function (id) { if (!here[id]) removeAudio(id); });
    Object.keys(call.asked).forEach(function (id) { if (!here[id]) delete call.asked[id]; });
    updateCallPanel();
  }

  function playSound(id, track) {
    var media = track && track.persistentTrack;
    if (!media) return;
    var audio = call.audios[id];
    if (!audio) {
      if (!call.audioBox) {
        call.audioBox = el("div", { hidden: true });
        document.body.appendChild(call.audioBox);
      }
      audio = el("audio", { autoplay: true });
      call.audioBox.appendChild(audio);
      call.audios[id] = audio;
    }
    if (!audio.srcObject || audio.srcObject.getAudioTracks()[0] !== media) {
      audio.srcObject = new MediaStream([media]);
      playMedia(audio);
    }
  }

  function playMedia(media) {
    var playing = media.play();
    if (playing && playing.catch) playing.catch(function (e) {
      if (e && e.name === "NotAllowedError" && media.tagName === "AUDIO" && !call.soundBlocked) {
        call.soundBlocked = true;
        updateCallPanel();
      }
    });
  }

  // A tap lets the browser play the sound it held back after a reload.
  function unblockSound() {
    call.soundBlocked = false;
    Object.keys(call.audios).forEach(function (id) { playMedia(call.audios[id]); });
    updateCallPanel();
  }

  function removeAudio(id) {
    var audio = call.audios[id];
    audio.srcObject = null;
    audio.remove();
    delete call.audios[id];
  }

  function toggleMic() {
    if (!call.frame) return;
    call.mic = !call.mic;
    call.error = "";
    call.frame.setLocalAudio(call.mic);
    if (call.soundBlocked) unblockSound();
    updateCallPanel();
  }

  function toggleCam() {
    if (!call.frame || !call.canVideo) return;
    call.cam = !call.cam;
    call.error = "";
    call.frame.setLocalVideo(call.cam);
    if (call.soundBlocked) unblockSound();
    updateCallPanel();
  }

  function setShowVideos(on) {
    call.showVideos = on;
    writeSetting("hebrewClass.showVideos", on ? "1" : "0");
    if (call.frame) onCallChange(); else updateCallPanel();
  }

  // The call's card, made once and only updated after that.
  function callPanel() {
    if (!call.ui) {
      var ui = {};
      ui.title = el("h2");
      ui.showBox = el("input", { type: "checkbox", onchange: function (e) { setShowVideos(e.target.checked); } });
      ui.showText = el("span");
      ui.show = el("label", { class: "toggle call-show" }, [ui.showBox, ui.showText]);
      ui.mic = el("button", { class: "btn call-btn", type: "button", onclick: toggleMic });
      ui.cam = el("button", { class: "btn call-btn", type: "button", onclick: toggleCam });
      ui.sound = el("button", { class: "btn primary", type: "button", onclick: unblockSound });
      ui.retry = el("button", { class: "btn", type: "button", onclick: retryCall });
      ui.status = el("p", { class: "call-status", "aria-live": "polite" });
      ui.grid = el("div", { class: "call-grid" });
      ui.others = el("p", { class: "call-others" });
      ui.note = el("p", { class: "hint call-note" });
      ui.box = el("section", { class: "card call-panel no-print" }, [
        el("div", { class: "call-head" }, [ui.title, ui.show]),
        el("div", { class: "call-controls" }, [ui.mic, ui.cam, ui.sound, ui.retry]),
        ui.status, ui.grid, ui.others, ui.note
      ]);
      call.ui = ui;
    }
    updateCallPanel();
    return call.ui.box;
  }

  function updateCallPanel() {
    var ui = call.ui;
    if (!ui) return;
    var joined = call.status === "joined";
    var failed = call.status === "failed";
    var paused = call.status === "paused";
    ui.box.hidden = call.status === "off";
    ui.title.textContent = t("Video call");
    ui.show.hidden = !call.canVideo;
    ui.showBox.checked = call.showVideos;
    ui.showText.textContent = t("Show videos");
    ui.mic.hidden = !joined;
    ui.mic.textContent = call.mic ? t("Mute") : t("Unmute");
    ui.mic.classList.toggle("is-off", !call.mic);
    ui.cam.hidden = !joined || !call.canVideo;
    ui.cam.textContent = call.cam ? t("Turn camera off") : t("Turn camera on");
    ui.cam.classList.toggle("is-off", !call.cam);
    ui.sound.hidden = !joined || !call.soundBlocked;
    ui.sound.textContent = t("Turn on sound");
    ui.retry.hidden = !failed;
    ui.retry.textContent = t("Try again");
    var status = call.error || (joined || failed || paused ? "" : t("Connecting to the video call…"));
    if (!call.error && joined && call.shortened && call.endsAt) {
      var time = new Date(call.endsAt).toLocaleTimeString(dateLocale(), { hour: "numeric", minute: "2-digit" });
      status = t("To stay within this month's free minutes, the video call ends at {time}.", { time: time });
    }
    ui.status.textContent = status;
    ui.status.hidden = !status;
    ui.status.classList.toggle("error", !!call.error && !paused);

    var people = joined && call.frame ? call.frame.participants() : {};
    var list = Object.keys(people).map(function (k) { return people[k]; });
    var withVideo = list.filter(hasVideoSeat).sort(function (a, b) {
      if (!!a.owner !== !!b.owner) return a.owner ? -1 : 1;
      return joinedAt(a) - joinedAt(b);
    });
    var showGrid = joined && call.canVideo && call.showVideos;
    ui.grid.hidden = !showGrid;
    if (showGrid) updateTiles(withVideo);
    else Object.keys(call.tiles).forEach(removeTile);
    // The people not in the grid, by name.
    var others = list.filter(function (p) { return !p.local && (!showGrid || !hasVideoSeat(p)); }).map(personName);
    ui.others.textContent = others.length ? t(showGrid ? "Sound only: {names}" : "In the call: {names}", { names: others.join(", ") }) : "";
    ui.others.hidden = !others.length;
    ui.note.textContent = t("Video is for your teacher and the first {n} students to join. You can still listen and talk.", { n: call.seats });
    ui.note.hidden = !joined || call.canVideo;
  }

  function joinedAt(p) {
    return p.joined_at ? new Date(p.joined_at).getTime() : 0;
  }

  function updateTiles(list) {
    var grid = call.ui.grid;
    var keep = {};
    list.forEach(function (p, i) {
      var id = p.session_id;
      keep[id] = true;
      var tile = call.tiles[id] || makeTile(id);
      var track = videoTrack(p);
      var video = tile.video;
      if (track) {
        if (!video.srcObject || video.srcObject.getVideoTracks()[0] !== track) video.srcObject = new MediaStream([track]);
        if (video.paused) playMedia(video);
      } else if (video.srcObject) {
        video.srcObject = null;
      }
      var name = personName(p);
      tile.box.classList.toggle("cam-off", !track);
      tile.box.classList.toggle("is-local", !!p.local);
      tile.initial.textContent = name.charAt(0).toUpperCase();
      tile.name.textContent = name;
      tile.muted.hidden = micOn(p);
      tile.muted.setAttribute("aria-label", t("Microphone off"));
      tile.muted.title = t("Microphone off");
      if (grid.children[i] !== tile.box) grid.insertBefore(tile.box, grid.children[i] || null);
    });
    Object.keys(call.tiles).forEach(function (id) { if (!keep[id]) removeTile(id); });
  }

  function makeTile(id) {
    var video = el("video", { autoplay: true, playsinline: true, muted: true });
    video.muted = true; // the sound plays from its own element, so hiding videos keeps it
    var tile = {
      video: video,
      initial: el("span", { class: "call-initial", "aria-hidden": "true" }),
      name: el("span", { class: "call-name" }),
      muted: el("span", { class: "call-muted", role: "img", text: "🔇" })
    };
    tile.box = el("div", { class: "call-tile" }, [video, tile.initial, el("span", { class: "call-label" }, [tile.muted, tile.name])]);
    call.tiles[id] = tile;
    return tile;
  }

  function removeTile(id) {
    var tile = call.tiles[id];
    tile.video.srcObject = null;
    tile.box.remove();
    delete call.tiles[id];
  }

  // Closing or leaving the page leaves the call straight away; coming back to it rejoins.
  window.addEventListener("pagehide", function () {
    if (call.frame) call.frame.leave();
  });
  window.addEventListener("pageshow", function (e) {
    if (e.persisted && call.session) retryCall();
  });

  /* ---------- Teacher dashboard ---------- */

  function loadResults() {
    var t = state.teacher;
    if (!config.resultsUrl || !t.passcode || t.loading) return;
    var rejected = false;
    t.loading = true;
    loadTeacherBoard();
    loadCallUsage(); // every few minutes
    callBackend({ action: "list", passcode: t.passcode }).then(function (res) {
      if (res && res.ok) {
        t.results = res.results || [];
        t.practice = res.practice || [];
        t.students = res.students || [];
        t.pinChanges = res.pinChanges || null; // null: a Google script from before the PIN log
        t.signIns = res.signIns || null;
        t.classes = res.classes || null;
        t.classNames = res.classNames || null;
        t.error = "";
        t.updatedAt = new Date();
      } else if (res && res.error === "wrong-passcode") {
        t.passcode = "";
        t.results = null;
        t.error = "That passcode didn't work. Check it matches the one in your Google script.";
        writeSetting("hebrewClass.teacherPasscode", "");
        rejected = true;
      } else {
        t.error = "The results service replied with an error.";
      }
    }, function () {
      t.error = "Couldn't reach the results service. Check your connection; it will retry.";
    }).then(function () {
      t.loading = false;
      // A rejected passcode signs the teacher out, whatever page they are on.
      if (rejected || onTeacherPage()) render();
    });
  }

  // Everyone's points this week and last, for the championship board card.
  // A wrong passcode is dealt with by loadResults, which runs alongside.
  function loadTeacherBoard() {
    var t = state.teacher;
    if (!config.resultsUrl || !t.passcode || t.boardLoading || t.boardOff) return;
    t.boardLoading = true;
    callBackend({ action: "board", passcode: t.passcode }).then(function (res) {
      if (res && res.ok && res.students) t.board = res;
      else if (res && res.error === "bad-request") t.boardOff = true; // a Google script from before the board
    }, function () { /* tried again with the next refresh */ }).then(function () {
      t.boardLoading = false;
      if (onTeacherPage()) render();
    });
  }

  function setBoardHidden(student, hidden) {
    var t = state.teacher;
    if (t.boardBusy) return;
    t.boardBusy = student.name;
    t.boardError = "";
    render();
    callBackend({ action: "boardHide", passcode: t.passcode, name: student.name, hidden: hidden }).then(function (res) {
      if (res && res.ok && res.students) t.board = res;
      else t.boardError = "Couldn't change that. Try again.";
    }, function () {
      t.boardError = "Couldn't reach the class service. Try again.";
    }).then(function () {
      t.boardBusy = "";
      resetBoard(); // the Lessons page on this device shows the change straight away,
      removeSetting(BOARD_SAVED); // without the saved board showing a hidden name first
      render();
    });
  }

  function renderBoardCard(t) {
    var head = el("div", null, [
      el("h2", { text: "Championship board" }),
      el("p", { class: "hint", text: "Last week's champion and this week's top 3 show at the top of the Lessons page. Points: 1 per correct quiz answer (best try at each quiz), 2 per Word of the day, 10 per live class. Hide a name to keep it off the board, such as a test name or a student who'd rather not appear." })
    ]);
    if (t.boardOff) {
      return el("div", { class: "card dash-card" }, [head,
        el("p", { class: "notice", text: "To switch the board on, paste the new results-sheet/Code.gs into your Google script and deploy a new version (Deploy → Manage deployments → Edit → Version: New version)." })]);
    }
    if (!t.board) {
      return el("div", { class: "card dash-card" }, [head, el("p", { class: "notice", text: "Loading the board…" })]);
    }
    var rows = t.board.students.map(function (s) {
      var busy = t.boardBusy === s.name;
      return el("tr", { class: s.hidden ? "board-hidden" : null }, [
        el("th", { scope: "row" }, [s.name, s.hidden ? el("span", { class: "board-tag", text: "Hidden" }) : null]),
        el("td", { class: s.points ? null : "empty", text: s.points ? String(s.points) : "–" }),
        el("td", { class: s.lastWeek ? null : "empty", text: s.lastWeek ? String(s.lastWeek) : "–" }),
        el("td", null, [el("button", {
          class: "btn board-toggle",
          type: "button",
          disabled: !!t.boardBusy,
          "aria-label": (s.hidden ? "Show " : "Hide ") + s.name + " on the board",
          text: busy ? "Saving…" : s.hidden ? "Show" : "Hide",
          onclick: function () { setBoardHidden(s, !s.hidden); }
        })])
      ]);
    });
    return el("div", { class: "card dash-card" }, [
      head,
      t.boardError ? el("p", { class: "notice error", role: "alert", text: t.boardError }) : null,
      rows.length ? el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid board-grid" }, [
        el("thead", null, [el("tr", null, [
          el("th", { scope: "col", text: "Student" }),
          el("th", { scope: "col", text: "This week" }),
          el("th", { scope: "col", text: "Last week" }),
          el("th", { scope: "col" }, [el("span", { class: "visually-hidden", text: "On the board" })])
        ])]),
        el("tbody", null, rows)
      ])]) : el("p", { class: "notice", text: "No students yet." })
    ]);
  }

  // The dashboard is at #/teacher, and at #/progress for a signed-in teacher.
  function onTeacherPage() {
    return state.route.view === "teacher" || (state.route.view === "progress" && isTeacher());
  }

  function studentKey(name) {
    return String(name).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString(dateLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function scoreClass(score, total) {
    var pct = total ? score / total : 0;
    return pct >= 0.8 ? "good" : pct >= 0.5 ? "ok" : "low";
  }

  function renderTeacher() {
    var t = state.teacher;
    var wrap = el("section", null, [
      el("a", { class: "back", href: "#/", text: "← All lessons" }),
      el("h1", { text: "Teacher dashboard" })
    ]);

    if (!config.resultsUrl) {
      wrap.appendChild(el("p", { class: "notice", text: "Quiz results aren't connected yet. Follow “Getting quiz results” in README.md, then add the script URL to config.js." }));
      return wrap;
    }

    if (!t.passcode) {
      var input = el("input", { type: "password", required: true, autocomplete: "current-password", id: "teacher-passcode" });
      wrap.appendChild(el("form", {
        class: "card",
        onsubmit: function (e) {
          e.preventDefault();
          var code = input.value.trim();
          if (!code) return;
          signInTeacher(code);
        }
      }, [
        el("p", { style: "margin-top:0", text: "Enter the passcode you set in your Google script. This device will remember it." }),
        t.error ? el("p", { class: "notice error", text: t.error }) : null,
        el("label", { class: "field" }, [el("span", { text: "Passcode" }), input]),
        el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", text: "Open dashboard" })])
      ]));
      return wrap;
    }

    var status = t.loading && !t.results ? "Loading results…"
      : t.updatedAt ? "Updated " + t.updatedAt.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " · refreshes every 30 seconds"
      : "";
    wrap.appendChild(el("div", { class: "toolbar dash-toolbar" }, [
      el("p", { class: "dash-status", text: status }),
      el("button", { class: "btn", type: "button", text: t.loading ? "Refreshing…" : "Refresh", disabled: t.loading, onclick: loadResults })
    ]));
    if (t.error) wrap.appendChild(el("p", { class: "notice error", text: t.error }));
    if (!t.results) return wrap;

    wrap.appendChild(renderSuggestionsCard());
    var meter = usageMeter(english);
    if (meter) wrap.appendChild(meter);
    if (!t.results.length && !t.practice.length && !t.students.length) {
      wrap.appendChild(el("p", { class: "notice", text: "No students yet. They appear here as soon as someone signs in, finishes a quiz or practises the word of the day." }));
      return wrap;
    }
    wrap.appendChild(renderActivityCard(t));
    wrap.appendChild(renderWeekCard(t));
    if (t.report) wrap.appendChild(renderStudentReport(t));
    wrap.appendChild(renderBoardCard(t));
    wrap.appendChild(renderInvitesCard(t));
    if (t.results.length) {
      wrap.appendChild(renderScoreGrid(t));
      if (t.selected) wrap.appendChild(renderAttempts(t));
      var missedCard = renderMissedCard(t);
      if (missedCard) wrap.appendChild(missedCard);
    }
    var countriesCard = renderCountriesCard(t);
    if (countriesCard) wrap.appendChild(countriesCard);
    var pinCard = renderPinChanges(t);
    if (pinCard) wrap.appendChild(pinCard);
    return wrap;
  }

  // How many students are in each country, most first. Hidden until the
  // Google script saves countries.
  function renderCountriesCard(t) {
    var counts = {};
    var codes = {};
    var unknown = 0;
    t.students.forEach(function (s) {
      if (s.country) {
        counts[s.country] = (counts[s.country] || 0) + 1;
        if (s.countryCode) codes[s.country] = s.countryCode;
      } else unknown += 1;
    });
    var countries = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (!countries.length) return null;
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "Where students are" }),
      el("p", { class: "hint", text: "From each student's device time zone, saved when they sign in or next open the site." + (unknown ? " Not known yet: " + unknown + (unknown === 1 ? " student." : " students.") : "") }),
      el("ul", { class: "country-list" }, countries.map(function (country) {
        return el("li", null, [
          el("span", null, [flagIcon(codes[country]), country]),
          el("span", { class: "country-count", text: String(counts[country]) })
        ]);
      }))
    ]);
  }

  function renderSuggestionsCard() {
    var items = state.suggestions.items;
    // The teacher's own notes aren't waiting for a response.
    var waiting = items ? items.filter(function (s) { return !s.response && s.student !== "Teacher"; }).length : 0;
    var text = !items ? "Read your students' suggestions and respond to them."
      : waiting ? waiting + (waiting === 1 ? " suggestion is" : " suggestions are") + " waiting for your response."
      : items.length ? "You've responded to every suggestion."
      : "No suggestions yet.";
    return el("div", { class: "card dash-card suggest-card" }, [
      el("div", null, [el("h2", { text: "Suggestions box" }), el("p", { class: "hint", text: text })]),
      el("a", { class: "btn" + (waiting ? " primary" : ""), href: "#/suggestions", text: waiting ? "Respond" : "Open" })
    ]);
  }

  // Every student the sheet knows: signed in, took a quiz or practised.
  function knownStudents(t) {
    var names = {};
    function add(name) {
      var key = studentKey(name);
      if (key && !names[key]) names[key] = String(name).trim();
    }
    t.students.forEach(function (s) { add(s.name); });
    t.results.forEach(function (r) { add(r.student); });
    t.practice.forEach(function (p) { add(p.student); });
    return Object.keys(names).sort().map(function (key) { return { key: key, name: names[key] }; });
  }

  function studentData(t, key) {
    function mine(r) { return studentKey(r.student) === key; }
    return { results: t.results.filter(mine), practice: t.practice.filter(mine) };
  }

  // One week for the whole class: quizzes taken, average score, word of the day.
  function teacherWeekStart(t) {
    return addDays(weekStart(new Date()), 7 * t.week);
  }

  // What each student did in the week the teacher is looking at.
  function weekRows(t) {
    var start = teacherWeekStart(t);
    var startKey = dayKey(start);
    var endKey = dayKey(addDays(start, 6));
    return knownStudents(t).map(function (s) {
      var data = studentData(t, s.key);
      var quizzes = data.results.filter(function (r) {
        var d = new Date(r.finishedAt);
        return !isNaN(d) && dayKey(weekStart(d)) === startKey;
      });
      // Counted in the week they were practised, like the championship points.
      var days = {};
      var words = 0;
      data.practice.forEach(function (p) {
        var d = practisedOn(p);
        if (d && dayKey(weekStart(d)) === startKey) { days[d.getDay()] = true; words += 1; }
      });
      return { student: s, quizzes: quizzes, days: days, words: words, avg: averagePercent(quizzes) };
    });
  }

  // The class's week: totals, then one row per student. linked: names open
  // that student's report (on screen); the PDF has plain names.
  function weekNodes(t, linked) {
    var rows = weekRows(t);
    var active = 0, quizzes = 0, words = 0, sum = 0, marked = 0;
    rows.forEach(function (r) {
      if (r.quizzes.length || countDays(r.days)) active += 1;
      quizzes += r.quizzes.length;
      words += r.words;
      if (r.avg !== null) { sum += r.avg; marked += 1; }
    });
    var body = el("tbody", null, rows.map(function (r) {
      var s = r.student;
      var open = t.report === s.key;
      return el("tr", null, [
        el("th", { scope: "row" }, [linked ? el("button", {
          class: "linklike",
          type: "button",
          "aria-expanded": open ? "true" : "false",
          text: s.name,
          onclick: function () {
            t.report = open ? null : s.key;
            render();
            // The report opens below the table, often off screen: go to it.
            var card = document.getElementById("student-report");
            if (card) card.scrollIntoView({ block: "start" });
          }
        }) : s.name]),
        el("td", { class: r.quizzes.length ? null : "empty", text: r.quizzes.length ? String(r.quizzes.length) : "–" }),
        el("td", { class: r.avg === null ? "empty" : null }, [
          r.avg === null ? "–" : el("strong", { class: "score-pill " + scoreClass(r.avg, 100), text: r.avg + "%" })
        ]),
        el("td", null, [dayDots(r.days)])
      ]);
    }));
    return [
      el("div", { class: "stats" }, [
        statTile(active + " of " + rows.length, "students active"),
        statTile(quizzes, quizzes === 1 ? "quiz taken" : "quizzes taken"),
        statTile(marked ? Math.round(sum / marked) + "%" : "–", "class average"),
        statTile(words, "words of the day practised")
      ]),
      el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid week-grid" }, [
        el("thead", null, [el("tr", null, [
          el("th", { scope: "col", text: "Student" }),
          el("th", { scope: "col", text: "Quizzes taken" }),
          el("th", { scope: "col", text: "Average of best scores" }),
          el("th", { scope: "col", text: "Word of the day" })
        ])]),
        body
      ])])
    ];
  }

  // One week for the whole class: quizzes taken, average score, word of the day.
  function renderWeekCard(t) {
    var start = teacherWeekStart(t);
    return el("div", { class: "card dash-card" }, [
      el("div", { class: "week-head" }, [
        el("div", null, [
          el("h2", { text: "Weekly progress" }),
          el("p", { class: "hint", text: weekLabel(start) + (t.week === 0 ? " · this week" : "") + ". Tap a name for that student's full report and PIN buttons (it opens below the table)." })
        ]),
        el("div", { class: "week-nav" }, [
          el("button", { class: "btn", type: "button", "aria-label": "Previous week", text: "←", onclick: function () { t.week -= 1; render(); } }),
          el("button", { class: "btn", type: "button", "aria-label": "Next week", text: "→", disabled: t.week >= 0, onclick: function () { t.week += 1; render(); } }),
          pdfButton(function () { printClassReport(t); })
        ])
      ])
    ].concat(weekNodes(t, true)));
  }

  // The class report as a PDF: the chosen week, then everything so far.
  function printClassReport(t) {
    var nodes = weekNodes(t, false);
    if (t.results.length) {
      nodes.push(el("h3", { class: "report-title", text: "Best score per lesson, all weeks" }), scoreGrid(t, false));
      var missed = missedPhrases(t.results);
      if (missed.length) nodes.push(el("h3", { class: "report-title", text: "Most missed phrases" }), missedList(missed, 15, true));
    }
    printReport("Class report", "Week of " + weekLabel(teacherWeekStart(t)), nodes);
  }

  function renderStudentReport(t) {
    var student = knownStudents(t).filter(function (s) { return s.key === t.report; })[0];
    if (!student) return null;
    var data = studentData(t, student.key);
    var onFile = t.students.filter(function (s) { return studentKey(s.name) === student.key; })[0];
    var email = onFile && onFile.email;
    var pin = t.pinReset && t.pinReset.key === student.key ? t.pinReset : null;
    var history = (t.pinChanges || []).filter(function (c) { return studentKey(c.student) === student.key; });
    return el("div", { class: "card dash-card", id: "student-report" }, [
      el("div", { class: "week-head" }, [
        el("h2", { text: student.name + " · full report" }),
        el("div", { class: "week-nav" }, [
          onFile && onFile.hasPin && email ? el("button", { class: "btn", type: "button", disabled: !!(pin && pin.busy), text: pin && pin.busy === "email" ? "Sending…" : "Email temporary PIN", onclick: function () { emailTempPin(onFile); } }) : null,
          onFile && onFile.hasPin ? el("button", { class: "btn", type: "button", disabled: !!(pin && pin.busy), text: pin && pin.busy === "clear" ? "Clearing…" : "Clear PIN", onclick: function () { clearPin(onFile); } }) : null,
          pdfButton(function () { printReport("Progress report", student.name, reportNodes(data.results, data.practice)); }),
          el("button", { class: "btn", type: "button", text: "Close", onclick: function () { t.report = null; t.pinReset = null; render(); } })
        ])
      ]),
      email || (onFile && onFile.timeZone) ? el("p", { class: "hint" }, [
        onFile && onFile.timeZone ? el("span", { title: "Time zone " + onFile.timeZone }, [flagIcon(onFile.countryCode), onFile.country || onFile.timeZone]) : null,
        email && onFile && onFile.timeZone ? " · " : null,
        email ? el("a", { href: "mailto:" + email, text: email }) : null
      ]) : null,
      pin && pin.message ? el("p", { class: "notice" + (pin.error ? " error" : ""), role: "status", text: pin.message }) : null,
      // Until the student uses it. The PIN itself is only in their email (and the sheet).
      onFile && onFile.tempPinSent && !(pin && pin.message && !pin.error) ? el("p", { class: "notice", role: "status", text: "A temporary PIN was emailed to " + onFile.name + " and hasn't been used yet. It works until they sign in with it and choose their own PIN." }) : null,
      history.length ? el("details", { class: "pin-history" }, [
        el("summary", { text: "PIN history (" + history.length + ")" }),
        pinChangeList(history.slice().reverse(), false)
      ]) : null
    ].concat(reportNodes(data.results, data.practice)));
  }

  // Newest first. withNames: the class list (names shown); a student's own list leaves them out.
  function pinChangeList(changes, withNames) {
    return el("ul", { class: "recent pin-changes" }, changes.map(function (c) {
      return el("li", null, [
        withNames ? el("span", { class: "recent-name", text: c.student.trim() }) : null,
        el("span", { text: c.change }),
        el("span", { class: "muted", text: formatTime(c.at) })
      ]);
    }));
  }

  // Every PIN set, reset or changed, and every sign-in pause, newest first. Never the PINs.
  function renderPinChanges(t) {
    if (!t.pinChanges) return null;
    var all = t.pinChanges.slice().reverse();
    var shown = t.allPinChanges ? all : all.slice(0, 10);
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "PIN changes" }),
      el("p", { class: "hint", text: all.length ? "PINs chosen, reset or changed, and sign-ins paused after wrong PINs. The PINs themselves are never shown." : "No PIN changes yet." }),
      all.length ? pinChangeList(shown, true) : null,
      all.length > 10 ? el("button", { class: "btn", type: "button", text: t.allPinChanges ? "Show the latest 10" : "Show all " + all.length, onclick: function () { t.allPinChanges = !t.allPinChanges; render(); } }) : null
    ]);
  }

  // A PIN action on a student's report; busy is "email" or "clear".
  function pinAction(onFile, busy, body, onOk, failText) {
    var t = state.teacher;
    var key = studentKey(onFile.name);
    t.pinReset = { key: key, busy: busy };
    render();
    function done(message, error) {
      t.pinReset = { key: key, message: message, error: error };
      render();
    }
    body.passcode = t.passcode;
    body.name = onFile.name;
    callBackend(body).then(function (res) {
      if (res && res.ok) {
        done(onOk(res));
        loadResults(); // brings in the PIN history line
      } else if (res && res.error === "mail-failed") {
        done("The email couldn't be sent, so the PIN hasn't changed. Try again later, or use Clear PIN.", true);
      } else if (res && res.error === "no-email") {
        done("There's no email saved for " + onFile.name + ". Use Clear PIN instead.", true);
      } else {
        done(backendMessage(res, failText + " Try again."), true);
      }
    }, function () {
      done(failText + " Check your connection and try again.", true);
    });
  }

  // A 3-digit temporary PIN, sent only to the student's own email.
  function emailTempPin(onFile) {
    if (!window.confirm("Send " + onFile.name + " a temporary PIN by email (" + onFile.email + ")? Their old PIN stops working; they sign in with the temporary PIN and then choose their own.")) return;
    pinAction(onFile, "email", { action: "emailTempPin", siteUrl: config.siteUrl || "" }, function (res) {
      onFile.tempPinSent = true;
      return "Temporary PIN sent to " + (res.sentTo || onFile.email) + ". " + onFile.name + " signs in with it and then chooses their own PIN.";
    }, "Couldn't send the temporary PIN.");
  }

  // For a student with no email: their name works without a PIN until they choose one.
  function clearPin(onFile) {
    if (!window.confirm("Are you sure you want to clear the PIN for " + onFile.name + "? Until they sign in and choose a new PIN, anyone who types their name can sign in as them.")) return;
    pinAction(onFile, "clear", { action: "resetPin" }, function () {
      onFile.hasPin = false;
      onFile.tempPinSent = false;
      return "PIN cleared. Ask " + onFile.name + " to sign in soon with just their name and type a new PIN.";
    }, "Couldn't clear the PIN.");
  }

  // Which phrases the class gets wrong most: what to go over again.
  function renderMissedCard(t) {
    var missed = missedPhrases(t.results);
    if (!missed.length) return null;
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "Most missed phrases" }),
      el("p", { class: "hint", text: "The phrases most students got wrong in quizzes: good ones to go over in class." }),
      missedList(missed, 10, true)
    ]);
  }

  // Students down the side, lessons across the top; each cell is the best score.
  function renderScoreGrid(t) {
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "Best score per lesson" }),
      el("p", { class: "hint", text: "Tap a score to see each try and the phrases missed." }),
      scoreGrid(t, true)
    ]);
  }

  // linked: a score opens its tries (on screen); the PDF has plain scores.
  function scoreGrid(t, linked) {
    var students = {};
    var lessonIds = lessons.slice().reverse().map(function (l) { return l.id; });
    var lessonTitles = {};
    t.results.forEach(function (r) {
      var key = studentKey(r.student);
      if (!students[key]) students[key] = { name: r.student.trim(), byLesson: {} };
      var cell = students[key].byLesson[r.lessonId] || (students[key].byLesson[r.lessonId] = []);
      cell.push(r);
      if (lessonIds.indexOf(r.lessonId) === -1) lessonIds.push(r.lessonId);
      lessonTitles[r.lessonId] = r.lessonTitle;
    });
    var keys = Object.keys(students).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });

    var head = el("tr", null, [el("th", { scope: "col", text: "Student" })].concat(lessonIds.map(function (id) {
      var lesson = findLesson(id);
      return el("th", { scope: "col" }, [
        el("span", { class: "col-title", text: lesson ? lessonName(lesson) : lessonTitles[id] || id })
      ]);
    })));

    var body = el("tbody", null, keys.map(function (key) {
      var s = students[key];
      return el("tr", null, [el("th", { scope: "row", text: s.name })].concat(lessonIds.map(function (id) {
        var attempts = s.byLesson[id];
        if (!attempts) return el("td", { class: "empty", text: "–" });
        var best = attempts.reduce(function (a, b) {
          return b.score / b.total > a.score / a.total ? b : a;
        });
        var selected = linked && t.selected && t.selected.student === key && t.selected.lessonId === id;
        var inside = [
          el("span", { class: "cell-score", text: best.score + "/" + best.total }),
          el("span", { class: "cell-tries", text: attempts.length === 1 ? "1 try" : attempts.length + " tries" })
        ];
        var look = "cell " + scoreClass(best.score, best.total) + (selected ? " selected" : "");
        return el("td", null, [linked ? el("button", {
          type: "button",
          class: look,
          "aria-label": s.name + ": best " + best.score + " of " + best.total + ", " + attempts.length + " tries. Show details",
          onclick: function () {
            t.selected = selected ? null : { student: key, lessonId: id };
            render();
          }
        }, inside) : el("span", { class: look }, inside)]);
      })));
    }));

    return el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid" }, [el("thead", null, [head]), body])]);
  }

  function renderAttempts(t) {
    var sel = t.selected;
    var attempts = t.results.filter(function (r) {
      return studentKey(r.student) === sel.student && r.lessonId === sel.lessonId;
    }).sort(function (a, b) { return a.finishedAt < b.finishedAt ? 1 : -1; });
    if (!attempts.length) return null;
    var lesson = findLesson(sel.lessonId);
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: attempts[attempts.length - 1].student.trim() + " · " + (lesson ? lessonName(lesson) : attempts[0].lessonTitle) }),
      el("ul", { class: "attempts" }, attempts.map(function (r) {
        return el("li", null, [
          el("div", { class: "attempt-head" }, [
            el("strong", { class: "score-pill " + scoreClass(r.score, r.total), text: r.score + " / " + r.total }),
            el("span", { class: "muted", text: (r.quiz ? "Quiz " + r.quiz + " · " : "") + formatTime(r.finishedAt) })
          ]),
          r.missed ? el("p", { class: "attempt-missed", text: "Missed: " + r.missed }) : el("p", { class: "attempt-missed", text: "No mistakes." })
        ]);
      }))
    ]);
  }

  /* ---------- Recent activity ---------- */

  var ACTIVITY_KINDS = [
    { kind: "all", label: "All" },
    { kind: "signin", label: "Sign-ins" },
    { kind: "quiz", label: "Quizzes" },
    { kind: "practice", label: "Word of the day" },
    { kind: "live", label: "Live class" },
    { kind: "suggestion", label: "Suggestions" }
  ];

  // What students did, newest first: sign-ins (the first one is the Joined
  // date on the Students sheet), quizzes, Words of the day, live class joins
  // and suggestions.
  function activityItems(t) {
    var items = [];
    function add(kind, at, student, tag, detail, result) {
      var date = new Date(at);
      var name = String(student || "").trim();
      if (isNaN(date) || !name) return;
      items.push({ kind: kind, at: date, student: name, tag: tag, detail: detail, result: result || null });
    }
    t.students.forEach(function (s) {
      add("signin", s.joinedAt, s.name, "New student", "First sign-in" + (s.invitedBy ? " · invited by " + s.invitedBy.trim() : ""));
    });
    (t.signIns || []).forEach(function (s) { add("signin", s.at, s.student, "Signed in", ""); });
    t.results.forEach(function (r) {
      var lesson = findLesson(r.lessonId);
      add("quiz", r.finishedAt, r.student, "Quiz", (lesson ? lessonName(lesson) : r.lessonTitle) + (r.quiz ? " · quiz " + r.quiz : ""), r);
    });
    t.practice.forEach(function (p) { add("practice", p.at, p.student, "Word of the day", p.word); });
    // Each student once per class, when they first joined it (the rows come oldest first).
    var joined = {};
    var byEmail = studentEmails(t);
    (t.classes || []).forEach(function (c) {
      var name = byEmail[studentKey(c.student)] || c.student;
      var key = c.classId + "|" + studentKey(name);
      if (joined[key]) return;
      joined[key] = true;
      var lesson = findLesson(c.lessonId);
      add("live", c.at, name, "Live class", lesson ? lessonName(lesson) : c.lessonId);
    });
    (state.suggestions.items || []).forEach(function (s) {
      if (s.student === "Teacher") return; // the teacher's own notes
      var text = String(s.text || "").replace(/\s+/g, " ").trim();
      add("suggestion", s.at, s.student, "Suggestion", "“" + (text.length > 90 ? text.slice(0, 89).trim() + "…" : text) + "”");
    });
    return items.sort(function (a, b) { return b.at - a.at; });
  }

  // "Just now", "5 min ago", "Today, 14:05", "Yesterday, 09:12", or the date.
  function whenText(date) {
    var mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return mins + " min ago";
    var time = date.toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" });
    var today = new Date();
    if (dayKey(date) === dayKey(today)) return "Today, " + time;
    if (dayKey(date) === dayKey(addDays(today, -1))) return "Yesterday, " + time;
    return formatTime(date.toISOString());
  }

  // Each signed-in student's name by their email, for live class joins
  // saved with only an email.
  function studentEmails(t) {
    var names = {};
    t.students.forEach(function (s) { if (s.email) names[studentKey(s.email)] = String(s.name).trim(); });
    return names;
  }

  // Names with "test" in them are left out of the numbers.
  function isTestName(name) {
    return /test/i.test(name);
  }

  // Everyone who signed in, took a quiz, practised or joined a live class,
  // each once, without test names: { key: name }.
  function countedStudents(t) {
    var byEmail = studentEmails(t);
    var names = {};
    function add(name) {
      name = byEmail[studentKey(name)] || String(name || "").trim();
      var key = studentKey(name);
      if (key && !isTestName(name) && !names[key]) names[key] = name;
    }
    knownStudents(t).forEach(function (s) { add(s.name); });
    (t.classNames || (t.classes || []).map(function (c) { return c.student; })).forEach(add);
    return names;
  }

  // Each signed-in student's country, by name key: { country, code }. The
  // code, for the flag, needs the latest Google script.
  function studentPlaces(t) {
    var places = {};
    t.students.forEach(function (s) {
      if (s.country) places[studentKey(s.name)] = { country: s.country, code: s.countryCode || "" };
    });
    return places;
  }

  // A country's flag from its two-letter code, "IL" → 🇮🇱. Windows has no flag
  // emoji, so styles.css draws them with the Twemoji Country Flags font.
  function flagIcon(code) {
    if (!/^[A-Z]{2}$/.test(code || "")) return null;
    var flag = String.fromCodePoint(0x1F1E6 + code.charCodeAt(0) - 65, 0x1F1E6 + code.charCodeAt(1) - 65);
    return el("span", { class: "flag", "aria-hidden": "true", text: flag });
  }

  // The flag and the country, or nothing when the country isn't known.
  function countryLabel(place) {
    return place ? el("span", { class: "activity-country" }, [flagIcon(place.code), place.country]) : null;
  }

  // The four numbers, each with the names behind it, without test names.
  function activityNumbers(t, items) {
    var now = new Date();
    var today = dayKey(now);
    var weekAgo = now.getTime() - 7 * 86400000;
    var activeToday = {};
    var activeWeek = {};
    items.forEach(function (a) {
      if (isTestName(a.student)) return;
      var key = studentKey(a.student);
      if (a.at.getTime() >= weekAgo && !activeWeek[key]) activeWeek[key] = a.student;
      if (dayKey(a.at) === today && !activeToday[key]) activeToday[key] = a.student;
    });
    var joined = {};
    t.students.forEach(function (s) {
      var name = String(s.name).trim();
      if (!isTestName(name) && new Date(s.joinedAt).getTime() >= weekAgo) joined[studentKey(name)] = name;
    });
    return [
      { id: "total", names: countedStudents(t), one: "student in total", many: "students in total" },
      { id: "today", names: activeToday, one: "active today", many: "active today" },
      { id: "week", names: activeWeek, one: "active in the last 7 days", many: "active in the last 7 days" },
      { id: "new", names: joined, one: "new student in the last 7 days", many: "new students in the last 7 days" }
    ];
  }

  // The numbers as buttons; the one tapped lists its names underneath.
  function activityStats(t, items, places) {
    var numbers = activityNumbers(t, items);
    var open = numbers.filter(function (n) { return n.id === t.activityOpen; })[0];
    var nodes = [el("div", { class: "stats" }, numbers.map(function (n) {
      var count = Object.keys(n.names).length;
      var on = n === open;
      return el("button", {
        type: "button",
        class: "stat stat-button" + (on ? " active" : ""),
        "aria-expanded": on ? "true" : "false",
        "aria-controls": on ? "activity-names" : null,
        onclick: function () { t.activityOpen = on ? null : n.id; render(); }
      }, [
        el("span", { class: "stat-value", text: String(count) }),
        el("span", { class: "stat-label", text: count === 1 ? n.one : n.many })
      ]);
    }))];
    if (open) {
      var keys = Object.keys(open.names).sort(function (a, b) { return open.names[a].localeCompare(open.names[b]); });
      nodes.push(el("div", { class: "activity-names", id: "activity-names" }, [
        el("div", { class: "activity-names-head" }, [
          el("strong", { text: keys.length + " " + (keys.length === 1 ? open.one : open.many) }),
          el("button", { class: "btn", type: "button", text: "Close", onclick: function () { t.activityOpen = null; render(); } })
        ]),
        keys.length ? el("ul", { class: "name-list" }, keys.map(function (key) {
          return el("li", null, [el("span", { text: open.names[key] }), countryLabel(places[key])]);
        })) : el("p", { class: "hint", text: "No one yet." })
      ]));
    }
    return nodes;
  }

  function activityLine(a, places) {
    var iso = a.at.toISOString();
    return el("li", null, [
      el("span", { class: "recent-name" }, [
        a.student,
        countryLabel(places[studentKey(a.student)]),
        el("span", { class: "activity-tag" + (a.tag === "New student" ? " new" : ""), text: a.tag })
      ]),
      el("span", { class: "muted" }, [
        a.detail ? a.detail + " · " : null,
        el("time", { datetime: iso, title: formatTime(iso), text: whenText(a.at) })
      ]),
      a.result ? el("strong", { class: "score-pill " + scoreClass(a.result.score, a.result.total), text: a.result.score + " / " + a.result.total }) : null
    ]);
  }

  /* ---------- Invites ---------- */

  // Who brought whom with their Share link, for rewarding students who invite
  // friends. A friend is active once they've taken a quiz, practised the Word
  // of the day or joined a live class; test names are listed but not counted.
  function renderInvitesCard(t) {
    var head = [
      el("h2", { text: "Invites" }),
      el("p", { class: "hint", text: "Friends who signed up for the first time with a student's own link from the Share page. Active: took a quiz, practised the Word of the day or joined a live class. Names with “test” in them aren't counted." })
    ];
    // A Google script from before invites sends no invitedBy at all.
    if (t.students.length && !t.students.some(function (s) { return "invitedBy" in s; })) {
      return el("div", { class: "card dash-card" }, head.concat([el("p", { class: "notice", text: "To record invites, paste the new results-sheet/Code.gs into your Google script and deploy a new version (Deploy → Manage deployments → Edit → Version: New version)." })]));
    }
    var byEmail = studentEmails(t);
    var did = {};
    t.results.forEach(function (r) { did[studentKey(r.student)] = true; });
    t.practice.forEach(function (p) { did[studentKey(p.student)] = true; });
    (t.classNames || (t.classes || []).map(function (c) { return c.student; })).forEach(function (name) {
      did[studentKey(byEmail[studentKey(name)] || name)] = true;
    });
    var groups = {};
    t.students.forEach(function (s) {
      var inviter = String(s.invitedBy || "").trim();
      if (!inviter) return;
      var key = studentKey(inviter);
      var g = groups[key] || (groups[key] = { key: key, name: inviter, friends: [], joined: 0, active: 0 });
      var name = String(s.name).trim();
      var friend = { name: name, active: !!did[studentKey(name)], test: isTestName(name) };
      g.friends.push(friend);
      if (!friend.test) {
        g.joined += 1;
        if (friend.active) g.active += 1;
      }
    });
    var list = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
      return b.active - a.active || b.joined - a.joined || a.name.localeCompare(b.name);
    });
    if (!list.length) {
      return el("div", { class: "card dash-card" }, head.concat([el("p", { class: "notice", text: "No one has signed up with a classmate's link yet. Each student finds their own link on the Share page." })]));
    }
    var places = studentPlaces(t);
    return el("div", { class: "card dash-card" }, head.concat([
      el("ul", { class: "invite-list" }, list.map(function (g) {
        return el("li", null, [
          el("div", { class: "invite-head" }, [
            el("strong", { text: g.name }),
            countryLabel(places[g.key]),
            el("span", { class: "muted invite-count", text: g.joined + (g.joined === 1 ? " friend joined" : " friends joined") + " · " + g.active + " active" })
          ]),
          el("ul", { class: "invite-friends" }, g.friends.map(function (f) {
            return el("li", null, [
              f.name,
              el("span", {
                class: "activity-tag" + (f.active && !f.test ? " new" : ""),
                text: f.test ? "Test name, not counted" : f.active ? "Active" : "Not active yet"
              })
            ]);
          }))
        ]);
      }))
    ]));
  }

  // The class's numbers, then everything students did, newest first, with a
  // filter by kind and "Show more".
  function renderActivityCard(t) {
    var all = activityItems(t);
    var kind = t.activityKind;
    var items = kind === "all" ? all : all.filter(function (a) { return a.kind === kind; });
    var shown = items.slice(0, t.activityShown);
    var oldScript = t.signIns === null && (kind === "all" || kind === "signin" || kind === "live");
    var places = studentPlaces(t);
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "Recent activity" }),
      el("p", { class: "hint", text: "Students: everyone who has signed in, taken a quiz, practised or joined a live class; the numbers leave out names with “test” in them. Active: did any of those, or posted a suggestion. Tap a number to see the names. The list is newest first. Students stay signed in on their devices, so a sign-in shows only on a new device or after signing out." })
    ].concat(activityStats(t, all, places), [
      el("div", { class: "subtabs activity-filters", role: "group", "aria-label": "Show" }, ACTIVITY_KINDS.map(function (k) {
        var on = k.kind === kind;
        return el("button", {
          type: "button",
          class: "subtab activity-filter" + (on ? " active" : ""),
          "aria-pressed": on ? "true" : "false",
          text: k.label,
          onclick: function () { t.activityKind = k.kind; t.activityShown = ACTIVITY_PAGE; render(); }
        });
      })),
      oldScript ? el("p", { class: "notice", text: "Sign-ins after the first one, and live class joins, show here once you paste the new results-sheet/Code.gs into your Google script and deploy a new version (Deploy → Manage deployments → Edit → Version: New version)." }) : null,
      shown.length ? el("ul", { class: "recent activity-list" }, shown.map(function (a) { return activityLine(a, places); }))
        : el("p", { class: "notice", text: "Nothing here yet." }),
      items.length > shown.length ? el("button", {
        class: "btn",
        type: "button",
        text: "Show more",
        onclick: function () { t.activityShown += ACTIVITY_PAGE; render(); }
      }) : null
    ]));
  }

  /* ---------- New versions ---------- */

  // A page left open (a phone keeps its tabs for days) checks version.js each
  // time it comes back on screen, and reloads itself when there is a new one.
  var checkingVersion = false;

  function checkForNewVersion() {
    if (checkingVersion || !window.fetch || !/^https?:$/.test(location.protocol)) return; // not from file://
    checkingVersion = true;
    fetch("version.js?t=" + Date.now(), { cache: "no-store" })
      .then(function (response) { return response.ok ? response.text() : ""; })
      .then(function (text) {
        var match = /\.version\s*=\s*"([^"]+)"/.exec(text);
        var latest = match && match[1];
        if (!latest || latest === HC.version || busyOnPage()) return;
        // Once per version, so a server still handing out the old files can't keep reloading the page.
        if (readSession("hebrewClass.reloadedFor") === latest) return;
        writeSession("hebrewClass.reloadedFor", latest);
        return refreshFiles().then(function () { location.reload(); });
      })
      .catch(function () { /* offline: it tries again next time */ })
      .then(function () { checkingVersion = false; });
  }

  // In the middle of a quiz, or with something typed and not sent, it waits
  // for the next time instead of losing it.
  function busyOnPage() {
    if (state.quiz && !state.quiz.done) return true;
    return Array.prototype.some.call(document.querySelectorAll("#app input, #app textarea"), function (field) {
      return field.type !== "checkbox" && field.type !== "radio" && field.value !== field.defaultValue;
    });
  }

  // Downloads the page's files again first, or the reload could take the old
  // ones from the browser's cache (GitHub Pages lets it keep them 10 minutes).
  function refreshFiles() {
    var urls = [location.href.split("#")[0]];
    document.querySelectorAll("script[src], link[rel=stylesheet][href]").forEach(function (node) {
      var url = node.src || node.href;
      if (url.indexOf(location.origin + "/") === 0) urls.push(url);
    });
    return Promise.all(urls.map(function (url) {
      return fetch(url, { cache: "reload" }).then(function (response) { return response.text(); }).catch(function () {});
    }));
  }

  function readSession(key) {
    try { return sessionStorage.getItem(key); } catch (e) { return null; }
  }

  function writeSession(key, value) {
    try { sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  /* ---------- Start ---------- */

  // The Teacher page also reloads the suggestions, for Recent activity.
  setInterval(function () {
    if (onTeacherPage() && !document.hidden) { loadResults(); loadSuggestions(); }
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) return;
    keepTick(); // a phone may have held its timers back
    checkForNewVersion();
    sendPlace(); // only when the time zone has changed
    if (onTeacherPage()) { loadResults(); loadSuggestions(); }
  });
  // Back on the page from the browser's back and forward cache.
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) checkForNewVersion();
  });

  window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("resize", scalePage);
  // A lesson list closes with a click elsewhere or Escape.
  document.addEventListener("click", function (e) {
    if (!(e.target.closest && e.target.closest(".subtab-picker, .lesson-menu"))) closeLessonMenus();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var opener = closeLessonMenus();
      if (opener) { opener.focus(); return; }
    }
    if (document.querySelector(".lesson-menu:not([hidden])")) return; // arrows don't turn cards behind an open list
    if (keep.box && keep.box.open) return; // or behind Still teaching?
    if (state.route.view !== "lesson" || (state.route.tab !== "cards" && state.route.tab !== "live")) return;
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var move = state.route.tab === "live" ? moveLive : moveCard;
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  });
  window.addEventListener("beforeprint", fitSheet);

  document.addEventListener("DOMContentLoaded", function () {
    keepInvite();
    loadLessons(function () {
      lessons.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      state.route = parseHash();
      rememberLesson();
      loadForRoute();
      render();
      startLivePolling();
      sendPlace();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSheet);
    });
  });
})();
