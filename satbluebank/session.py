"""Practice-session logic: pick a question, grade a response, record the
attempt, and assemble the review payload the UI will render.
"""
import json
import random
import time

from . import grading


def _row_to_question(row):
    return {
        "id": row["id"],
        "section": row["section"],
        "domain": row["domain"],
        "domain_name": row["domain_name"],
        "skill": row["skill"],
        "skill_name": row["skill_name"],
        "difficulty": row["difficulty"],
        "band": row["band"],
        "type": row["type"],
        "stimulus_html": row["stimulus_html"],
        "stem_html": row["stem_html"],
        "options": json.loads(row["options_json"]) if row["options_json"] else None,
        "correct": json.loads(row["correct_json"]),
        "explanations": json.loads(row["explanations_json"]) if row["explanations_json"] else None,
        "rationale_html": row["rationale_html"],
        "key_recovered": bool(row["key_recovered"]),
        "source_path": row["source_path"],
    }


def get_question(conn, question_id):
    row = conn.execute("SELECT * FROM questions WHERE id = ?", (question_id,)).fetchone()
    if row is None:
        raise KeyError(question_id)
    return _row_to_question(row)


def pick(conn, section=None, domain=None, difficulty=None, skill=None,
         unseen_only=False, seed=None):
    """Pick one random live question matching the filters."""
    where = ["retired = 0"]
    params = []
    for column, value in (("section", section), ("domain", domain),
                          ("difficulty", difficulty), ("skill", skill)):
        if value:
            where.append(f"{column} = ?")
            params.append(value)
    if unseen_only:
        where.append("id NOT IN (SELECT question_id FROM attempts)")
    rows = conn.execute(
        f"SELECT * FROM questions WHERE {' AND '.join(where)}", params).fetchall()
    if not rows:
        return None
    return _row_to_question(random.Random(seed).choice(rows))


def submit(conn, question_id, response, seconds=None, record=True):
    """Grade a response against the official key and record the attempt."""
    question = get_question(conn, question_id)
    result = grading.grade(question, response)
    result["question"] = question

    if record:
        conn.execute(
            "INSERT INTO attempts (question_id, answered_at, response, correct, seconds)"
            " VALUES (?,?,?,?,?)",
            (question_id, int(time.time()), None if response is None else str(response),
             int(result["correct"]), seconds))
        conn.commit()
    return result


PUBLIC_HIDDEN = ("correct", "explanations", "rationale_html")


def public_question(question):
    """The question as the practice UI may see it before answering.

    The key, the per-choice explanations, and the rationale are withheld until
    a response is submitted, so they cannot be read out of devtools.
    """
    return {k: v for k, v in question.items() if k not in PUBLIC_HIDDEN}


def _filter_sql(section=None, domain=None, skill=None, difficulty=None,
                status=None):
    where = ["q.retired = 0"]
    params = []
    for column, value in (("section", section), ("domain", domain),
                          ("skill", skill), ("difficulty", difficulty)):
        if value:
            where.append(f"q.{column} = ?")
            params.append(value)
    if status == "unseen":
        where.append("last.question_id IS NULL")
    elif status == "wrong":
        where.append("last.correct = 0")
    elif status == "correct":
        where.append("last.correct = 1")
    elif status == "flagged":
        where.append("m.flagged = 1")
    return " AND ".join(where), params


# Latest attempt per question, for navigator state and the wrong-answer set.
_LAST_ATTEMPT = """
    LEFT JOIN (
        SELECT question_id, response, correct, seconds, answered_at
        FROM (SELECT *, ROW_NUMBER() OVER
                     (PARTITION BY question_id ORDER BY answered_at DESC, id DESC) rn
              FROM attempts)
        WHERE rn = 1
    ) last ON last.question_id = q.id
    LEFT JOIN marks m ON m.question_id = q.id
"""


def question_set(conn, section=None, domain=None, skill=None, difficulty=None,
                 status=None, order="natural"):
    """The ordered working set the navigator paginates over.

    Returns one lightweight row per question: enough to draw the navigator grid
    without shipping 3,767 question bodies.
    """
    where, params = _filter_sql(section, domain, skill, difficulty, status)
    ordering = {
        "natural": "q.section, q.domain, q.skill, q.difficulty, q.id",
        "difficulty": "q.band, q.section, q.domain, q.id",
        "id": "q.id",
    }.get(order, "q.section, q.domain, q.skill, q.difficulty, q.id")

    rows = conn.execute(f"""
        SELECT q.id, q.section, q.domain, q.domain_name, q.skill, q.skill_name,
               q.difficulty, q.band, q.type,
               last.correct AS last_correct, last.seconds AS last_seconds,
               last.response AS last_response, last.answered_at,
               COALESCE(m.flagged, 0) AS flagged,
               -- Drives the navigator colour: right first time reads differently
               -- from right after three goes.
               (SELECT COUNT(*) FROM attempts a WHERE a.question_id = q.id)
                   AS attempt_count
        FROM questions q {_LAST_ATTEMPT}
        WHERE {where} ORDER BY {ordering}""", params).fetchall()
    return [dict(r) for r in rows]


def taxonomy(conn):
    """Sections, domains, and skills with live counts, for the filter panel."""
    rows = conn.execute("""
        SELECT q.section, q.domain, q.domain_name, q.skill, q.skill_name,
               q.difficulty, COUNT(*) n,
               SUM(CASE WHEN last.question_id IS NOT NULL THEN 1 ELSE 0 END) seen,
               SUM(COALESCE(last.correct, 0)) correct
        FROM questions q {join}
        WHERE q.retired = 0
        GROUP BY q.section, q.domain, q.skill, q.difficulty
        ORDER BY q.section, q.domain, q.skill, q.difficulty
    """.format(join=_LAST_ATTEMPT)).fetchall()
    return [dict(r) for r in rows]


def set_flag(conn, question_id, flagged):
    conn.execute("""
        INSERT INTO marks (question_id, flagged, updated_at) VALUES (?,?,?)
        ON CONFLICT(question_id) DO UPDATE SET
            flagged = excluded.flagged, updated_at = excluded.updated_at
    """, (question_id, int(bool(flagged)), int(time.time())))
    conn.commit()
    return bool(flagged)


def get_annotations(conn, question_id):
    rows = conn.execute(
        "SELECT id, field, start_offset, end_offset, color, note "
        "FROM annotations WHERE question_id = ? ORDER BY field, start_offset",
        (question_id,)).fetchall()
    return [dict(r) for r in rows]


def replace_annotations(conn, question_id, annotations):
    """Annotations are saved as a whole set for one question; the editor owns
    the list and sends it back after every change."""
    conn.execute("DELETE FROM annotations WHERE question_id = ?", (question_id,))
    now = int(time.time())
    for a in annotations:
        start, end = int(a["start_offset"]), int(a["end_offset"])
        if end <= start:
            raise ValueError(f"annotation end {end} must be after start {start}")
        conn.execute(
            "INSERT INTO annotations (question_id, field, start_offset, end_offset,"
            " color, note, created_at) VALUES (?,?,?,?,?,?,?)",
            (question_id, a["field"], start, end,
             a.get("color") or "yellow", a.get("note"), now))
    conn.commit()
    return get_annotations(conn, question_id)


def stats(conn):
    row = conn.execute(
        "SELECT COUNT(*) n, SUM(correct) c FROM attempts").fetchone()
    total, correct = row["n"] or 0, row["c"] or 0
    by_domain = conn.execute("""
        SELECT q.domain, q.domain_name, COUNT(*) n, SUM(a.correct) c
        FROM attempts a JOIN questions q ON q.id = a.question_id
        GROUP BY q.domain ORDER BY n DESC""").fetchall()
    return {
        "attempts": total,
        "correct": correct,
        "accuracy": (correct / total) if total else None,
        "by_domain": [dict(r) for r in by_domain],
    }


def wrong_answers(conn, limit=50):
    """Questions most recently answered incorrectly, for review."""
    rows = conn.execute("""
        SELECT q.*, a.response, a.answered_at
        FROM attempts a JOIN questions q ON q.id = a.question_id
        WHERE a.correct = 0
        ORDER BY a.answered_at DESC LIMIT ?""", (limit,)).fetchall()
    out = []
    for row in rows:
        question = _row_to_question(row)
        result = grading.grade(question, row["response"])
        result["question"] = question
        result["answered_at"] = row["answered_at"]
        out.append(result)
    return out
