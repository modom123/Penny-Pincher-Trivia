/* Penny Pinching Trivia — playable sample question on the landing page.
   No backend: a small rotating deck that mimics the real timed-question feel. */
(function () {
  const QUESTIONS = [
    { subject: "Geography · Grade 6", round: 7, cost: "$0.07",
      q: "Which river is the longest in the world?",
      options: ["Amazon", "Nile", "Mississippi", "Yangtze"], answer: 1 },
    { subject: "Science · Grade 9", round: 23, cost: "$0.23",
      q: "What gas do plants absorb from the air for photosynthesis?",
      options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], answer: 2 },
    { subject: "History · Grade 8", round: 41, cost: "$0.41",
      q: "In what year did the first humans land on the Moon?",
      options: ["1965", "1969", "1972", "1958"], answer: 1 },
    { subject: "Pop Culture · Grade 5", round: 12, cost: "$0.12",
      q: "Which planet is known as the Red Planet?",
      options: ["Venus", "Jupiter", "Mars", "Mercury"], answer: 2 },
    { subject: "Math · Grade 7", round: 58, cost: "$0.58",
      q: "What is 15% of 200?",
      options: ["30", "25", "15", "35"], answer: 0 },
    { subject: "Language · Grade 10", round: 77, cost: "$0.77",
      q: "“Ephemeral” most nearly means…",
      options: ["Enormous", "Short-lived", "Ancient", "Colorful"], answer: 1 },
  ];
  const KEYS = ["A", "B", "C", "D"];
  const DURATION = 10000; // ms

  const el = (id) => document.getElementById(id);
  const card = el("triviaCard");
  if (!card) return;

  let idx = -1, right = 0, total = 0, locked = true, raf = 0, start = 0, ended = false;

  function shuffleStart() { idx = Math.floor(Math.random() * QUESTIONS.length); }

  function render() {
    const q = QUESTIONS[idx];
    el("qSubject").textContent = q.subject;
    el("qRound").textContent = `Round ${q.round} · ${q.cost}`;
    el("qText").textContent = q.q;
    const box = el("qOptions");
    box.innerHTML = "";
    q.options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "opt";
      b.innerHTML = `<span class="key">${KEYS[i]}</span><span>${opt}</span>`;
      b.addEventListener("click", () => choose(i));
      box.appendChild(b);
    });
    el("qNote").className = "demo-note";
    el("qNote").textContent = "10 seconds on the clock — speed earns bonus points!";
    el("qBtn").textContent = "Skip →";
    locked = false;
    ended = false;
    startTimer();
  }

  function startTimer() {
    start = performance.now();
    cancelAnimationFrame(raf);
    const tick = (now) => {
      const left = Math.max(0, DURATION - (now - start));
      el("timerFill").style.width = (left / DURATION) * 100 + "%";
      if (left <= 0) { timeUp(); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function stopTimer() { cancelAnimationFrame(raf); }

  function reveal() {
    const q = QUESTIONS[idx];
    const btns = el("qOptions").querySelectorAll(".opt");
    btns.forEach((b, i) => {
      b.disabled = true;
      if (i === q.answer) b.classList.add("correct");
    });
    return btns;
  }

  function choose(i) {
    if (locked || ended) return;
    ended = true; locked = true;
    stopTimer();
    const q = QUESTIONS[idx];
    const btns = reveal();
    total++;
    const note = el("qNote");
    if (i === q.answer) {
      right++;
      note.className = "demo-note hit";
      note.textContent = "🎉 Correct! In the real game, answering that fast banks a speed bonus.";
    } else {
      btns[i].classList.add("wrong");
      note.className = "demo-note miss";
      note.textContent = "So close! In a real round a miss costs points — and cents.";
    }
    finish();
  }

  function timeUp() {
    if (ended) return;
    ended = true; locked = true;
    stopTimer();
    el("timerFill").style.width = "0%";
    reveal();
    total++;
    const note = el("qNote");
    note.className = "demo-note miss";
    note.textContent = "⏰ Time! The clock is real — our servers keep it, not your phone.";
    finish();
  }

  function finish() {
    el("qScore").textContent = `Score: ${right} / ${total}`;
    const btn = el("qBtn");
    btn.textContent = total >= 2 ? "Next question ▶" : "Try another ▶";
  }

  function next() {
    stopTimer();
    idx = (idx + 1) % QUESTIONS.length;
    render();
  }

  el("qBtn").addEventListener("click", () => {
    if (idx === -1) { shuffleStart(); render(); }
    else next();
  });
})();
