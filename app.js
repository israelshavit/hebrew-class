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
    loadErrors: []
  };

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
    return "#/lesson/" + encodeURIComponent(lesson.id) + (tab === "quiz" ? "/quiz" : "");
  }

  /* ---------- Routing ---------- */

  function parseHash() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    if (parts[0] === "lesson" && parts[1]) {
      return {
        view: "lesson",
        lessonId: decodeURIComponent(parts[1]),
        tab: parts[2] === "quiz" ? "quiz" : "sheet"
      };
    }
    return { view: "home" };
  }

  function onRouteChange() {
    state.route = parseHash();
    if (state.quiz && state.quiz.lessonId !== state.route.lessonId) state.quiz = null;
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- Rendering ---------- */

  function render() {
    var app = document.getElementById("app");
    app.textContent = "";
    if (state.route.view === "lesson") {
      var lesson = findLesson(state.route.lessonId);
      app.appendChild(lesson ? renderLesson(lesson) : renderNotFound());
    } else {
      app.appendChild(renderHome());
    }
    document.title = state.route.view === "lesson" && findLesson(state.route.lessonId)
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
        el("a", { class: "tab" + (tab === "quiz" ? " active" : ""), href: lessonUrl(lesson, "quiz"), "aria-current": tab === "quiz" ? "page" : null, text: "Quiz" })
      ])
    ]);
    return el("section", null, [head, tab === "quiz" ? renderQuiz(lesson) : renderSheetTab(lesson)]);
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
    // Apps Script web apps do not answer CORS preflights, so send a simple
    // text/plain request; the response is opaque but the row is recorded.
    fetch(config.resultsUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function () {
      quiz.sendStatus = "sent";
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

  /* ---------- Start ---------- */

  window.addEventListener("hashchange", onRouteChange);
  window.addEventListener("resize", scalePage);
  window.addEventListener("beforeprint", fitSheet);

  document.addEventListener("DOMContentLoaded", function () {
    loadLessons(function () {
      lessons.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      state.route = parseHash();
      render();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSheet);
    });
  });
})();
