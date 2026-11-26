import os, json, hmac, secrets, datetime as dt
from functools import wraps
from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///exam.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
# CORS(app)

CORS(app, resources={r"/api/*": {"origins": "*"}})
db = SQLAlchemy(app)

TEACHER_PASSWORD = os.environ.get("TEACHER_PASSWORD", "")
EXAM_CODE = os.environ.get("EXAM_CODE", "")
with open(os.path.join(os.path.dirname(__file__), "questions.json"), encoding="utf-8") as f:
    EXAM = json.load(f)
DURATION, GRACE = EXAM["duration_minutes"] * 60, 10
MCQ = {q["n"]: q["answer"] for s in EXAM["sections"] if s["type"] == "mcq" for q in s["questions"]}
WRITTEN = {q["n"]: q["marks"] for s in EXAM["sections"] if s["type"] == "written" for q in s["questions"]}


class Attempt(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    adm = db.Column(db.String(60), unique=True, nullable=False)
    token = db.Column(db.String(64), unique=True, nullable=False)
    started_at = db.Column(db.DateTime, nullable=False)
    submitted = db.Column(db.Boolean, default=False)
    answers = db.Column(db.Text, default="{}")
    score_a = db.Column(db.Integer, default=0)
    marks = db.Column(db.Text, default="{}")


with app.app_context():
    db.create_all()


def now():
    return dt.datetime.utcnow()


def left(a):
    return DURATION - int((now() - a.started_at).total_seconds())


def finalize(a):
    ans = json.loads(a.answers or "{}")
    a.score_a = 2 * sum(1 for n, k in MCQ.items() if ans.get(str(n)) == k)
    a.submitted = True
    db.session.commit()


def public_exam():
    out = json.loads(json.dumps(EXAM))
    for s in out["sections"]:
        for q in s["questions"]:
            q.pop("answer", None)
    return out


def student(fn):
    @wraps(fn)
    def w(*args, **kw):
        t = request.headers.get("Authorization", "").replace("Bearer ", "")
        a = Attempt.query.filter_by(token=t).first() if t else None
        if not a:
            abort(401)
        if not a.submitted and left(a) < -GRACE:
            finalize(a)
        return fn(a, *args, **kw)
    return w


def teacher(fn):
    @wraps(fn)
    def w(*args, **kw):
        pw = request.headers.get("X-Teacher-Password", "")
        if not TEACHER_PASSWORD or not hmac.compare_digest(pw, TEACHER_PASSWORD):
            abort(401)
        return fn(*args, **kw)
    return w


def state(a):
    return {"token": a.token, "name": a.name, "submitted": a.submitted,
            "seconds_left": max(0, left(a)), "answers": json.loads(a.answers or "{}"),
            "exam": None if a.submitted else public_exam()}


@app.post("/api/start")
def start():
    d = request.get_json(force=True)
    name, adm, code = (d.get("name") or "").strip(), (d.get("adm") or "").strip(), (d.get("code") or "").strip()
    if not name or not adm:
        return jsonify(error="Enter your name and admission number."), 400
    if EXAM_CODE and not hmac.compare_digest(code, EXAM_CODE):
        return jsonify(error="Wrong exam code."), 403
    a = Attempt.query.filter_by(adm=adm).first()
    if a and a.name.lower() != name.lower():
        return jsonify(error="This admission number is already registered under another name."), 409
    if not a:
        a = Attempt(name=name, adm=adm, token=secrets.token_hex(24), started_at=now())
        db.session.add(a)
        db.session.commit()
    if not a.submitted and left(a) < -GRACE:
        finalize(a)
    return jsonify(state(a))


@app.get("/api/exam")
@student
def exam(a):
    return jsonify(state(a))


@app.put("/api/answers")
@student
def save(a):
    if a.submitted or left(a) < -GRACE:
        return jsonify(error="Exam closed."), 409
    clean = {}
    for k, v in (request.get_json(force=True).get("answers") or {}).items():
        if k.isdigit() and int(k) in MCQ and isinstance(v, int):
            clean[k] = v
        elif k.isdigit() and int(k) in WRITTEN and isinstance(v, str):
            clean[k] = v[:5000]
    a.answers = json.dumps(clean)
    db.session.commit()
    return jsonify(ok=True, seconds_left=max(0, left(a)))


@app.post("/api/submit")
@student
def submit(a):
    if not a.submitted:
        finalize(a)
    return jsonify(ok=True)


@app.get("/api/teacher/attempts")
@teacher
def attempts():
    rows = []
    for a in Attempt.query.order_by(Attempt.started_at).all():
        if not a.submitted and left(a) < -GRACE:
            finalize(a)
        marks = json.loads(a.marks or "{}")
        rows.append({"id": a.id, "name": a.name, "adm": a.adm, "submitted": a.submitted,
                     "score_a": a.score_a, "answers": json.loads(a.answers or "{}"), "marks": marks,
                     "total": a.score_a + sum(marks.values())})
    return jsonify(rows=rows, exam=EXAM)


@app.put("/api/teacher/marks/<int:aid>")
@teacher
def marks(aid):
    a = db.session.get(Attempt, aid) or abort(404)
    m = {}
    for k, v in (request.get_json(force=True).get("marks") or {}).items():
        if k.isdigit() and int(k) in WRITTEN:
            m[k] = max(0, min(WRITTEN[int(k)], int(v)))
    a.marks = json.dumps(m)
    db.session.commit()
    return jsonify(total=a.score_a + sum(m.values()))


@app.get("/api/health")
def health():
    return jsonify(ok=True)
