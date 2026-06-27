import React from "react";
import { go } from "@/lib/nav.js";
import { Store, useStore } from "@/lib/store.jsx";
import { postGuestbook, postQuiz } from "@/lib/api.js";
import { hasPlayedQuiz, markQuizPlayed, clearQuizPlayed } from "@/lib/quiz-attempt.js";
import { Button, Field, Icon, Input, Modal, Pager, SectionHead, Textarea, toast, useServerPaged } from "@/ui/components.jsx";
import { supabase } from "@/lib/supabase.js";
import { rowToGuestbook } from "@/lib/mappers.js";
import { PageHero } from "@/pages/PublicPages.jsx";
const { useState, useEffect, useRef, useMemo, useCallback, useReducer } = React;

// ============================================================================
// social.jsx — Guestbook + Couple Quiz
// ============================================================================

// Vary each guestbook card's attribution alignment (left / center / right) for a
// scattered, hand-pinned feel — deterministic per entry so it never reshuffles.
const GB_ALIGN = ["left", "center", "right"];
function gbAlign(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GB_ALIGN[h % 3];
}

export function GuestbookPage() {
  const [form, setForm] = useState({ name: "", relationship: "", message: "" });
  const [errors, setErrors] = useState({});
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Server-side pagination: fetch one page (30) of approved messages from the DB
  // at a time, with the total count for the page buttons. Never loads the whole list.
  const fetchPage = useCallback(async (from, to) => {
    const clientId = Store.get().clientId;
    if (!clientId) return { rows: [], count: 0 };
    const { data, count, error } = await supabase
      .from("guestbook").select("*", { count: "exact" }).eq("client_id", clientId).eq("status", "approved")
      // id tiebreaker → a total, stable order so pages never overlap
      // (rows sharing a created_at would otherwise repeat across pages).
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(from, to);
    if (error) { console.warn("[guestbook] load failed:", error.message); throw error; }
    return { rows: (data || []).map(rowToGuestbook), count: count || 0 };
  }, []);
  const gb = useServerPaged(fetchPage, 30);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((er) => ({ ...er, [k]: undefined })); };

  async function submit(e) {
    e.preventDefault();
    if (submitting) return;
    const er = {};
    if (!form.name.trim()) er.name = "Please enter your name.";
    if (!form.message.trim()) er.message = "Please write a short message.";
    if (form.message.length > 1000) er.message = "Please keep it under 1000 characters.";
    if (Object.keys(er).length) { setErrors(er); return; }
    setSubmitting(true);
    try {
      const { status } = await postGuestbook({ name: form.name, relationship: form.relationship, message: form.message });
      // If it's live immediately (auto-approve on), jump to page 1 and refetch so
      // the new message shows at the top.
      if (status === "approved") { gb.setPage(1); gb.reload(); }
      setForm({ name: "", relationship: "", message: "" });
      setOpen(false);
      toast(status === "approved" ? "Thank you for your message! \ud83d\udc95" : "Thank you! Your message will appear once the couple approves it.");
    } catch (err) {
      setErrors({ message: "Could not post right now. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fade-up">
      <PageHero eyebrow="Guestbook" title="Leave us a little love" lead="A note, a wish, a favorite memory — we'll treasure every word." />
      <section className="block" style={{ paddingTop: 8 }}>
        <div className="container">
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <Button variant="primary" size="lg" onClick={() => setOpen(true)}>{Icon.book({})} Sign the guestbook</Button>
          </div>

          {gb.total === 0 && !gb.loading ? (
            <div className="gal-empty"><p style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>No messages yet — be the first!</p></div>
          ) : (
            <div className="gb-grid">
              {gb.items.map((g) => {
                const align = gbAlign(g.id);
                const short = (g.message || "").length <= 70; // ~1-2 lines on mobile
                return (
                <div className={"gb-card gb-card--" + align + (short ? " gb-card--short" : "")} key={g.id}>
                  <div className="gb-card__quote" aria-hidden="true">&ldquo;</div>
                  <p className="gb-card__msg">{g.message}</p>
                  <div className="gb-card__attr">
                    <span className="gb-card__dash" aria-hidden="true">&mdash;</span>
                    <div className="gb-card__who">
                      <div className="gb-card__by">{g.name}</div>
                      {g.relationship && <div className="gb-card__rel">{g.relationship}</div>}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
          <Pager page={gb.page} totalPages={gb.totalPages} total={gb.total} perPage={gb.perPage} start={gb.start} noun="messages"
            onPage={(p) => { gb.setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
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
          <Button type="submit" variant="primary" block disabled={submitting}>{submitting ? "Posting…" : "Post message"}</Button>
        </form>
      </Modal>
    </div>
  );
}

// --- Quiz ------------------------------------------------------------------
export function QuizPage() {
  const { quiz } = useStore();
  // One attempt per device: start locked if this browser already finished the
  // quiz for this client. `?retake=1` clears the flag (owner re-demo escape hatch).
  const [stage, setStage] = useState(() => {
    const retake = new URLSearchParams(window.location.search).get("retake") === "1";
    if (retake) { clearQuizPlayed(); return "intro"; }
    return hasPlayedQuiz() ? "locked" : "intro";
  }); // intro | playing | result | locked
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
  async function finish(finalAnswers) {
    let score = 0;
    const detail = quiz.map((qq) => {
      const sel = finalAnswers[qq.id];
      const correct = sel === qq.answer;
      if (correct) score++;
      return { questionId: qq.id, selected: sel, isCorrect: correct };
    });
    try {
      await postQuiz({ name: name.trim(), score, total, answers: detail });
    } catch (err) {
      console.error("Could not save quiz score.", err);
      toast("Score couldn't be saved, but here's how you did!");
    }
    markQuizPlayed(); // lock this device from replaying
    setStage("result");
  }

  if (stage === "locked") {
    return (
      <div className="fade-up">
        <PageHero eyebrow="Couple Quiz" title="How well do you know us?" lead="Five quick questions about the happy couple." />
        <section className="block" style={{ paddingTop: 12 }}>
          <div className="container container--narrow">
            <div className="card card--pad-lg" style={{ textAlign: "center" }}>
              <div style={{ color: "var(--accent)", marginBottom: 16 }}>{Icon.quiz({ style: { width: 48, height: 48, margin: "0 auto" } })}</div>
              <h2 style={{ fontSize: 30, margin: "4px 0 8px" }}>You already played! 🎉</h2>
              <p style={{ color: "var(--ink-soft)", maxWidth: "40ch", margin: "0 auto" }}>Thanks for taking the couple quiz — one go per guest. We hope you had fun!</p>
            </div>
          </div>
        </section>
      </div>
    );
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
                {/* No "Play again" — one attempt per guest (the quiz locks after this). */}
                <Button variant="primary" onClick={() => go("guestbook")}>Sign the guestbook</Button>
                <Button variant="ghost" onClick={() => go("home")}>Back to home</Button>
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

