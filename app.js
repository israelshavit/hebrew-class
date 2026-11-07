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

  var CHOICE_QUESTIONS = 10;
  var MATCH_ROUNDS = 2;
  var PAIRS_PER_ROUND = 5;

  // Vowel points and other marks, but not maqaf (U+05BE) or sof pasuq (U+05C3).
  var NIQQUD = /[֑-ׇֽֿׁׂׅׄ]/g;

  var lessons = [];

  var state = {
    route: { view: "home" },
    niqqud: readSetting("hebrewClass.niqqud", "1") !== "0",
    studentName: readSetting("hebrewClass.studentName", ""),
    quiz: null,
    cards: null,
    loadErrors: [],
    teacher: {
      passcode: readSetting("hebrewClass.teacherPasscode", ""),
      results: null,
      loading: false,
      error: "",
      updatedAt: null,
      selected: null
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
      notes: raw.notes || "",
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
        if (pending === 0) done();
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
    return "#/lesson/" + encodeURIComponent(lesson.id) + (tab === "quiz" || tab === "cards" ? "/" + tab : "");
  }

  /* ---------- Routing ---------- */

  function parseHash() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    if (parts[0] === "teacher") return { view: "teacher" };
    if (parts[0] === "lesson" && parts[1]) {
      return {
        view: "lesson",
        lessonId: decodeURIComponent(parts[1]),
        tab: parts[2] === "quiz" || parts[2] === "cards" ? parts[2] : "sheet"
      };
    }
    return { view: "home" };
  }

  function onRouteChange() {
    state.route = parseHash();
    if (state.quiz && state.quiz.lessonId !== state.route.lessonId) state.quiz = null;
    if (state.cards && state.cards.lessonId !== state.route.lessonId) state.cards = null;
    if (state.route.view === "teacher") loadResults();
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Rendering ---------- */

  function render() {
    var app = document.getElementById("app");
    app.textContent = "";
    if (state.route.view === "teacher") {
      app.appendChild(renderTeacher());
    } else if (state.route.view === "lesson") {
      var lesson = findLesson(state.route.lessonId);
      app.appendChild(lesson ? renderLesson(lesson) : renderNotFound());
    } else {
      app.appendChild(renderHome());
    }
    document.title = state.route.view === "teacher" ? "Teacher dashboard · Hebrew Class"
      : state.route.view === "lesson" && findLesson(state.route.lessonId)
        ? findLesson(state.route.lessonId).title + " · Hebrew Class"
        : "Hebrew Class";
    fitSheet();
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
          el("span", { class: "lesson-title", text: lesson.title }),
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
    var head = el("div", { class: "lesson-head no-print" }, [
      el("a", { class: "back", href: "#/", text: "← All lessons" }),
      el("h1", { text: lesson.title }),
      el("p", { class: "lesson-date", text: formatDate(lesson.date) }),
      el("nav", { class: "tabs", "aria-label": "Lesson" }, [
        el("a", { class: "tab" + (tab === "sheet" ? " active" : ""), href: lessonUrl(lesson, "sheet"), "aria-current": tab === "sheet" ? "page" : null, text: "Lesson sheet" }),
        el("a", { class: "tab" + (tab === "cards" ? " active" : ""), href: lessonUrl(lesson, "cards"), "aria-current": tab === "cards" ? "page" : null, text: "Word by word" }),
        el("a", { class: "tab" + (tab === "quiz" ? " active" : ""), href: lessonUrl(lesson, "quiz"), "aria-current": tab === "quiz" ? "page" : null, text: "Quiz" })
      ])
    ]);
    var body = tab === "quiz" ? renderQuiz(lesson) : tab === "cards" ? renderCards(lesson) : renderSheetTab(lesson);
    return el("section", null, [head, body]);
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
      lesson.video ? el("a", { class: "btn", href: lesson.video, target: "_blank", rel: "noopener", text: "Watch the video" }) : null,
      el("button", { class: "btn primary", type: "button", onclick: function () { window.print(); }, text: "Print or save as PDF" })
    ]);
    var hint = el("p", { class: "hint no-print", text: "To download the sheet, press Print and choose “Save as PDF” as the printer." });
    var page = el("div", { class: "page", id: "sheet-page" }, [buildSheet(lesson)]);
    return el("div", null, [toolbar, hint, el("div", { class: "page-frame", id: "page-frame" }, [page])]);
  }

  function buildSheet(lesson) {
    var tbody = el("tbody");
    lesson.sections.forEach(function (section, si) {
      tbody.appendChild(el("tr", { class: "section" }, [
        el("td", { colspan: "3", text: (si + 1) + ". " + section.title })
      ]));
      section.rows.forEach(function (row) {
        tbody.appendChild(el("tr", null, [
          el("td", { text: row.en }),
          el("td", { class: "tr" }, formSpans(row, function (f) {
            return f.tr + (f.g ? " (" + f.g + ")" : "");
          })),
          el("td", { class: "he", lang: "he", dir: "rtl" }, formSpans(row, function (f) {
            return heb(f.he);
          }))
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

    return el("div", { class: "sheet" }, [
      el("h2", { class: "sheet-title", text: lesson.title }),
      el("p", { class: "sheet-subtitle", text: [lesson.subtitle, formatDate(lesson.date)].filter(Boolean).join(" · ") }),
      table,
      lesson.notes ? el("p", { class: "sheet-notes" }, [el("strong", { text: "Notes: " }), lesson.notes]) : null
    ]);
  }

  // Male and female forms share a line when there is room; each form stays whole.
  function formSpans(row, textOf) {
    var nodes = [];
    row.forms.forEach(function (f, i) {
      if (i > 0) nodes.push(el("span", { class: "sep", text: " · " }));
      nodes.push(el("span", { class: "form", text: textOf(f) }));
    });
    return nodes;
  }

  // Pick the largest font size at which the sheet fits on one page.
  function fitSheet() {
    var page = document.getElementById("sheet-page");
    if (!page) return;
    var sheet = page.firstChild;
    var maxHeight = PAGE_H - 2 * PAGE_PAD;
    var size = MAX_FONT;
    sheet.style.fontSize = size + "px";
    while (sheet.offsetHeight > maxHeight && size > MIN_FONT) {
      size -= 0.25;
      sheet.style.fontSize = size + "px";
    }
    scalePage();
  }

  function scalePage() {
    var frame = document.getElementById("page-frame");
    var page = document.getElementById("sheet-page");
    if (!frame || !page) return;
    var scale = Math.min(1, frame.clientWidth / PAGE_W);
    page.style.transform = "scale(" + scale + ")";
    frame.style.height = Math.ceil(PAGE_H * scale) + "px";
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
    var item = list[c.index];
    var row = item.row;
    var first = c.index === 0;
    var last = c.index === list.length - 1;

    var forms = row.forms.map(function (f) {
      return el("div", { class: "card-form" }, [
        f.g ? el("span", { class: "card-gender", text: genderLabel(row, f.g) }) : null,
        el("p", { class: "card-he", lang: "he", dir: "rtl", text: heb(f.he) }),
        el("p", { class: "card-tr", text: f.tr })
      ]);
    });

    var card = el("div", { class: "card word-card" }, [
      el("p", { class: "card-section", text: item.sectionNo + ". " + item.section.title }),
      el("div", { class: "card-forms" + (forms.length > 1 ? " two" : "") }, forms),
      el("p", { class: "card-en", text: row.en.replace(/\s*\((to )?m\/f\)/, "") })
    ]);
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

  // Swipe left for the next word, right for the previous one.
  function addSwipe(node) {
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
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) moveCard(dx < 0 ? 1 : -1);
    });
  }

  /* ---------- Quiz ---------- */

  function buildQuiz(lesson) {
    var usedRows = {};
    var items = [];

    // English -> Hebrew multiple choice, one form per row.
    shuffle(lesson.forms.slice()).forEach(function (form) {
      if (items.length >= CHOICE_QUESTIONS || usedRows[form.row.id]) return;
      usedRows[form.row.id] = true;
      items.push({ type: "choice", form: form, options: makeOptions(form, lesson.forms), picked: null });
    });

    // Matching rounds, preferring rows the choice questions did not use.
    var rows = [];
    lesson.sections.forEach(function (s) { rows = rows.concat(s.rows); });
    rows = shuffle(rows).sort(function (a, b) {
      return (usedRows[a.id] ? 1 : 0) - (usedRows[b.id] ? 1 : 0);
    });
    var seenHebrew = {};
    var pool = [];
    rows.forEach(function (row) {
      var form = row.forms[Math.floor(Math.random() * row.forms.length)];
      if (seenHebrew[plain(form.he)]) return;
      seenHebrew[plain(form.he)] = true;
      pool.push(form);
    });
    for (var r = 0; r < MATCH_ROUNDS; r++) {
      var chunk = pool.slice(r * PAIRS_PER_ROUND, (r + 1) * PAIRS_PER_ROUND);
      if (chunk.length < 3) break;
      items.push({
        type: "match",
        pairs: chunk.map(function (form) { return { form: form, matched: false, wrong: false }; }),
        heOrder: shuffle(chunk.map(function (_, i) { return i; })),
        selEn: null,
        selHe: null,
        flash: null
      });
    }

    var total = 0;
    items.forEach(function (item) { total += item.type === "choice" ? 1 : item.pairs.length; });

    return {
      lessonId: lesson.id,
      step: "start",
      index: 0,
      items: items,
      score: 0,
      total: total,
      missed: [],
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
    if (!state.quiz) state.quiz = buildQuiz(lesson);
    var quiz = state.quiz;
    var body;
    if (quiz.step === "start") body = renderQuizStart(lesson, quiz);
    else if (quiz.step === "done") body = renderQuizResults(lesson, quiz);
    else {
      var item = quiz.items[quiz.index];
      body = item.type === "choice" ? renderChoice(quiz, item) : renderMatch(quiz, item);
    }
    return el("div", null, [el("div", { class: "toolbar no-print", style: "margin-bottom:16px" }, [niqqudToggle()]), body]);
  }

  function renderQuizStart(lesson, quiz) {
    var choices = 0;
    var rounds = 0;
    quiz.items.forEach(function (item) { if (item.type === "choice") choices++; else rounds++; });
    var sending = !!config.resultsUrl;
    var form = el("form", {
      onsubmit: function (e) {
        e.preventDefault();
        var name = state.studentName.trim();
        if (!name) return;
        state.studentName = name;
        writeSetting("hebrewClass.studentName", name);
        quiz.step = "run";
        render();
      }
    }, [
      el("label", { class: "field" }, [
        el("span", { text: "Your name" }),
        el("input", {
          type: "text",
          required: true,
          maxlength: "60",
          autocomplete: "name",
          value: state.studentName,
          oninput: function (e) { state.studentName = e.target.value; }
        })
      ]),
      el("div", { class: "actions" }, [el("button", { class: "btn primary", type: "submit", text: "Start quiz" })])
    ]);
    var parts = [];
    if (choices) parts.push(choices + " multiple-choice questions");
    if (rounds) parts.push(rounds + " matching " + (rounds === 1 ? "round" : "rounds"));
    return el("div", { class: "card" }, [
      el("h2", { text: "Quiz: " + lesson.title, style: "margin-top:0" }),
      el("p", { text: parts.join(" and ") + ". Pick the Hebrew that matches the English." + (sending ? " Your score will be sent to your teacher." : "") }),
      form
    ]);
  }

  function renderProgress(quiz) {
    var pct = Math.round((quiz.index / quiz.items.length) * 100);
    return [
      el("p", { class: "quiz-progress", text: "Step " + (quiz.index + 1) + " of " + quiz.items.length + " · Score " + quiz.score }),
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
      return el("button", {
        class: cls,
        type: "button",
        lang: "he",
        dir: "rtl",
        disabled: answered,
        onclick: function () { answerChoice(quiz, item, opt); },
        text: heb(opt.he)
      });
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
        el("span", { class: "tr", text: "(" + item.form.tr + ")" })
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
      el("div", { class: "match-grid" }, [enCol, heCol])
    ]);
    if (done) {
      children.push(el("p", { class: "feedback good", text: "All matched!" }));
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
        else quiz.score++;
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
    quiz.step = "done";
    if (!config.resultsUrl) return;
    var lesson = findLesson(quiz.lessonId);
    quiz.sendStatus = "sending";
    var payload = {
      student: state.studentName,
      lessonId: quiz.lessonId,
      lessonTitle: lesson ? lesson.title : "",
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
      el("p", { class: "quiz-progress", text: "Your score" }),
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
            el("span", { class: "tr", text: f.tr })
          ]);
        }))
      ]));
    }
    if (quiz.sendStatus) {
      var statusText = {
        sending: "Sending your score to your teacher…",
        sent: "Your score was sent to your teacher.",
        failed: "Your score could not be sent. Check your connection and take the quiz again, or tell your teacher."
      }[quiz.sendStatus];
      children.push(el("p", { class: "send-status" + (quiz.sendStatus === "failed" ? " bad" : ""), text: statusText }));
    }
    children.push(el("div", { class: "actions" }, [
      el("button", {
        class: "btn primary",
        type: "button",
        text: "Try again",
        onclick: function () {
          state.quiz = buildQuiz(lesson);
          state.quiz.step = "run";
          render();
        }
      }),
      el("a", { class: "btn", href: lessonUrl(lesson, "sheet"), text: "Back to the lesson sheet" })
    ]));
    return el("div", { class: "card" }, children);
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

  /* ---------- Teacher dashboard ---------- */

  function loadResults() {
    var t = state.teacher;
    if (!config.resultsUrl || !t.passcode || t.loading) return;
    t.loading = true;
    callBackend({ action: "list", passcode: t.passcode }).then(function (res) {
      if (res && res.ok) {
        t.results = res.results || [];
        t.error = "";
        t.updatedAt = new Date();
      } else if (res && res.error === "wrong-passcode") {
        t.passcode = "";
        t.results = null;
        t.error = "That passcode didn't work. Check it matches the one in your Google script.";
        writeSetting("hebrewClass.teacherPasscode", "");
      } else {
        t.error = "The results service replied with an error.";
      }
    }, function () {
      t.error = "Couldn't reach the results service. Check your connection; it will retry.";
    }).then(function () {
      t.loading = false;
      if (state.route.view === "teacher") render();
    });
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
          t.passcode = code;
          t.error = "";
          writeSetting("hebrewClass.teacherPasscode", code);
          loadResults();
          render();
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
      el("button", { class: "btn", type: "button", text: t.loading ? "Refreshing…" : "Refresh", disabled: t.loading, onclick: loadResults }),
      el("button", {
        class: "btn",
        type: "button",
        text: "Sign out",
        onclick: function () {
          t.passcode = "";
          t.results = null;
          t.updatedAt = null;
          t.selected = null;
          writeSetting("hebrewClass.teacherPasscode", "");
          render();
        }
      })
    ]));
    if (t.error) wrap.appendChild(el("p", { class: "notice error", text: t.error }));
    if (!t.results) return wrap;
    if (!t.results.length) {
      wrap.appendChild(el("p", { class: "notice", text: "No quiz results yet. They appear here as soon as a student finishes a quiz." }));
      return wrap;
    }

    wrap.appendChild(renderScoreGrid(t));
    if (t.selected) wrap.appendChild(renderAttempts(t));
    wrap.appendChild(renderRecent(t));
    return wrap;
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
        el("span", { class: "col-title", text: lesson ? lesson.title : lessonTitles[id] || id })
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
      el("h2", { text: attempts[attempts.length - 1].student.trim() + " · " + (lesson ? lesson.title : attempts[0].lessonTitle) }),
      el("ul", { class: "attempts" }, attempts.map(function (r) {
        return el("li", null, [
          el("div", { class: "attempt-head" }, [
            el("strong", { class: "score-pill " + scoreClass(r.score, r.total), text: r.score + " / " + r.total }),
            el("span", { class: "muted", text: formatTime(r.finishedAt) })
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
          el("span", { class: "muted", text: (lesson ? lesson.title : r.lessonTitle) + " · " + formatTime(r.finishedAt) }),
          el("strong", { class: "score-pill " + scoreClass(r.score, r.total), text: r.score + " / " + r.total })
        ]);
      }))
    ]);
  }

  /* ---------- Start ---------- */

  setInterval(function () {
    if (state.route.view === "teacher" && !document.hidden) loadResults();
  }, REFRESH_MS);
  document.addEventListener("visibilitychange", function () {
    if (state.route.view === "teacher" && !document.hidden) loadResults();
  });

  window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("resize", scalePage);
  document.addEventListener("keydown", function (e) {
    if (state.route.view !== "lesson" || state.route.tab !== "cards") return;
    if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); moveCard(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); moveCard(-1); }
  });
  window.addEventListener("beforeprint", fitSheet);

  document.addEventListener("DOMContentLoaded", function () {
    loadLessons(function () {
      lessons.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      state.route = parseHash();
      if (state.route.view === "teacher") loadResults();
      render();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSheet);
    });
  });
})();
