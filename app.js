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

  // Vowel points and other marks, but not maqaf (U+05BE) or sof pasuq (U+05C3).
  var NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

  var lessons = [];

  var signedInStudent = readStudent();

  var state = {
    route: { view: "home" },
    niqqud: readSetting("hebrewClass.niqqud", "1") !== "0",
    student: signedInStudent,          // { name, token } once signed in; token is empty without a PIN
    studentName: signedInStudent ? signedInStudent.name : "",
    auth: { busy: false, error: "" },
    quiz: null,       // the quiz being taken; null shows the list of quizzes
    quizDone: {},     // best score per "lessonId|quiz number" since the page was opened
    cards: null,
    wotd: null,
    say: { text: "", busy: false, error: "", result: null, listening: false },
    suggestions: { items: null, loading: false, error: "", sending: false, sendError: "", saving: "" },
    report: { data: null, loading: false, error: "" },
    loadErrors: [],
    teacher: {
      passcode: readSetting("hebrewClass.teacherPasscode", ""),
      results: null,
      practice: [],
      students: [],
      loading: false,
      error: "",
      updatedAt: null,
      selected: null,
      week: 0,        // 0 is this week, -1 last week…
      report: null    // the student whose full report is open
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
  function normalizeLesson(raw) {
    var forms = [];
    var sections = (raw.sections || []).map(function (section, si) {
      return {
        title: section.title,
        explanation: section.explanation || "",
        rows: (section.rows || []).map(function (r, ri) {
          var row = { id: si + "-" + ri, en: r[0], forms: [] };
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
      name: raw.title || "Untitled lesson", // becomes "Lesson N – title" once every lesson has loaded
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
            lesson.name = "Lesson " + lesson.number + " – " + lesson.title;
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
    var message = "Couldn't play the sound. Check your internet connection and volume, or open the site in Microsoft Edge or on a phone.";
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

  function speakerIcon() {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    [
      "M4 9h4l5-4v14l-5-4H4z",
      "M16 8.5a4.5 4.5 0 0 1 0 7",
      "M18.5 6a8 8 0 0 1 0 12"
    ].forEach(function (d, i) {
      var p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      if (i === 0) p.setAttribute("class", "fill");
      svg.appendChild(p);
    });
    return svg;
  }

  // texts: one Hebrew string, or several (male and female forms) read one after another.
  function speakButton(texts, extraClass) {
    var btn = el("button", {
      class: "speak-btn no-print" + (extraClass ? " " + extraClass : ""),
      type: "button",
      title: "Listen",
      "aria-label": "Listen to the Hebrew",
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
    return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  }

  // English prompt for one form, making the gender explicit.
  function promptFor(form) {
    var en = form.row.en;
    if (!form.g) return en;
    if (/\(to m\/f\)/.test(en)) return en.replace(/\(to m\/f\)/, form.g === "m" ? "(to a man)" : "(to a woman)");
    if (/\(m\/f\)/.test(en)) return en.replace(/\(m\/f\)/, form.g === "m" ? "(male)" : "(female)");
    return en + (form.g === "m" ? " (male)" : " (female)");
  }

  function lessonUrl(lesson, tab) {
    return "#/lesson/" + encodeURIComponent(lesson.id) + (tab === "quiz" || tab === "cards" || tab === "live" ? "/" + tab : "");
  }

  /* ---------- Routing ---------- */

  function parseHash() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    if (parts[0] === "teacher") return { view: "teacher" };
    if (parts[0] === "study") return { view: "study", tab: parts[1] === "say" ? "say" : "word" };
    if (parts[0] === "suggestions") return { view: "suggestions" };
    if (parts[0] === "progress") return { view: "progress" };
    if (parts[0] === "lesson" && parts[1]) {
      return {
        view: "lesson",
        lessonId: decodeURIComponent(parts[1]),
        tab: parts[2] === "quiz" || parts[2] === "cards" || parts[2] === "live" ? parts[2] : "sheet"
      };
    }
    return { view: "home" };
  }

  function onRouteChange() {
    state.route = parseHash();
    if (state.quiz && state.quiz.lessonId !== state.route.lessonId) state.quiz = null;
    if (state.cards && state.cards.lessonId !== state.route.lessonId) state.cards = null;
    stopListening();
    loadForRoute();
    render();
    window.scrollTo(0, 0);
    startLivePolling();
  }

  // Fetch what the current page shows.
  function loadForRoute() {
    var view = state.route.view;
    if (view === "teacher") { loadResults(); loadSuggestions(); }
    if (!signedIn()) return;
    if (view === "suggestions") loadSuggestions();
    if (view === "progress") {
      if (isTeacher()) loadResults(); else loadReport();
    }
    // The list of quizzes shows the student's best score on each.
    if (onQuizTab() && !state.report.data) loadReport();
  }

  /* ---------- Rendering ---------- */

  var PAGE_TITLES = { teacher: "Teacher dashboard", study: "Self study", suggestions: "Suggestions box", progress: "My progress" };

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
    else app.appendChild(renderHome());
    var title = lesson ? lesson.name : PAGE_TITLES[view];
    document.title = (title ? title + " · " : "") + "Hebrew Class";
    fitSheet();
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
    writeSetting("hebrewClass.studentName", name);
    state.report.data = null;
    state.wotd = null;
  }

  function signOut() {
    state.student = null;
    state.studentName = "";
    writeSetting("hebrewClass.student", "");
    state.report = { data: null, loading: false, error: "" };
    state.quiz = null;
    state.wotd = null;
    var t = state.teacher;
    t.passcode = "";
    t.results = null;
    t.updatedAt = null;
    t.selected = null;
    t.report = null;
    t.error = "";
    writeSetting("hebrewClass.teacherPasscode", "");
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    else render();
  }

  var SIGN_IN_ERRORS = {
    "bad-name": "Please enter your name.",
    "bad-pin": "A PIN is 4 to 8 digits.",
    "bad-email": "That email doesn't look right. You can also leave it empty.",
    "pin-needed": "This name is protected by a PIN. Enter the PIN to sign in.",
    "wrong-pin": "That PIN isn't right. Try again, or ask your teacher to reset it.",
    "too-many-tries": "Too many wrong PINs. Wait 10 minutes and try again, or ask your teacher to reset it."
  };

  function signInStudent(name, pin, email) {
    var auth = state.auth;
    function done(error) {
      auth.busy = false;
      auth.error = error || "";
      if (!error) loadForRoute();
      render();
    }
    if (!config.resultsUrl) { setStudent(name, ""); done(); return; }
    auth.busy = true;
    auth.error = "";
    render();
    callBackend({ action: "signIn", name: name, pin: pin, email: email }).then(function (res) {
      if (res && res.ok) {
        setStudent(res.name || name, res.token);
        done();
      } else if (res && res.error === "bad-request") {
        // A Google script from before sign-in existed: carry on with the name alone.
        setStudent(name, "");
        done();
      } else {
        done(SIGN_IN_ERRORS[res && res.error] || "Couldn't sign you in. Try again.");
      }
    }, function () {
      done("Couldn't reach the class service. Check your connection and try again.");
    });
  }

  function renderSignIn() {
    var auth = state.auth;
    var t = state.teacher;
    var nameInput = el("input", { type: "text", id: "signin-name", required: true, maxlength: "60", autocomplete: "name", value: readSetting("hebrewClass.studentName", "") });
    var emailInput = el("input", { type: "email", id: "signin-email", maxlength: "120", autocomplete: "email", value: readSetting("hebrewClass.liveEmail", "") });
    var pinInput = el("input", { type: "password", id: "signin-pin", inputmode: "numeric", pattern: "[0-9]{4,8}", maxlength: "8", autocomplete: "off", title: "4 to 8 digits" });
    var passInput = el("input", { type: "password", id: "signin-passcode", required: true, autocomplete: "current-password" });

    return el("section", { class: "signin" }, [
      el("h1", { text: "Welcome to Hebrew Class" }),
      el("p", { class: "lede", text: "Sign in with your name to see the lessons and keep track of your progress." }),
      el("form", {
        class: "card",
        onsubmit: function (e) {
          e.preventDefault();
          var name = nameInput.value.trim().replace(/\s+/g, " ");
          if (name && !auth.busy) {
            var email = emailInput.value.trim();
            writeSetting("hebrewClass.studentName", name);
            writeSetting("hebrewClass.liveEmail", email);
            live.email = email;
            signInStudent(name, pinInput.value.trim(), email);
          }
        }
      }, [
        el("div", { class: "field" }, [
          el("label", { for: "signin-name", text: "Your name" }),
          nameInput,
          el("span", { class: "field-hint", text: "Use the same name every time." })
        ]),
        el("div", { class: "field" }, [
          el("label", { for: "signin-email", text: "Email (optional)" }),
          emailInput,
          el("span", { class: "field-hint", text: "Only your teacher sees it." })
        ]),
        el("div", { class: "field" }, [
          el("label", { for: "signin-pin", text: "PIN (optional)" }),
          pinInput,
          el("span", { class: "field-hint", text: "Choose 4 digits and only you can see your progress report. You'll need it to sign in again." })
        ]),
        auth.error ? el("p", { class: "notice error", role: "alert", text: auth.error }) : null,
        el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", disabled: auth.busy, text: auth.busy ? "Signing in…" : "Sign in" })])
      ]),
      config.resultsUrl ? el("details", { class: "teacher-signin", open: !!t.error }, [
        el("summary", { text: "Teacher? Sign in here" }),
        t.error ? el("p", { class: "notice error", role: "alert", text: t.error }) : null,
        el("form", {
          onsubmit: function (e) {
            e.preventDefault();
            var code = passInput.value.trim();
            if (code) signInTeacher(code);
          }
        }, [
          el("div", { class: "field" }, [el("label", { for: "signin-passcode", text: "Teacher passcode" }), passInput]),
          el("button", { class: "btn", type: "submit", text: "Sign in as teacher" })
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
    // On this computer the site talks to the test copy of the sheet; say so.
    if (config.testing) user.appendChild(el("span", { class: "test-badge", title: "Using the test copy of the Google Sheet", text: "Test data" }));
    var view = state.route.view;
    function link(href, text, active) {
      return el("a", { class: "mainnav-link" + (active ? " active" : ""), href: href, "aria-current": active ? "page" : null, text: text });
    }
    if (!signedIn()) {
      user.appendChild(el("a", { class: "topnav-out", href: "#/teacher", text: "Teacher" }));
      return;
    }
    var inStudy = view === "study" || (view === "lesson" && (state.route.tab === "cards" || state.route.tab === "quiz"));
    nav.appendChild(el("div", { class: "mainnav-inner" }, [
      link("#/", "Lessons", view === "home" || (view === "lesson" && !inStudy)),
      link("#/study", "Self study", inStudy),
      link("#/suggestions", "Suggestions", view === "suggestions"),
      isTeacher()
        ? link("#/teacher", "Teacher", view === "teacher" || view === "progress")
        : link("#/progress", "My progress", view === "progress")
    ]));
    if (!isTeacher()) user.appendChild(el("span", { class: "topnav-name", text: state.student.name }));
    user.appendChild(el("button", { class: "topnav-out", type: "button", text: "Sign out", onclick: signOut }));
  }

  function renderHome() {
    var wrap = el("section", null, [
      el("h1", { text: "Weekly lessons" }),
      el("p", { class: "lede", text: "Open a lesson to print its one-page sheet or take the quiz." })
    ]);
    if (state.loadErrors.length) {
      wrap.appendChild(el("p", { class: "notice error", text: "Some lessons could not be loaded: " + state.loadErrors.join(", ") }));
    }
    if (!lessons.length) {
      wrap.appendChild(el("p", { class: "notice", text: "No lessons yet." }));
      return wrap;
    }
    var list = el("ul", { class: "lesson-list" });
    lessons.forEach(function (lesson, i) {
      list.appendChild(el("li", null, [
        el("a", { class: "lesson-card", href: lessonUrl(lesson, "sheet") }, [
          el("span", { class: "lesson-date", text: formatDate(lesson.date) + (i === 0 ? " · Latest" : "") }),
          el("span", { class: "lesson-title", text: lesson.name }),
          el("span", { class: "lesson-meta", text: lesson.sections.reduce(function (n, sec) { return n + sec.rows.length; }, 0) + " phrases in " + lesson.sections.length + " sections" })
        ])
      ]));
    });
    wrap.appendChild(list);
    return wrap;
  }

  function renderNotFound() {
    return el("section", null, [
      el("a", { class: "back", href: "#/", text: "← All lessons" }),
      el("h1", { text: "Lesson not found" }),
      el("p", { class: "lede", text: "This link may be out of date. Pick a lesson from the list." })
    ]);
  }

  function renderLesson(lesson) {
    var tab = state.route.tab;
    var study = tab === "cards" || tab === "quiz";
    var head = el("div", { class: "lesson-head no-print" }, [
      el("a", { class: "back", href: "#/", text: "← All lessons" }),
      el("h1", { text: lesson.name }),
      el("p", { class: "lesson-date", text: formatDate(lesson.date) }),
      lesson.video ? el("p", { class: "lesson-video" }, [
        "Video: ",
        el("a", { href: lesson.video, target: "_blank", rel: "noopener", text: lesson.videoTitle || lesson.video })
      ]) : null,
      el("nav", { class: "tabs", "aria-label": "Lesson" }, [
        el("a", { class: "tab" + (tab === "sheet" ? " active" : ""), href: lessonUrl(lesson, "sheet"), "aria-current": tab === "sheet" ? "page" : null, text: "Lesson sheet" }),
        el("a", { class: "tab" + (study ? " active" : ""), href: lessonUrl(lesson, "cards"), "aria-current": study ? "page" : null, text: "Self study" }),
        el("a", { class: "tab" + (tab === "live" ? " active" : ""), href: lessonUrl(lesson, "live"), "aria-current": tab === "live" ? "page" : null }, [
          liveDot(),
          "Live class"
        ])
      ])
    ]);
    var body = tab === "quiz" ? renderQuiz(lesson) : tab === "cards" ? renderCards(lesson) : tab === "live" ? renderLive(lesson) : renderSheetTab(lesson);
    return el("section", null, [head, study ? studyNav(tab, lesson) : null, body]);
  }

  // The Self study menu. Word by word and the Quiz belong to a lesson: the one
  // that is open, or the latest one.
  function studyNav(active, lesson) {
    lesson = lesson || lessons[0];
    function item(key, href, text) {
      return el("a", { class: "subtab" + (active === key ? " active" : ""), href: href, "aria-current": active === key ? "page" : null, text: text });
    }
    return el("nav", { class: "subtabs no-print", "aria-label": "Self study" }, [
      lesson ? item("cards", lessonUrl(lesson, "cards"), "Word by word") : null,
      lesson ? item("quiz", lessonUrl(lesson, "quiz"), "Quiz") : null,
      item("word", "#/study/word", "Word of the day"),
      item("say", "#/study/say", "How to say")
    ]);
  }

  function niqqudToggle() {
    return el("label", { class: "toggle" }, [
      el("input", {
        type: "checkbox",
        checked: state.niqqud,
        onchange: function (e) {
          state.niqqud = e.target.checked;
          writeSetting("hebrewClass.niqqud", state.niqqud ? "1" : "0");
          render();
        }
      }),
      "Show vowel marks (niqqud)"
    ]);
  }

  /* ---------- Lesson sheet ---------- */

  function renderSheetTab(lesson) {
    var toolbar = el("div", { class: "toolbar no-print" }, [
      niqqudToggle(),
      el("button", { class: "btn primary", type: "button", onclick: function () { window.print(); }, text: "Print or save as PDF" })
    ]);
    var hint = el("p", { class: "hint no-print", text: "To download the sheet, press Print and choose “Save as PDF” as the printer." });
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
        el("td", { colspan: "3", text: (si + 1) + ". " + section.title })
      ]));
      if (section.explanation) {
        tbody.appendChild(el("tr", { class: "explain" }, [
          el("td", { colspan: "3", text: heb(section.explanation) })
        ]));
      }
      section.rows.forEach(function (row) {
        tbody.appendChild(el("tr", null, [
          el("td", { text: row.en }),
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
        el("th", { text: "English" }),
        el("th", { text: "Transliteration" }),
        el("th", { class: "he" }, ["Hebrew ", el("span", { lang: "he", dir: "rtl", text: heb("עִבְרִית") })])
      ])]),
      tbody
    ]);

    var first = pageNo === 1;
    var last = pageNo === pageCount;
    var pageLabel = pageCount > 1 ? "Page " + pageNo + " of " + pageCount : "";
    return el("div", { class: "sheet" }, [
      first ? el("h2", { class: "sheet-title", text: lesson.title }) : null,
      el("p", { class: "sheet-subtitle", text: (first
        ? [lesson.subtitle, formatDate(lesson.date), pageLabel]
        : [lesson.title, pageLabel]).filter(Boolean).join(" · ") }),
      table,
      last && lesson.notes ? el("p", { class: "sheet-notes" }, [el("strong", { text: "Notes: " }), lesson.notes]) : null,
      last && lesson.video ? el("p", { class: "sheet-notes" }, [
        el("strong", { text: "Video: " }),
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
        title: speakable ? "Click to listen" : null,
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
    var toSomeone = /\(to m\/f\)/.test(row.en);
    if (g === "m") return toSomeone ? "To a man" : "Male";
    return toSomeone ? "To a woman" : "Female";
  }

  function renderCards(lesson) {
    var list = cardList(lesson);
    if (!state.cards) state.cards = { lessonId: lesson.id, index: 0 };
    var c = state.cards;
    c.count = list.length;
    if (!list.length) return el("p", { class: "notice", text: "This lesson has no phrases yet." });
    if (c.index >= list.length) c.index = list.length - 1;
    var first = c.index === 0;
    var last = c.index === list.length - 1;
    var card = wordCard(list[c.index]);
    addSwipe(card);

    var pct = Math.round(((c.index + 1) / list.length) * 100);
    var nav = el("div", { class: "card-nav" }, [
      el("button", { class: "btn", type: "button", disabled: first, onclick: function () { moveCard(-1); }, text: "← Previous" }),
      el("span", { class: "card-count", "aria-live": "polite", text: (c.index + 1) + " / " + list.length }),
      last
        ? el("button", { class: "btn primary", type: "button", onclick: function () { c.index = 0; render(); }, text: "Start over" })
        : el("button", { class: "btn primary", type: "button", onclick: function () { moveCard(1); }, text: "Next word →" })
    ]);

    return el("div", { class: "cards-view" }, [
      el("div", { class: "toolbar no-print", style: "margin-bottom:16px" }, [niqqudToggle()]),
      el("div", { class: "progress-bar", "aria-hidden": "true" }, [el("span", { style: "width:" + pct + "%" })]),
      card,
      nav,
      el("p", { class: "hint card-hint", text: "Tip: use the ← → arrow keys to move between words." })
    ]);
  }

  // One phrase as a big card: section at the top, then English, then Hebrew
  // (both forms when there are two) with transliteration.
  function wordCard(item) {
    return el("div", { class: "card word-card" }, [
      el("p", { class: "card-section", text: item.sectionNo + ". " + item.section.title }),
      item.section.explanation ? el("p", { class: "card-explain", text: heb(item.section.explanation) }) : null,
      cardBody(item.row)
    ]);
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

    return el("div", { class: "card-body" }, [
      el("p", { class: "card-en", text: row.en.replace(/\s*\((to )?m\/f\)/, "") }),
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
    return el("div", null, [el("div", { class: "toolbar no-print", style: "margin-bottom:16px" }, [niqqudToggle()]), body]);
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
    if (!plan.length) return el("p", { class: "notice", text: "This lesson has no phrases yet." });
    var best = quizBests(lesson);
    var saving = !!config.resultsUrl && !!state.student;
    var top = null;
    Object.keys(best).forEach(function (n) {
      if (!top || best[n].score / best[n].total > top.score / top.total) top = best[n];
    });
    var intro = (plan.length === 1 ? "One short quiz" : plan.length + " short quizzes, each on different phrases")
      + ": multiple choice, then a matching round that counts as one question. Take them in any order, as often as you like."
      + (saving ? " Your highest score is the one that counts for this lesson." : "");
    return el("div", { class: "card" }, [
      el("h2", { text: "Quiz: " + lesson.name, style: "margin-top:0" }),
      el("p", { text: intro }),
      top ? el("p", { class: "quiz-best" }, [
        "Your highest score for this lesson: ",
        el("strong", { class: "score-pill " + scoreClass(top.score, top.total), text: top.score + " / " + top.total })
      ]) : null,
      state.student ? null : el("p", { class: "hint", text: "You're signed in as the teacher, so your scores won't be saved." }),
      el("div", { class: "quiz-picks" }, plan.map(function (part, i) {
        var number = i + 1;
        var mine = best[number];
        return el("button", {
          class: "quiz-pick",
          type: "button",
          onclick: function () { state.quiz = buildQuiz(lesson, number); render(); }
        }, [
          el("span", { class: "quiz-pick-name", text: "Quiz " + number }),
          el("span", { class: "quiz-pick-meta", text: (part.choice.length + (part.match.length ? 1 : 0)) + " questions" }),
          mine
            ? el("span", { class: "score-pill " + scoreClass(mine.score, mine.total), text: "Best " + mine.score + " / " + mine.total })
            : el("span", { class: "quiz-pick-meta", text: "Not taken yet" })
        ]);
      }))
    ]);
  }

  function renderProgress(quiz) {
    var pct = Math.round((quiz.index / quiz.items.length) * 100);
    return [
      el("p", { class: "quiz-progress", text: "Quiz " + quiz.number + " · Question " + (quiz.index + 1) + " of " + quiz.items.length + " · Score " + quiz.score }),
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
          onclick: function () { answerChoice(quiz, item, opt); },
          text: heb(opt.he)
        }),
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
        right ? "Correct! " : "Not quite. The answer is ",
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
        onclick: function () { pickMatch(quiz, round, "he", i); },
        text: heb(round.pairs[i].form.he)
      });
    }));
    var children = renderProgress(quiz).concat([
      el("p", { class: "prompt", text: "Match each English phrase to its Hebrew." }),
      el("p", { class: "hint", style: "margin-top:-12px", text: "This round is one question: match them all without a wrong pairing to get the point." }),
      el("div", { class: "match-grid" }, [enCol, heCol])
    ]);
    if (done) {
      var clean = round.pairs.every(function (p) { return !p.wrong; });
      children.push(el("p", { class: "feedback " + (clean ? "good" : "bad"), text: clean ? "All matched, with no mistakes!" : "All matched, but with a wrong pairing on the way, so no point this time." }));
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
        text: last ? "See my score" : "Next",
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
      missed: quiz.missed.map(function (f) { return promptFor(f) + " = " + plain(f.he); }).join("; "),
      finishedAt: new Date().toISOString()
    };
    callBackend(payload).then(function (res) {
      quiz.sendStatus = res && res.ok ? "sent" : "failed";
    }, function () {
      quiz.sendStatus = "failed";
    }).then(function () {
      if (state.quiz === quiz) render();
    });
  }

  function renderQuizResults(lesson, quiz) {
    var pct = quiz.total ? Math.round((quiz.score / quiz.total) * 100) : 0;
    var message = pct === 100 ? "Perfect! מְצוּיָן" : pct >= 80 ? "Great work!" : pct >= 50 ? "Good effort. Review the phrases below and try again." : "Keep practising with the lesson sheet, then try again.";
    var children = [
      el("p", { class: "quiz-progress", text: "Quiz " + quiz.number + " · Your score" }),
      el("p", { class: "score", text: quiz.score + " / " + quiz.total }),
      el("p", { text: message })
    ];
    if (quiz.missed.length) {
      children.push(el("div", { class: "missed" }, [
        el("h3", { text: "Phrases to review" }),
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
        sending: "Saving your score…",
        sent: "Your score was saved in your progress report.",
        failed: "Your score could not be saved. Check your connection and take the quiz again, or tell your teacher."
      }[quiz.sendStatus];
      children.push(el("p", { class: "send-status" + (quiz.sendStatus === "failed" ? " bad" : ""), text: statusText }));
    }
    children.push(el("div", { class: "actions" }, [
      el("button", {
        class: "btn primary",
        type: "button",
        text: quizPlan(lesson).length > 1 ? "Choose another quiz" : "Done",
        onclick: function () { state.quiz = null; render(); }
      }),
      el("button", {
        class: "btn",
        type: "button",
        text: "Try this one again",
        onclick: function () { state.quiz = buildQuiz(lesson, quiz.number); render(); }
      }),
      el("a", { class: "btn", href: lessonUrl(lesson, "sheet"), text: "Back to the lesson sheet" })
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
    if (error === "bad-request") return NOT_SWITCHED_ON;
    if (error === "sign-in") return "This name is protected by a PIN. Sign out, then sign in again with the PIN.";
    if (error === "wrong-passcode") return "The teacher passcode didn't work. Sign out and sign in again.";
    return fallback;
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
    dailyWords = normalizeLesson({ id: "daily-words", title: "Word of the day", sections: sections });
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
      el("h1", { text: "Self study" }),
      el("p", { class: "lede", text: "Practise on your own, a few minutes at a time." }),
      studyNav(tab, null),
      tab === "say" ? renderSay() : renderWordOfDay()
    ]);
  }

  function renderWordOfDay() {
    var day = dayKey(new Date());
    if (!state.wotd || state.wotd.day !== day) {
      var entry = wordOfDay(day);
      state.wotd = entry && {
        day: day,
        row: entry.row,
        topic: entry.section.title,
        form: entry.row.forms[0],
        step: "learn",
        options: null,
        picked: null,
        done: readSetting("hebrewClass.wotdDone", "") === practisedKey(day),
        saved: ""
      };
    }
    var w = state.wotd;
    if (!w) return el("p", { class: "notice", text: "There is no word of the day yet." });
    var toolbar = el("div", { class: "toolbar no-print", style: "margin-bottom:16px" }, [niqqudToggle()]);
    return el("div", { class: "cards-view" }, [toolbar, w.step === "ask" ? renderWordCheck(w) : renderWordLearn(w)]);
  }

  function renderWordLearn(w) {
    var savedText = {
      saving: "Saving…",
      saved: "Saved in your progress report.",
      failed: "Couldn't save this in your progress report. Check your connection and practise again.",
      off: NOT_SWITCHED_ON,
      pin: backendMessage({ error: "sign-in" })
    }[w.saved];
    return el("div", null, [
      el("div", { class: "card word-card wotd-card" }, [
        el("p", { class: "card-section", text: "Word of the day · " + formatDate(w.day) }),
        cardBody(w.row),
        el("span", { class: "card-gender", text: w.topic })
      ]),
      w.done ? el("p", { class: "notice good", role: "status", text: "Practised today. Come back tomorrow for a new word." }) : null,
      savedText ? el("p", { class: "send-status" + (w.saved === "saving" || w.saved === "saved" ? "" : " bad"), text: savedText }) : null,
      !state.student ? el("p", { class: "hint", text: "You're signed in as the teacher, so your practice isn't recorded." }) : null,
      el("div", { class: "actions wotd-actions" }, [
        el("button", {
          class: "btn" + (w.done ? "" : " primary"),
          type: "button",
          text: w.done ? "Practise again" : "Practise this word",
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
    var options = el("div", { class: "options" }, w.options.map(function (opt) {
      return el("button", {
        class: "option" + (wrong && opt === w.picked ? " wrong" : ""),
        type: "button",
        lang: "he",
        dir: "rtl",
        disabled: wrong,
        onclick: function () { answerWord(w, opt); },
        text: heb(opt.he)
      });
    }));
    return el("div", { class: "card" }, [
      el("p", { class: "quiz-progress", text: "Word of the day · Which one is it?" }),
      el("p", { class: "prompt", text: promptFor(w.form) }),
      options,
      wrong ? el("p", { class: "feedback bad", role: "status", text: "Not quite. Look at the word again, then try once more." }) : null,
      wrong ? el("div", { class: "actions" }, [
        el("button", { class: "btn primary", type: "button", text: "See the word again", onclick: function () { w.step = "learn"; render(); } })
      ]) : null
    ]);
  }

  function answerWord(w, opt) {
    w.picked = opt;
    if (opt !== w.form) { render(); return; }
    w.step = "learn";
    w.done = true;
    writeSetting("hebrewClass.wotdDone", practisedKey(w.day));
    if (state.student && config.resultsUrl) {
      w.saved = "saving";
      state.report.data = null;
      callBackend(asStudent({ action: "practice", day: w.day, word: w.row.en })).then(function (res) {
        w.saved = res && res.ok ? "saved" : res && res.error === "bad-request" ? "off" : res && res.error === "sign-in" ? "pin" : "failed";
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
    if (!config.resultsUrl) return el("p", { class: "notice", text: NOT_CONNECTED });
    var input = el("input", {
      type: "text",
      id: "say-text",
      required: true,
      maxlength: String(SAY_MAX),
      autocomplete: "off",
      placeholder: "For example: Where is the bus stop?",
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
        el("label", { for: "say-text", text: "A word or short phrase in English" }),
        input
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "btn primary", type: "submit", disabled: say.busy, text: say.busy ? "Translating…" : "Translate to Hebrew" }),
        Recognition ? el("button", {
          class: "btn" + (say.listening ? " listening" : ""),
          type: "button",
          disabled: say.busy,
          "aria-pressed": say.listening ? "true" : "false",
          onclick: function () { if (say.listening) stopListening(); else startListening(); },
          text: say.listening ? "Listening… tap to stop" : "Say it instead"
        }) : null
      ]),
      Recognition ? null : el("p", { class: "hint", text: "To say the phrase instead of typing it, open the site in Chrome, Edge or Safari." }),
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
      el("p", { class: "hint", text: "This is Google's automatic translation, without vowel marks. It may pick the male or the female form, and it can be wrong, so check with your teacher. What you type is sent to Google to be translated." })
    ]);
  }

  function translatePhrase(text) {
    var say = state.say;
    text = String(text || "").trim().replace(/\s+/g, " ").slice(0, SAY_MAX);
    if (!text || say.busy) return;
    say.text = text;
    say.busy = true;
    say.error = "";
    render();
    callBackend({ action: "translate", text: text }).then(function (res) {
      if (res && res.ok && res.hebrew) say.result = { text: res.text || text, hebrew: res.hebrew };
      else say.error = backendMessage(res, "Couldn't translate that. Try again in a moment.");
    }, function () {
      say.error = "Couldn't reach the translator. Check your connection and try again.";
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
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      heard = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
    };
    rec.onerror = function (e) {
      say.error = e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "The microphone is blocked. Allow it for this site in your browser, or type the phrase."
        : e.error === "no-speech" ? "Didn't hear anything. Try again, or type the phrase."
        : e.error === "aborted" ? ""
        : "Couldn't hear that. Try again, or type the phrase.";
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
      say.error = "Couldn't start the microphone. Type the phrase instead.";
    }
    // A short phrase only: stop by itself after a few seconds.
    setTimeout(function () { if (recognition === rec) rec.stop(); }, LISTEN_MS);
    render();
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
      box.error = "Couldn't reach the suggestions box. Check your connection.";
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
      box.sendError = "Couldn't send your suggestion. Check your connection and try again.";
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
      box.sendError = "Couldn't save your response. Check your connection and try again.";
    }).then(function () {
      box.saving = "";
      if (state.route.view === "suggestions") render();
    });
  }

  function renderSuggestions() {
    var box = state.suggestions;
    var wrap = el("section", null, [
      el("h1", { text: "Suggestions box" }),
      el("p", { class: "lede", text: "Ideas to improve this site, or topics you'd like in a lesson. Everyone in the class can read the suggestions and the teacher's responses." })
    ]);
    if (!config.resultsUrl) {
      wrap.appendChild(el("p", { class: "notice", text: NOT_CONNECTED }));
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
      el("div", { class: "field wide" }, [el("label", { for: "suggestion-text", text: "Your suggestion" }), textarea]),
      box.sendError ? el("p", { class: "notice error", role: "alert", text: box.sendError }) : null,
      el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", disabled: box.sending, text: box.sending ? "Sending…" : "Submit" })])
    ]));

    wrap.appendChild(el("h2", { class: "list-title", text: "Suggestions so far" }));
    if (box.error) wrap.appendChild(el("p", { class: "notice error", text: box.error }));
    if (!box.items) {
      if (!box.error) wrap.appendChild(el("p", { class: "notice", text: "Loading the suggestions…" }));
      return wrap;
    }
    if (!box.items.length) {
      wrap.appendChild(el("p", { class: "notice", text: "No suggestions yet. Yours can be the first." }));
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
        el("div", { class: "field wide" }, [el("label", { for: id, text: "Your response" + (item.respondedAt ? " · " + formatTime(item.respondedAt) : "") }), textarea]),
        el("button", { class: "btn", type: "submit", disabled: !!box.saving, text: box.saving === item.id ? "Saving…" : item.response ? "Update response" : "Save response" })
      ]));
    } else if (item.response) {
      children.push(el("div", { class: "response" }, [
        el("p", { class: "suggestion-head" }, [
          el("strong", { text: "Teacher's response" }),
          item.respondedAt ? el("span", { class: "muted", text: formatTime(item.respondedAt) }) : null
        ]),
        el("p", { class: "suggestion-text", text: item.response })
      ]));
    } else {
      children.push(el("p", { class: "muted response-none", text: "No response yet." }));
    }
    return el("li", { class: "card suggestion" }, children);
  }

  /* ---------- Progress reports ---------- */

  var WEEKS_SHOWN = 26;
  var DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  // Weeks run Sunday to Saturday.
  function weekStart(date) {
    return addDays(date, -date.getDay());
  }

  function weekLabel(start) {
    var opts = { day: "numeric", month: "short" };
    return start.toLocaleDateString(undefined, opts) + " – " + addDays(start, 6).toLocaleDateString(undefined, opts);
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
    practice.forEach(function (p) {
      var d = parseDay(p.day);
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

  // Sunday to Saturday, filled where the word of the day was practised.
  function dayDots(days) {
    return el("span", { class: "day-dots", role: "img", "aria-label": countDays(days) + " of 7 days practised" }, DAY_LETTERS.map(function (letter, i) {
      return el("span", { class: "day-dot" + (days[i] ? " on" : ""), title: DAY_NAMES[i] + (days[i] ? ": practised" : ""), text: letter });
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

  // The report itself: totals, then week by week. Used for a student's own
  // page and for the teacher's view of that student.
  function reportNodes(results, practice) {
    var avg = averagePercent(results);
    var practisedDays = {};
    practice.forEach(function (p) { practisedDays[p.day] = true; });
    var nodes = [el("div", { class: "stats" }, [
      statTile(results.length, results.length === 1 ? "quiz taken" : "quizzes taken"),
      statTile(avg === null ? "–" : avg + "%", "average of best scores"),
      statTile(countDays(practisedDays), "words of the day practised")
    ])];
    var thisWeek = dayKey(weekStart(new Date()));
    var rows = weeklyProgress(results, practice).map(function (w) {
      var scores = bestScores(w.quizzes);
      return el("tr", null, [
        el("th", { scope: "row" }, [
          el("span", { class: "week-name", text: weekLabel(w.start) }),
          dayKey(w.start) === thisWeek ? el("span", { class: "col-date", text: "This week" }) : null
        ]),
        el("td", { class: w.quizzes.length ? null : "empty", text: w.quizzes.length ? String(w.quizzes.length) : "–" }),
        el("td", { class: "scores-cell" + (scores.length ? "" : " empty") }, scores.length ? scores.map(function (r) {
          var lesson = findLesson(r.lessonId);
          return el("span", { class: "score-line" }, [
            el("strong", { class: "score-pill " + scoreClass(r.score, r.total), text: r.score + " / " + r.total }),
            el("span", { text: lesson ? lesson.name : r.lessonTitle || r.lessonId })
          ]);
        }) : ["–"]),
        el("td", null, [dayDots(w.days)])
      ]);
    });
    nodes.push(el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid week-grid" }, [
      el("thead", null, [el("tr", null, [
        el("th", { scope: "col", text: "Week" }),
        el("th", { scope: "col", text: "Quizzes taken" }),
        el("th", { scope: "col", text: "Best score per lesson" }),
        el("th", { scope: "col", text: "Word of the day" })
      ])]),
      el("tbody", null, rows)
    ])]));
    return nodes;
  }

  function loadReport() {
    var report = state.report;
    if (!config.resultsUrl || !state.student || report.loading) return;
    report.loading = true;
    callBackend(asStudent({ action: "myReport" })).then(function (res) {
      if (res && res.ok) { report.data = { results: res.results || [], practice: res.practice || [] }; report.error = ""; }
      else report.error = backendMessage(res, "Couldn't load your progress.");
    }, function () {
      report.error = "Couldn't reach the class service. Check your connection.";
    }).then(function () {
      report.loading = false;
      if (state.route.view === "progress" || (onQuizTab() && !state.quiz)) render();
    });
  }

  function onQuizTab() {
    return state.route.view === "lesson" && state.route.tab === "quiz";
  }

  function renderMyProgress() {
    var report = state.report;
    var wrap = el("section", null, [
      el("h1", { text: "My progress" }),
      el("p", { class: "lede", text: state.student.name + " · your quiz scores and Word of the day practice, week by week." })
    ]);
    if (!config.resultsUrl) {
      wrap.appendChild(el("p", { class: "notice", text: NOT_CONNECTED }));
      return wrap;
    }
    if (report.error) wrap.appendChild(el("p", { class: "notice error", text: report.error }));
    if (!report.data) {
      if (!report.error) wrap.appendChild(el("p", { class: "notice", text: "Loading your progress…" }));
      return wrap;
    }
    wrap.appendChild(el("div", { class: "card dash-card" }, reportNodes(report.data.results, report.data.practice)));
    if (!report.data.results.length && !report.data.practice.length) {
      wrap.appendChild(el("p", { class: "notice", text: "Nothing here yet. Take a quiz or practise the word of the day and it will show up." }));
    }
    wrap.appendChild(el("p", { class: "hint", text: state.student.token
      ? "Only you and your teacher can see this report."
      : "You signed in without a PIN, so anyone who types your name can see this page. To keep it private, sign out and sign in again with a PIN of your choice." }));
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
    joinedAs: "",
    timer: null,
    shownKey: ""
  };

  function isLiveTeacher() {
    return !!state.teacher.passcode;
  }

  function liveHere(lesson) {
    return !!(live.remote && live.remote.running && live.remote.lessonId === lesson.id);
  }

  function liveDot() {
    var lesson = state.route.lessonId && findLesson(state.route.lessonId);
    var on = lesson && liveHere(lesson);
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
      live.remote = res;
      live.error = "";
      if (!res.running) live.teacherIndex = null;
    }).catch(function () {
      live.error = "Couldn't reach the class service. Retrying…";
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
      live.error = "That change may not have reached the students. Check your connection.";
      render();
    });
  }

  function startLiveClass(lesson) {
    live.busy = true;
    render();
    callBackend({ action: "liveStart", passcode: state.teacher.passcode, lessonId: lesson.id }).then(function (res) {
      if (res && res.ok) {
        live.remote = res;
        live.teacherIndex = 0;
        live.attendees = [];
        live.error = "";
      } else if (res && res.error === "wrong-passcode") {
        forgetTeacherPasscode();
        state.teacher.error = "That passcode didn't work. Check it matches the one in your Google script.";
      } else {
        live.error = "Couldn't start the class. Try again.";
      }
    }, function () {
      live.error = "Couldn't reach the class service. Check your connection and try again.";
    }).then(function () {
      live.busy = false;
      render();
      scheduleLivePoll();
    });
  }

  function endLiveClass() {
    if (!window.confirm("End the live class for everyone?")) return;
    live.busy = true;
    render();
    callBackend({ action: "liveEnd", passcode: state.teacher.passcode }).then(function (res) {
      if (res && res.ok) {
        live.remote = { running: false };
        live.teacherIndex = null;
        live.attendees = [];
      }
    }, function () {
      live.error = "Couldn't end the class. Try again.";
    }).then(function () {
      live.busy = false;
      render();
    });
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
      } else if (res && res.error === "not-live") {
        live.remote = { running: false };
        live.joinError = "The class isn't live right now.";
      } else if (res && res.error === "bad-name") {
        live.joinError = "Please enter your name.";
      } else if (res && res.error === "bad-email") {
        live.joinError = "That email doesn't look right. You can also leave it empty.";
      } else {
        live.joinError = "Couldn't join. Try again.";
      }
    }, function () {
      live.joinError = "Couldn't reach the class service. Check your connection and try again.";
    }).then(function () {
      live.joining = false;
      render();
      scheduleLivePoll();
    });
  }

  function renderLive(lesson) {
    live.shownKey = liveKey();

    if (!config.resultsUrl) {
      return el("p", { class: "notice", text: "The live class needs the Google script connected (see README.md)." });
    }
    var parts = [el("div", { class: "toolbar no-print", style: "margin-bottom:16px" }, [niqqudToggle()])];
    if (live.error) parts.push(el("p", { class: "notice error", text: live.error }));
    parts.push(isLiveTeacher() ? renderLiveTeacher(lesson) : renderLiveStudent(lesson));
    return el("div", { class: "live-view" }, parts);
  }

  function liveCard(lesson, index, teacher) {
    var list = cardList(lesson);
    if (!list.length) return [el("p", { class: "notice", text: "This lesson has no phrases yet." })];
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
        el("button", { class: "btn", type: "button", disabled: index === 0, onclick: function () { moveLive(-1); }, text: "← Previous" }),
        el("span", { class: "card-count", "aria-live": "polite", text: (index + 1) + " / " + list.length }),
        el("button", { class: "btn primary", type: "button", disabled: index === list.length - 1, onclick: function () { moveLive(1); }, text: "Next word →" })
      ]));
    } else {
      nodes.push(el("p", { class: "live-follow", "aria-live": "polite" }, [
        el("span", { class: "live-dot on", "aria-hidden": "true" }),
        "Following your teacher · " + (index + 1) + " / " + list.length
      ]));
    }
    return nodes;
  }

  function renderLiveTeacher(lesson) {
    var r = live.remote || {};
    var wrap = el("div");
    if (!live.checked) {
      wrap.appendChild(el("p", { class: "notice", text: "Checking whether a class is live…" }));
      return wrap;
    }
    if (!liveHere(lesson)) {
      var other = r.running && findLesson(r.lessonId);
      wrap.appendChild(el("div", { class: "card live-start" }, [
        el("h2", { text: "Teach this lesson live" }),
        el("p", { text: "Start the class, then share this page's link with your students. They join with their name and see whichever word you're on, a few seconds after you move." }),
        r.running ? el("p", { class: "notice", text: "A live class is already running for “" + (other ? other.name : r.lessonId) + "”. Starting here ends it." }) : null,
        el("div", { class: "actions" }, [
          el("button", { class: "btn primary", type: "button", disabled: live.busy, onclick: function () { startLiveClass(lesson); }, text: live.busy ? "Starting…" : "Start live class" })
        ])
      ]));
      wrap.appendChild(teacherSignOut());
      return wrap;
    }

    liveCard(lesson, liveIndex(), true).forEach(function (n) { wrap.appendChild(n); });
    var people = live.attendees;
    wrap.appendChild(el("div", { class: "card live-panel" }, [
      el("div", { class: "live-panel-head" }, [
        el("h2", null, [el("span", { class: "live-dot on", "aria-hidden": "true" }), "Live now"]),
        el("button", { class: "btn", type: "button", disabled: live.busy, onclick: endLiveClass, text: "End class" })
      ]),
      el("p", { class: "muted", text: people.length ? people.length + (people.length === 1 ? " student has" : " students have") + " joined:" : "No students have joined yet. Share this page's link with them." }),
      people.length ? el("ul", { class: "live-people" }, people.map(function (p) {
        return el("li", { text: attendeeLabel(p) });
      })) : null,
      el("p", { class: "hint", text: "Use the ← → arrow keys or the buttons to move. Students' screens follow within a few seconds." })
    ]));
    return wrap;
  }

  function teacherSignOut() {
    return el("p", { class: "hint" }, [
      "You're signed in as the teacher on this browser. ",
      el("button", { class: "linklike", type: "button", text: "Sign out", onclick: signOut })
    ]);
  }

  function renderLiveStudent(lesson) {
    var r = live.remote || {};
    var wrap = el("div");
    if (!live.checked) {
      wrap.appendChild(el("p", { class: "notice", text: "Checking whether the class is live…" }));
    } else if (!r.running) {
      wrap.appendChild(el("div", { class: "card live-start" }, [
        el("h2", { text: live.joinedThisVisit ? "The live class has ended" : "The class isn't live right now" }),
        el("p", { text: live.joinedThisVisit ? "Thanks for joining! You can keep practising with Word by word or the quiz." : "When your teacher starts the class, you can join here. This page checks every few seconds, so you can leave it open." })
      ]));
    } else if (r.lessonId !== lesson.id) {
      var other = findLesson(r.lessonId);
      wrap.appendChild(el("div", { class: "card live-start" }, [
        el("h2", { text: "The live class is on another lesson" }),
        other ? el("a", { class: "btn primary", href: lessonUrl(other, "live"), text: "Go to “" + other.name + "”" }) : el("p", { text: "Reload the page to see the newest lessons." })
      ]));
    } else if (live.joinedSession !== r.sessionId) {
      wrap.appendChild(joinForm());
    } else {
      live.joinedThisVisit = true;
      liveCard(lesson, liveIndex(), false).forEach(function (n) { wrap.appendChild(n); });
      wrap.appendChild(el("p", { class: "hint live-signed", text: "Joined as " + (live.joinedAs || state.studentName) }));
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
      el("h2", null, [el("span", { class: "live-dot on", "aria-hidden": "true" }), "The class is live"]),
      el("p", { text: "Enter your name to join. You'll see the word your teacher is on." }),
      el("div", { class: "field" }, [el("label", { for: "live-name", text: "Your name" }), nameInput]),
      el("div", { class: "field" }, [el("label", { for: "live-email", text: "Your email (optional)" }), emailInput]),
      live.joinError ? el("p", { class: "notice error", text: live.joinError }) : null,
      el("button", { class: "btn primary", type: "submit", disabled: live.joining, text: live.joining ? "Joining…" : "Join the class" })
    ]);
  }

  /* ---------- Teacher dashboard ---------- */

  function loadResults() {
    var t = state.teacher;
    if (!config.resultsUrl || !t.passcode || t.loading) return;
    var rejected = false;
    t.loading = true;
    callBackend({ action: "list", passcode: t.passcode }).then(function (res) {
      if (res && res.ok) {
        t.results = res.results || [];
        t.practice = res.practice || [];
        t.students = res.students || [];
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
    return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
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
      : t.updatedAt ? "Updated " + t.updatedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + " · refreshes every 30 seconds"
      : "";
    wrap.appendChild(el("div", { class: "toolbar dash-toolbar" }, [
      el("p", { class: "dash-status", text: status }),
      el("button", { class: "btn", type: "button", text: t.loading ? "Refreshing…" : "Refresh", disabled: t.loading, onclick: loadResults })
    ]));
    if (t.error) wrap.appendChild(el("p", { class: "notice error", text: t.error }));
    if (!t.results) return wrap;

    wrap.appendChild(renderSuggestionsCard());
    if (!t.results.length && !t.practice.length && !t.students.length) {
      wrap.appendChild(el("p", { class: "notice", text: "No students yet. They appear here as soon as someone signs in, finishes a quiz or practises the word of the day." }));
      return wrap;
    }
    wrap.appendChild(renderWeekCard(t));
    if (t.report) wrap.appendChild(renderStudentReport(t));
    if (!t.results.length) return wrap;
    wrap.appendChild(renderScoreGrid(t));
    if (t.selected) wrap.appendChild(renderAttempts(t));
    wrap.appendChild(renderRecent(t));
    return wrap;
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
  function renderWeekCard(t) {
    var start = addDays(weekStart(new Date()), 7 * t.week);
    var startKey = dayKey(start);
    var endKey = dayKey(addDays(start, 6));
    var body = el("tbody", null, knownStudents(t).map(function (s) {
      var data = studentData(t, s.key);
      var quizzes = data.results.filter(function (r) {
        var d = new Date(r.finishedAt);
        return !isNaN(d) && dayKey(weekStart(d)) === startKey;
      });
      var days = {};
      data.practice.forEach(function (p) {
        var d = parseDay(p.day);
        if (d && p.day >= startKey && p.day <= endKey) days[d.getDay()] = true;
      });
      var avg = averagePercent(quizzes);
      var open = t.report === s.key;
      return el("tr", null, [
        el("th", { scope: "row" }, [el("button", {
          class: "linklike",
          type: "button",
          "aria-expanded": open ? "true" : "false",
          text: s.name,
          onclick: function () { t.report = open ? null : s.key; render(); }
        })]),
        el("td", { class: quizzes.length ? null : "empty", text: quizzes.length ? String(quizzes.length) : "–" }),
        el("td", { class: avg === null ? "empty" : null }, [
          avg === null ? "–" : el("strong", { class: "score-pill " + scoreClass(avg, 100), text: avg + "%" })
        ]),
        el("td", null, [dayDots(days)])
      ]);
    }));
    return el("div", { class: "card dash-card" }, [
      el("div", { class: "week-head" }, [
        el("div", null, [
          el("h2", { text: "Weekly progress" }),
          el("p", { class: "hint", text: weekLabel(start) + (t.week === 0 ? " · this week" : "") + ". Tap a name for that student's full report." })
        ]),
        el("div", { class: "week-nav" }, [
          el("button", { class: "btn", type: "button", "aria-label": "Previous week", text: "←", onclick: function () { t.week -= 1; render(); } }),
          el("button", { class: "btn", type: "button", "aria-label": "Next week", text: "→", disabled: t.week >= 0, onclick: function () { t.week += 1; render(); } })
        ])
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
    ]);
  }

  function renderStudentReport(t) {
    var student = knownStudents(t).filter(function (s) { return s.key === t.report; })[0];
    if (!student) return null;
    var data = studentData(t, student.key);
    var onFile = t.students.filter(function (s) { return studentKey(s.name) === student.key; })[0];
    var email = onFile && onFile.email;
    return el("div", { class: "card dash-card" }, [
      el("div", { class: "week-head" }, [
        el("h2", { text: student.name + " · full report" }),
        el("button", { class: "btn", type: "button", text: "Close", onclick: function () { t.report = null; render(); } })
      ]),
      email ? el("p", { class: "hint" }, [el("a", { href: "mailto:" + email, text: email })]) : null
    ].concat(reportNodes(data.results, data.practice)));
  }

  // Students down the side, lessons across the top; each cell is the best score.
  function renderScoreGrid(t) {
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
        el("span", { class: "col-date", text: lesson ? formatDate(lesson.date) : "" }),
        el("span", { class: "col-title", text: lesson ? lesson.name : lessonTitles[id] || id })
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
        var selected = t.selected && t.selected.student === key && t.selected.lessonId === id;
        return el("td", null, [el("button", {
          type: "button",
          class: "cell " + scoreClass(best.score, best.total) + (selected ? " selected" : ""),
          "aria-label": s.name + ": best " + best.score + " of " + best.total + ", " + attempts.length + " tries. Show details",
          onclick: function () {
            t.selected = selected ? null : { student: key, lessonId: id };
            render();
          }
        }, [
          el("span", { class: "cell-score", text: best.score + "/" + best.total }),
          el("span", { class: "cell-tries", text: attempts.length === 1 ? "1 try" : attempts.length + " tries" })
        ])]);
      })));
    }));

    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "Best score per lesson" }),
      el("p", { class: "hint", text: "Tap a score to see each try and the phrases missed." }),
      el("div", { class: "grid-scroll" }, [el("table", { class: "score-grid" }, [el("thead", null, [head]), body])])
    ]);
  }

  function renderAttempts(t) {
    var sel = t.selected;
    var attempts = t.results.filter(function (r) {
      return studentKey(r.student) === sel.student && r.lessonId === sel.lessonId;
    }).sort(function (a, b) { return a.finishedAt < b.finishedAt ? 1 : -1; });
    if (!attempts.length) return null;
    var lesson = findLesson(sel.lessonId);
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: attempts[attempts.length - 1].student.trim() + " · " + (lesson ? lesson.name : attempts[0].lessonTitle) }),
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

  function renderRecent(t) {
    var recent = t.results.slice().sort(function (a, b) { return a.finishedAt < b.finishedAt ? 1 : -1; }).slice(0, 10);
    return el("div", { class: "card dash-card" }, [
      el("h2", { text: "Latest quizzes" }),
      el("ul", { class: "recent" }, recent.map(function (r) {
        var lesson = findLesson(r.lessonId);
        return el("li", null, [
          el("span", { class: "recent-name", text: r.student.trim() }),
          el("span", { class: "muted", text: (lesson ? lesson.name : r.lessonTitle) + " · " + formatTime(r.finishedAt) }),
          el("strong", { class: "score-pill " + scoreClass(r.score, r.total), text: r.score + " / " + r.total })
        ]);
      }))
    ]);
  }

  /* ---------- Start ---------- */

  setInterval(function () {
    if (onTeacherPage() && !document.hidden) loadResults();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", function () {
    if (onTeacherPage() && !document.hidden) loadResults();
  });

  window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("resize", scalePage);
  document.addEventListener("keydown", function (e) {
    if (state.route.view !== "lesson" || (state.route.tab !== "cards" && state.route.tab !== "live")) return;
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    var move = state.route.tab === "live" ? moveLive : moveCard;
    if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
  });
  window.addEventListener("beforeprint", fitSheet);

  document.addEventListener("DOMContentLoaded", function () {
    loadLessons(function () {
      lessons.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      state.route = parseHash();
      loadForRoute();
      render();
      startLivePolling();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSheet);
    });
  });
})();
