// ============================================================================
// social.jsx — Guestbook + Couple Quiz
// ============================================================================

function GuestbookPage() {
  const { guestbook } = useStore();
  const [form, setForm] = useState({ name: "", relationship: "", message: "" });
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);

  const visible = guestbook.filter((g) => g.status === "visible");
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };

  function submit(e) {
    e.preventDefault();
    const er = {};
    if (!form.name.trim()) er.name = "Please enter your name.";
    if (!form.message.trim()) er.message = "Please write a short message.";
    if (form.message.length > 1000) er.message = "Please keep it under 1000 characters.";
    if (Object.keys(er).length) { setErrors(er); return; }
    const auto = Store.get().settings.autoApproveGuestbook;
    Store.addGuestbook({ ...form, status: auto ? "visible" : "pending" });
    setForm({ name: "", relationship: "", message: "" });
    setOpen(false);
    toast(auto ? "Thank you for your message! \ud83d\udc95" : "Thank you! Your message will appear once the couple approves it.");
  }

  return (
    <div className="fade-up">
      <PageHero eyebrow="Guestbook" title="Leave us a little love" lead="A note, a wish, a favorite memory — we'll treasure every word." />
      <section className="block" style={{ paddingTop: 8 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <Button variant="primary" size="lg" onClick={() => setOpen(true)}>{Icon.book({})} Sign the guestbook</Button>
          </div>

          {visible.length === 0 ? (
            <div className="gal-empty"><p style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>No messages yet — be the first!</p></div>
          ) : (
            <div className="gb-grid">
              {visible.map((g) => (
                <div className="gb-card" key={g.id}>
                  <div className="gb-card__quote">&ldquo;</div>
                  <p className="gb-card__msg">{g.message}</p>
                  <div className="gb-card__name">{g.name}</div>
                  {g.relationship && <div className="gb-card__rel">{g.relationship}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} label="Sign the guestbook">
        <SectionHead eyebrow="Guestbook" title="Share your wishes" />
        <form onSubmit={submit} noValidate>
          <div className="field-row field-row--2">
            <Field label="Your name" required error={errors.name} id="g-name">
              <Input id="g-name" value={form.name} onChange={set("name")} placeholder="Jane Doe" />
            </Field>
            <Field label="Relationship" hint="Optional" id="g-rel">
              <Input id="g-rel" value={form.relationship} onChange={set("relationship")} placeholder="e.g. College friend" />
            </Field>
          </div>
          <Field label="Your message" required error={errors.message} hint={`${form.message.length}/1000`} id="g-msg">
            <Textarea id="g-msg" value={form.message} onChange={set("message")} maxLength={1100} placeholder="Wishing you both a lifetime of happiness…" style={{ minHeight: 130 }} />
          </Field>
          <Button type="submit" variant="primary" block>Post message</Button>
        </form>
      </Modal>
    </div>
  );
}

// --- Quiz ------------------------------------------------------------------
function QuizPage() {
  const { quiz } = useStore();
  const [stage, setStage] = useState("intro"); // intro | playing | result
  const [name, setName] = useState("");
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [nameErr, setNameErr] = useState("");

  const q = quiz[idx];
  const total = quiz.length;
  const progress = stage === "result" ? 100 : (idx / total) * 100;

  function start() {
    if (!name.trim()) { setNameErr("Please enter your name to play."); return; }
    setStage("playing"); setIdx(0); setAnswers({});
  }
  function choose(optIdx) {
    const next = { ...answers, [q.id]: optIdx };
    setAnswers(next);
    setTimeout(() => {
      if (idx + 1 < total) setIdx(idx + 1);
      else finish(next);
    }, 220);
  }
  function finish(finalAnswers) {
    let score = 0;
    const detail = quiz.map((qq) => {
      const sel = finalAnswers[qq.id];
      const correct = sel === qq.answer;
      if (correct) score++;
      return { questionId: qq.id, selected: sel, isCorrect: correct };
    });
    Store.addQuizSub({ name: name.trim(), score, total, answers: detail });
    setStage("result");
  }

  if (stage === "intro") {
    return (
      <div className="fade-up">
        <PageHero eyebrow="Couple Quiz" title="How well do you know us?" lead="Five quick questions about the happy couple. Bragging rights on the line!" />
        <section className="block" style={{ paddingTop: 12 }}>
          <div className="container container--narrow">
            <div className="card card--pad-lg" style={{ textAlign: "center" }}>
              <div style={{ color: "var(--accent)", marginBottom: 16 }}>{Icon.quiz({ style: { width: 48, height: 48, margin: "0 auto" } })}</div>
              <Field label="Your name" required error={nameErr} id="q-name">
                <Input id="q-name" value={name} onChange={(e) => { setName(e.target.value); setNameErr(""); }} placeholder="Enter your name to begin" style={{ textAlign: "center" }} />
              </Field>
              <Button variant="primary" size="lg" block onClick={start}>Start the quiz {Icon.arrow({})}</Button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (stage === "result") {
    const sub = { score: quiz.filter((qq) => answers[qq.id] === qq.answer).length, total };
    const pct = sub.score / total;
    const verdict = pct === 1 ? "A perfect score! You clearly know us best. \ud83c\udfc6"
      : pct >= 0.6 ? "Impressive \u2014 you've been paying attention!"
      : "Time to swap a few more stories with us!";
    return (
      <div className="fade-up">
        <section className="block">
          <div className="container container--narrow">
            <div className="card card--pad-lg" style={{ textAlign: "center" }}>
              <div className="eyebrow eyebrow--solo" style={{ justifyContent: "center" }}>Your result</div>
              <div className="quiz-score">{sub.score}<span style={{ fontSize: 40, color: "var(--muted)" }}>/{total}</span></div>
              <h2 style={{ fontSize: 32, margin: "10px 0 8px" }}>Nicely done, {name.split(" ")[0]}!</h2>
              <p style={{ color: "var(--ink-soft)", marginBottom: 28 }}>{verdict}</p>

              <div style={{ textAlign: "left", marginBottom: 26 }}>
                {quiz.map((qq, i) => {
                  const sel = answers[qq.id];
                  const correct = sel === qq.answer;
                  return (
                    <div key={qq.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ color: correct ? "oklch(0.55 0.13 150)" : "oklch(0.55 0.16 25)", flex: "none", marginTop: 2 }}>
                          {correct ? Icon.check({ style: { width: 18, height: 18 } }) : Icon.close({ style: { width: 18, height: 18 } })}
                        </span>
                        <div>
                          <div style={{ fontWeight: 600 }}>{qq.q}</div>
                          <div style={{ fontSize: 14, color: "var(--ink-soft)", marginTop: 2 }}>
                            You said <em>{qq.options[sel]}</em>{!correct && <> · Answer: <strong>{qq.options[qq.answer]}</strong></>}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Button variant="primary" onClick={() => { setStage("intro"); setName(""); }}>Play again</Button>
                <Button variant="ghost" onClick={() => go("guestbook")}>Sign the guestbook</Button>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // playing
  return (
    <div className="fade-up">
      <section className="block">
        <div className="container container--narrow">
          <div className="quiz-progress"><div className="quiz-progress__bar" style={{ width: progress + "%" }} /></div>
          <div className="quiz-q__num">Question {idx + 1} of {total}</div>
          <h2 className="quiz-q__text">{q.q}</h2>
          <div className="quiz-opts">
            {q.options.map((opt, i) => (
              <button key={i} className={"quiz-opt" + (answers[q.id] === i ? " quiz-opt--on" : "")} onClick={() => choose(i)}>
                <span className="quiz-opt__key">{String.fromCharCode(65 + i)}</span>{opt}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { GuestbookPage, QuizPage });
