import { useCallback, useEffect, useRef, useState } from "react";

const API = (import.meta.env.VITE_API_URL || "https://modcomexam.alwaysdata.net").replace(/\/$/, "");

async function api(path, { method = "GET", body, headers } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
  return data;
}

const pad = (n) => String(n).padStart(2, "0");
const fmt = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

export default function App() {
  const [teacher, setTeacher] = useState(location.hash === "#/teacher");
  useEffect(() => {
    const f = () => setTeacher(location.hash === "#/teacher");
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return teacher ? <Teacher /> : <Student />;
}

/* ---------------- Student ---------------- */

function Student() {
  const [sess, setSess] = useState(null);
  const [answers, setAnswers] = useState({});
  const [secs, setSecs] = useState(0);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const token = useRef(localStorage.getItem("exam_token"));
  const dirty = useRef(false);
  const latest = useRef({});
  const closing = useRef(false);

  const begin = useCallback((d) => {
    token.current = d.token;
    localStorage.setItem("exam_token", d.token);
    latest.current = d.answers || {};
    setAnswers(d.answers || {});
    setSecs(d.seconds_left);
    setSess(d);
  }, []);

  useEffect(() => {
    if (!token.current) return setBusy(false);
    api("/api/exam", { headers: { Authorization: `Bearer ${token.current}` } })
      .then(begin)
      .catch(() => localStorage.removeItem("exam_token"))
      .finally(() => setBusy(false));
  }, [begin]);

  const auth = () => ({ Authorization: `Bearer ${token.current}` });

  const save = useCallback(async () => {
    try {
      const r = await api("/api/answers", { method: "PUT", headers: auth(), body: { answers: latest.current } });
      dirty.current = false;
      setSecs(r.seconds_left);
      setStatus("Saved");
    } catch (e) {
      setStatus(e.status === 409 ? "Exam closed" : "Not saved. Check your connection.");
    }
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    setStatus("Saving...");
    const t = setTimeout(save, 1200);
    return () => clearTimeout(t);
  }, [answers, save]);

  const finish = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    await save();
    try {
      await api("/api/submit", { method: "POST", headers: auth() });
      setSess((s) => ({ ...s, submitted: true, exam: null }));
    } catch {
      closing.current = false;
      setStatus("Submit failed. Try again.");
    }
  }, [save]);

  useEffect(() => {
    if (!sess || sess.submitted) return;
    if (secs <= 0) {
      finish();
      return;
    }
    const t = setTimeout(() => setSecs((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secs, sess, finish]);

  const set = (n, v) => {
    dirty.current = true;
    latest.current = { ...latest.current, [n]: v };
    setAnswers(latest.current);
  };

  const start = async (e) => {
    e.preventDefault();
    setErr("");
    const f = new FormData(e.target);
    try {
      begin(await api("/api/start", { method: "POST", body: Object.fromEntries(f) }));
    } catch (x) {
      setErr(x.message);
    }
  };

  if (busy) return <main className="narrow"><p>Loading...</p></main>;

  if (!sess)
    return (
      <main className="narrow">
        <h1>AI and Machine Learning Exam</h1>
        <p className="muted">100 marks. 2 hours. Your timer starts when you press Start exam.</p>
        <form onSubmit={start} className="login">
          <label>Full name<input name="name" required autoComplete="off" /></label>
          <label>Admission number<input name="adm" required autoComplete="off" /></label>
          <label>Exam code<input name="code" required autoComplete="off" /></label>
          {err && <p className="error">{err}</p>}
          <button className="primary">Start exam</button>
        </form>
      </main>
    );

  if (sess.submitted)
    return (
      <main className="narrow">
        <h1>Exam submitted</h1>
        <p>Thank you, {sess.name}. Your answers have been saved. You can close this page.</p>
      </main>
    );

  const all = sess.exam.sections.flatMap((s) => s.questions);
  const answered = all.filter((q) => answers[q.n] !== undefined && answers[q.n] !== "").length;

  return (
    <>
      <header className="bar">
        <div>
          <strong>{sess.name}</strong>
          <span className="muted"> {answered} of {all.length} answered. {status}</span>
        </div>
        <div className={"timer" + (secs < 300 ? " low" : "")}>{fmt(secs)}</div>
      </header>
      <main className="paper">
        {sess.exam.sections.map((s) => (
          <section key={s.id}>
            <h2>{s.title}</h2>
            <p className="muted">{s.note}</p>
            {s.questions.map((q) => (
              <article key={q.n} className="q">
                <p className="qtext"><b>{q.n}.</b> {q.text}</p>
                {s.type === "mcq" ? (
                  q.options.map((o, i) => (
                    <label key={i} className="opt">
                      <input type="radio" name={"q" + q.n} checked={answers[q.n] === i} onChange={() => set(q.n, i)} />
                      <span>{"ABCD"[i]}. {o}</span>
                    </label>
                  ))
                ) : (
                  <textarea rows={4} value={answers[q.n] || ""} onChange={(e) => set(q.n, e.target.value)} placeholder="Type your answer here" />
                )}
              </article>
            ))}
          </section>
        ))}
        <button
          className="primary big"
          onClick={() => window.confirm(`You have answered ${answered} of ${all.length} questions. Submit now? You cannot change answers afterwards.`) && finish()}
        >
          Submit exam
        </button>
      </main>
    </>
  );
}

/* ---------------- Teacher ---------------- */

function Teacher() {
  const [pw, setPw] = useState(sessionStorage.getItem("tpw") || "");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({});
  const [err, setErr] = useState("");

  const load = useCallback(async (p) => {
    try {
      const d = await api("/api/teacher/attempts", { headers: { "X-Teacher-Password": p } });
      sessionStorage.setItem("tpw", p);
      setData(d);
      setErr("");
    } catch {
      setErr("Wrong password or server unreachable.");
      sessionStorage.removeItem("tpw");
    }
  }, []);

  useEffect(() => { if (pw) load(pw); }, []); // eslint-disable-line

  if (!data)
    return (
      <main className="narrow">
        <h1>Teacher login</h1>
        <form className="login" onSubmit={(e) => { e.preventDefault(); load(pw); }}>
          <label>Password<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {err && <p className="error">{err}</p>}
          <button className="primary">Open</button>
        </form>
      </main>
    );

  const written = data.exam.sections.filter((s) => s.type === "written");
  const secTotal = (r, s) => s.questions.reduce((t, q) => t + (r.marks[q.n] || 0), 0);

  const toggle = (r) => {
    setOpen(open === r.id ? null : r.id);
    setDraft(r.marks);
  };

  const saveMarks = async (r) => {
    const res = await api(`/api/teacher/marks/${r.id}`, { method: "PUT", headers: { "X-Teacher-Password": pw }, body: { marks: draft } });
    setData((d) => ({ ...d, rows: d.rows.map((x) => (x.id === r.id ? { ...x, marks: draft, total: res.total } : x)) }));
  };

  const csv = () => {
    const head = ["Name", "Admission", "Submitted", "A", ...written.map((s) => s.id), "Total"];
    const lines = data.rows.map((r) => [r.name, r.adm, r.submitted ? "yes" : "no", r.score_a, ...written.map((s) => secTotal(r, s)), r.total]);
    const text = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = "exam-results.csv";
    a.click();
  };

  return (
    <main className="wide">
      <div className="row">
        <h1>Submissions ({data.rows.length})</h1>
        <div>
          <button onClick={() => load(pw)}>Refresh</button> <button onClick={csv}>Download CSV</button>
        </div>
      </div>
      <table>
        <thead>
          <tr><th>Name</th><th>Admission</th><th>Status</th><th>A /20</th>{written.map((s) => <th key={s.id}>{s.id}</th>)}<th>Total /100</th></tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <FragmentRow key={r.id} r={r} written={written} secTotal={secTotal} open={open === r.id} toggle={() => toggle(r)} draft={draft} setDraft={setDraft} saveMarks={() => saveMarks(r)} />
          ))}
        </tbody>
      </table>
    </main>
  );
}

function FragmentRow({ r, written, secTotal, open, toggle, draft, setDraft, saveMarks }) {
  return (
    <>
      <tr className="click" onClick={toggle}>
        <td>{r.name}</td><td>{r.adm}</td><td>{r.submitted ? "Submitted" : "In progress"}</td><td>{r.score_a}</td>
        {written.map((s) => <td key={s.id}>{secTotal(r, s)}</td>)}
        <td><b>{r.total}</b></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5 + written.length}>
            {written.map((s) => (
              <div key={s.id}>
                <h3>{s.title}</h3>
                {s.questions.map((q) => (
                  <div key={q.n} className="mark">
                    <p className="qtext"><b>{q.n}.</b> {q.text.split("\n")[0]}</p>
                    <p className="ans">{r.answers[q.n] || <i>No answer</i>}</p>
                    <label>Marks{" "}
                      <select value={draft[q.n] ?? 0} onChange={(e) => setDraft({ ...draft, [q.n]: Number(e.target.value) })}>
                        {Array.from({ length: q.marks + 1 }, (_, i) => <option key={i}>{i}</option>)}
                      </select> / {q.marks}
                    </label>
                  </div>
                ))}
              </div>
            ))}
            <button className="primary" onClick={saveMarks}>Save marks</button>
          </td>
        </tr>
      )}
    </>
  );
}
