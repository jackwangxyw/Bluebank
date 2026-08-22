"""Local HTTP API for the practice UI.

Stdlib only. Binds to localhost by default; `--host 0.0.0.0` opens it to the
LAN and is the single change needed to put it behind a domain later.

The answer key, per-choice explanations, and rationale are never sent with a
question. They come back only in the response to a submitted answer, so they
cannot be read out of devtools before you answer.
"""
import json
import mimetypes
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from . import session
from .db import connect

# Anchored to the project root rather than the working directory, so `serve`
# works from anywhere.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_DIST = PROJECT_ROOT / "web" / "dist"
MAX_BODY = 1 << 20   # 1 MB is far more than any annotation set


class Api:
    """Route table. Each handler takes (conn, query, body) and returns JSON."""

    routes = []

    @classmethod
    def route(cls, method, pattern):
        compiled = re.compile(f"^{pattern}$")

        def register(fn):
            cls.routes.append((method, compiled, fn))
            return fn
        return register

    @classmethod
    def dispatch(cls, method, path, query, body, conn):
        for verb, pattern, fn in cls.routes:
            match = pattern.match(path)
            if match:
                if verb != method:
                    continue
                return fn(conn, query, body, *match.groups())
        return None


def _one(query, key, default=None):
    values = query.get(key)
    return values[0] if values else default


def _many(query, key):
    """Every value for a repeated query key, e.g. ?difficulty=M&difficulty=H."""
    return [v for v in query.get(key, []) if v]


@Api.route("GET", r"/api/taxonomy")
def _taxonomy(conn, query, body):
    return {"taxonomy": session.taxonomy(conn), "stats": session.stats(conn)}


@Api.route("GET", r"/api/set")
def _set(conn, query, body):
    rows = session.question_set(
        conn,
        section=_one(query, "section"), domains=_many(query, "domain"),
        skills=_many(query, "skill"), difficulties=_many(query, "difficulty"),
        statuses=_many(query, "status"), order=_one(query, "order", "shuffled"),
        exclude_live=_one(query, "exclude_live") == "1")
    return {"count": len(rows), "questions": rows}


@Api.route("GET", r"/api/sets")
def _sets(conn, query, body):
    """?active=1 for the ones still going, ?active=0 for finished, neither for all."""
    flag = _one(query, "active")
    active = None if flag is None else flag == "1"
    return {"sets": session.list_sets(
        conn, limit=int(_one(query, "limit", "50")), active=active)}


@Api.route("POST", r"/api/sets")
def _save_set(conn, query, body):
    """Create or update a set. The client owns the row and sends it back whole.

    The client mints the id, so a retry writes the same row rather than a
    second set.
    """
    set_id = body.get("id")
    if not set_id:
        raise ValueError("a set needs an id")
    return {"set": session.put_set(
        conn, set_id, body.get("items") or [], filters=body.get("filters"),
        seconds=body.get("seconds"), created_at=body.get("created_at"),
        finished_at=body.get("finished_at"), updated_at=body.get("updated_at"))}


@Api.route("GET", r"/api/sets/([^/]+)")
def _one_set(conn, query, body, set_id):
    found = session.get_set(conn, set_id)
    if found is None:
        raise KeyError(set_id)
    return {"set": found}


@Api.route("POST", r"/api/sets/([^/]+)/delete")
def _drop_set(conn, query, body, set_id):
    """Abandon a set. POST rather than DELETE because the handler has no do_DELETE."""
    session.delete_set(conn, set_id)
    return {"deleted": set_id}


@Api.route("GET", r"/api/mistakes")
def _mistakes(conn, query, body):
    return {"question_ids": session.logged_question_ids(conn)}


@Api.route("GET", r"/api/questions/([^/]+)/attempts")
def _attempts(conn, query, body, question_id):
    return {"attempts": session.attempts_for(conn, question_id)}


@Api.route("POST", r"/api/mistake/(?P<question_id>[^/]+)")
def _mistake(conn, query, body, question_id):
    return {"mistake": session.set_mistake(
        conn, question_id, tags=body.get("tags"), note=body.get("note"))}


def _flagged(conn, question_id):
    row = conn.execute("SELECT flagged FROM marks WHERE question_id = ?",
                       (question_id,)).fetchone()
    return bool(row and row["flagged"])


@Api.route("GET", r"/api/questions/([^/]+)")
def _question(conn, query, body, question_id):
    question = session.get_question(conn, question_id)
    return {
        "question": session.public_question(question),
        "annotations": session.get_annotations(conn, question_id),
        "flagged": _flagged(conn, question_id),
        "mistake": session.get_mistake(conn, question_id),
    }


@Api.route("POST", r"/api/questions/([^/]+)/answer")
def _answer(conn, query, body, question_id):
    result = session.submit(conn, question_id, body.get("response"),
                            seconds=body.get("seconds"))
    result.pop("question", None)
    return result


@Api.route("POST", r"/api/questions/([^/]+)/explain")
def _explain(conn, query, body, question_id):
    """The explanation for an answer already given, WITHOUT recording anything.

    `record=False` is the whole point: the review page re-grades the stored
    response only to get the rationale back, and must not add an attempt every
    time you expand a row.
    """
    result = session.submit(conn, question_id, body.get("response"), record=False)
    result.pop("question", None)
    return result


@Api.route("POST", r"/api/questions/([^/]+)/flag")
def _flag(conn, query, body, question_id):
    return {"flagged": session.set_flag(conn, question_id, body.get("flagged"))}


@Api.route("PUT", r"/api/questions/([^/]+)/annotations")
def _annotations(conn, query, body, question_id):
    return {"annotations": session.replace_annotations(
        conn, question_id, body.get("annotations") or [])}


@Api.route("GET", r"/api/stats")
def _stats(conn, query, body):
    return session.stats(conn)


@Api.route("GET", r"/api/review")
def _review(conn, query, body):
    limit = int(_one(query, "limit", "50"))
    rows = session.wrong_answers(conn, limit=limit)
    for row in rows:
        row["question"] = session.public_question(row["question"])
    return {"wrong": rows}


class Handler(BaseHTTPRequestHandler):
    server_version = "bluebank"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    # -- helpers ---------------------------------------------------------
    def _send(self, status, payload=None, raw=None, content_type="application/json"):
        if raw is None:
            raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        # The Vite dev server runs on another port; this is a localhost tool.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ValueError("request body too large")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    # -- verbs -----------------------------------------------------------
    def do_OPTIONS(self):
        self._send(204, raw=b"")

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def _handle(self, method):
        parsed = urlparse(self.path)
        path = parsed.path
        if not path.startswith("/api/"):
            return self._static(path)
        try:
            body = self._body() if method in ("POST", "PUT") else {}
            conn = connect(self.server.db_path)
            try:
                result = Api.dispatch(method, path, parse_qs(parsed.query), body, conn)
            finally:
                conn.close()
            if result is None:
                return self._send(404, {"error": f"no route for {method} {path}"})
            self._send(200, result)
        except KeyError as exc:
            self._send(404, {"error": f"unknown question {exc}"})
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"error": str(exc)})
        except Exception as exc:                      # surface it, do not swallow
            self._send(500, {"error": f"{type(exc).__name__}: {exc}"})

    def _static(self, path):
        """Serve the built frontend, falling back to index.html for SPA routes."""
        # Checked per request, so building the frontend while the server is
        # already running just works.
        root = self.server.web_root
        if root is None or not root.exists():
            return self._send(404, {"error": "frontend not built; run `npm run build` in web/"})
        target = (root / path.lstrip("/")).resolve()
        if not str(target).startswith(str(root.resolve())):
            return self._send(403, {"error": "path outside web root"})
        if target.is_dir() or not target.exists():
            target = root / "index.html"
        if not target.exists():
            return self._send(404, {"error": "index.html missing"})
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self._send(200, raw=target.read_bytes(), content_type=ctype)


def serve(host="127.0.0.1", port=8000, db_path=None, web_root=WEB_DIST,
          verbose=False):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.db_path = db_path
    httpd.web_root = Path(web_root) if web_root else None
    httpd.verbose = verbose
    where = "http://localhost:%d" % port if host in ("127.0.0.1", "localhost") \
        else "http://%s:%d" % (host, port)
    built = httpd.web_root and httpd.web_root.exists()
    print(f"  serving {where}")
    print(f"  frontend: {httpd.web_root if built else 'not built yet (API only)'}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped")
    finally:
        httpd.server_close()
