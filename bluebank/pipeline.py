"""The three passes: index, fetch, normalize.

They are kept separate so that fixing the normalizer costs seconds instead of
another full crawl. Pass 2 is resumable; pass 3 is a pure offline function of
what is on disk.
"""
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import api, rationale
from .db import connect

DATA = Path("data")
RAW = Path("raw")
INDEX_PATH = DATA / "index.json"
LIVE_PATH = DATA / "live.json"

CONCURRENCY = 5   # measured at 12.2 req/s with no throttling; no reason to push


# --------------------------------------------------------------------------
# Pass 1: index
# --------------------------------------------------------------------------

def build_index():
    DATA.mkdir(parents=True, exist_ok=True)
    stubs = []
    for test, section in ((api.RW, "RW"), (api.MATH, "MATH")):
        rows = api.fetch_index(test)
        for row in rows:
            row["_section"] = section
        stubs.extend(rows)
        print(f"  {section}: {len(rows)} stubs")

    for stub in stubs:
        # The unused path field is an empty string, not null. Test truthiness.
        ext, ibn = stub.get("external_id"), stub.get("ibn")
        if bool(ext) == bool(ibn):
            raise ValueError(f"stub {stub.get('questionId')}: expected exactly one of "
                             f"external_id/ibn, got ext={ext!r} ibn={ibn!r}")
        stub["_id"] = ext or ibn
        stub["_path"] = "external_id" if ext else "ibn"

    # A few external_ids appear twice under different questionIds with
    # different updateDates. Keep the newest so the refresh check compares
    # against a stable value.
    unique = {}
    for stub in sorted(stubs, key=lambda s: s["updateDate"]):
        unique[stub["_id"]] = stub
    duplicates = len(stubs) - len(unique)
    stubs = list(unique.values())

    INDEX_PATH.write_text(json.dumps(stubs), encoding="utf-8")
    print(f"  total {len(stubs)} unique questions"
          + (f" ({duplicates} duplicate ids collapsed)" if duplicates else "")
          + f" -> {INDEX_PATH}")

    _write_live()
    return stubs


def _write_live():
    """Save the practice-test question ids next to the index.

    Fetched here, in pass 1, rather than in pass 3, because normalize is a pure
    function of what is already on disk and it is worth keeping it that way. A
    failure is not fatal: the flag is a nicety and the whole bank is still
    usable without it.
    """
    try:
        lookup = api.fetch_lookup()
    except Exception as exc:
        print(f"  live items unavailable ({exc}); "
              f"the practice-test filter will be empty until the next index")
        return
    live = {
        "RW": sorted(set(lookup.get("readingLiveItems") or [])),
        "MATH": sorted(set(lookup.get("mathLiveItems") or [])),
    }
    LIVE_PATH.write_text(json.dumps(live), encoding="utf-8")
    print(f"  {len(live['RW'])} RW + {len(live['MATH'])} Math questions are on "
          f"official practice tests -> {LIVE_PATH}")


def load_live():
    """{section: set of external_ids}. Empty when the file has not been written."""
    if not LIVE_PATH.exists():
        return {"RW": set(), "MATH": set()}
    raw = json.loads(LIVE_PATH.read_text(encoding="utf-8"))
    return {"RW": set(raw.get("RW") or []), "MATH": set(raw.get("MATH") or [])}


def is_live(stub, live):
    """Is this question also on an official full-length practice test?

    Two rules, both taken from how the bank's own filter behaves. The lists are
    external_ids, so an `ibn` item can never be on one however the lists change.
    And each list is checked against its own section only, so a Reading id that
    happened to collide with a Math id could not take the Math question out.
    """
    if stub["_path"] != "external_id":
        return False
    return stub["_id"] in live.get(stub["_section"], ())


def load_index():
    if not INDEX_PATH.exists():
        raise FileNotFoundError(f"{INDEX_PATH} missing; run `index` first")
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------
# Pass 2: fetch
# --------------------------------------------------------------------------

def _raw_path(stub):
    return RAW / stub["_path"] / f"{stub['_id']}.json"


def _stale(stub, conn):
    """Refetch when the file is absent or the bank's updateDate moved past
    what we stored."""
    path = _raw_path(stub)
    if not path.exists():
        return True
    if conn is None:
        return False
    row = conn.execute("SELECT update_date FROM questions WHERE id = ?",
                       (stub["_id"],)).fetchone()
    return row is not None and stub["updateDate"] > row["update_date"]


def fetch_details(stubs, force=False, conn=None):
    for sub in ("external_id", "ibn"):
        (RAW / sub).mkdir(parents=True, exist_ok=True)

    todo = stubs if force else [s for s in stubs if _stale(s, conn)]
    print(f"  {len(todo)} to fetch, {len(stubs) - len(todo)} already current")
    if not todo:
        return []

    errors = []
    done = 0
    started = time.time()

    def one(stub):
        try:
            if stub["_path"] == "external_id":
                data = api.fetch_external(stub["_id"])
            else:
                data = api.fetch_ibn(stub["_id"])
            _raw_path(stub).write_text(json.dumps(data), encoding="utf-8")
            return None
        except Exception as exc:
            return (stub["_id"], str(exc))

    with ThreadPoolExecutor(CONCURRENCY) as pool:
        for result in pool.map(one, todo):
            done += 1
            if result:
                errors.append(result)
            if done % 250 == 0 or done == len(todo):
                rate = done / max(time.time() - started, 1e-9)
                print(f"  {done}/{len(todo)}  {rate:.1f} req/s  {len(errors)} errors")

    if errors:
        print(f"  {len(errors)} failed; rerun `fetch` to retry (resumable)")
        for qid, msg in errors[:5]:
            print(f"    {qid}: {msg}")
    return errors


# --------------------------------------------------------------------------
# Pass 3: normalize
# --------------------------------------------------------------------------

def _normalize_external(stub, raw):
    flags = []
    raw_options = raw.get("answerOptions") or []
    options = [{"label": chr(65 + i), "html": opt.get("content", "")}
               for i, opt in enumerate(raw_options)]
    correct = list(raw.get("correct_answer") or [])
    qtype = raw.get("type") or ("mcq" if options else "spr")

    # `keys` holds the option uuid of the answer; it must point at the same
    # option the `correct_answer` letter does.
    if qtype == "mcq" and correct and raw.get("keys"):
        index = ord(str(correct[0]).strip().upper()) - 65
        if not (0 <= index < len(raw_options)) or raw_options[index]["id"] != raw["keys"][0]:
            flags.append("keys_letter_disagreement")

    if not correct:
        flags.append("no_answer_key")

    return {
        "type": qtype,
        "stimulus_html": raw.get("stimulus") or "",
        "stem_html": raw.get("stem") or "",
        "options": options,
        "correct": correct,
        "rationale_html": raw.get("rationale") or "",
        "key_recovered": 0,
        "flags": flags,
    }


def _normalize_ibn(stub, raw):
    """The legacy path: one HTML blob, lowercase choice keys, and sometimes no
    answer key at all."""
    flags = []
    answer = raw.get("answer") or {}
    style = (answer.get("style") or "").strip().lower()
    qtype = "mcq" if style == "multiple choice" else "spr"

    choices = answer.get("choices") or {}
    options = [{"label": k.upper(), "html": (v or {}).get("body", "")}
               for k, v in sorted(choices.items())]
    if qtype == "mcq":
        labels = [o["label"] for o in options]
        if labels != [chr(65 + i) for i in range(len(labels))]:
            flags.append("unexpected_choice_labels_" + "".join(labels))

    rationale_html = answer.get("rationale") or ""
    key = answer.get("correct_choice")
    key_recovered = 0
    correct = []

    if qtype == "mcq":
        if key:
            correct = [str(key).strip().upper()]
        else:
            letter, rflags = rationale.recover_mcq_answer(rationale_html)
            flags.extend(rflags)
            if letter:
                correct, key_recovered = [letter], 1
    else:
        if key:
            correct = [str(key).strip()]
        else:
            values, rflags = rationale.recover_spr_answers(rationale_html)
            flags.extend(rflags)
            if values:
                correct, key_recovered = values, 1

    if not correct:
        flags.append("no_answer_key")

    # `body` carries the stimulus (class="stimulus_reference") on the items that
    # have one: the table, figure, or expression the stem refers to. One item
    # has no `prompt` at all and puts the whole question in `body`.
    stimulus_html = raw.get("body") or ""
    stem_html = raw.get("prompt") or ""
    if not stem_html.strip():
        stimulus_html, stem_html = "", stimulus_html
        if not stem_html.strip():
            flags.append("empty_stem")

    return {
        "type": qtype,
        "stimulus_html": stimulus_html,
        "stem_html": stem_html,
        "options": options,
        "correct": correct,
        "rationale_html": rationale_html,
        "key_recovered": key_recovered,
        "flags": flags,
    }


REQUIRED_IMPORT_FIELDS = ("id", "section", "domain", "skill", "difficulty",
                          "type", "stem_html", "correct", "rationale_html")


def import_questions(json_path, db_path=None):
    """Load questions from a JSON array against the normalized schema.

    The escape hatch for the day the API adds auth or changes shape. It takes
    the normalized shape, not either raw shape, and validates before writing.
    """
    rows = json.loads(Path(json_path).read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("expected a JSON array of questions")

    conn = connect(db_path) if db_path else connect()
    for i, row in enumerate(rows):
        missing = [f for f in REQUIRED_IMPORT_FIELDS if not row.get(f)]
        if missing:
            raise ValueError(f"question {i} ({row.get('id')!r}) missing: {', '.join(missing)}")
        if row["type"] not in ("mcq", "spr"):
            raise ValueError(f"question {row['id']}: type must be mcq or spr")
        if row["section"] not in ("RW", "MATH"):
            raise ValueError(f"question {row['id']}: section must be RW or MATH")
        if not isinstance(row["correct"], list) or not row["correct"]:
            raise ValueError(f"question {row['id']}: correct must be a non-empty array")

        conn.execute("""
            INSERT INTO questions (id, source_path, section, domain, domain_name,
                skill, skill_name, difficulty, band, type, stimulus_html, stem_html,
                options_json, correct_json, rationale_html, explanations_json,
                key_recovered, flags_json, update_date, retired)
            VALUES (?,'import',?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,?,0)
            ON CONFLICT(id) DO UPDATE SET
                section=excluded.section, domain=excluded.domain,
                domain_name=excluded.domain_name, skill=excluded.skill,
                skill_name=excluded.skill_name, difficulty=excluded.difficulty,
                band=excluded.band, type=excluded.type,
                stimulus_html=excluded.stimulus_html, stem_html=excluded.stem_html,
                options_json=excluded.options_json, correct_json=excluded.correct_json,
                rationale_html=excluded.rationale_html,
                explanations_json=excluded.explanations_json,
                update_date=excluded.update_date, retired=0
        """, (
            row["id"], row["section"], row["domain"],
            row.get("domain_name") or api.DOMAIN_NAMES.get(row["domain"], row["domain"]),
            row["skill"], row.get("skill_name") or row["skill"], row["difficulty"],
            row.get("band"), row["type"], row.get("stimulus_html") or "", row["stem_html"],
            json.dumps(row["options"]) if row.get("options") else None,
            json.dumps(row["correct"]), row["rationale_html"],
            json.dumps(row["explanations"]) if row.get("explanations") else None,
            row.get("update_date") or 0,
        ))
    conn.commit()
    print(f"  imported {len(rows)} questions from {json_path}")
    conn.close()
    return len(rows)


def normalize(db_path=None):
    stubs = load_index()
    live = load_live()
    conn = connect(db_path) if db_path else connect()
    seen = set()
    flagged = {}
    written = missing_raw = live_count = 0

    for stub in stubs:
        path = _raw_path(stub)
        if not path.exists():
            missing_raw += 1
            continue
        raw = json.loads(path.read_text(encoding="utf-8"))
        norm = (_normalize_external if stub["_path"] == "external_id"
                else _normalize_ibn)(stub, raw)

        live_flag = int(is_live(stub, live))

        explanations = None
        if norm["type"] == "mcq" and norm["options"]:
            labels = [o["label"] for o in norm["options"]]
            explanations, eflags = rationale.split_explanations(
                norm["rationale_html"], labels)
            norm["flags"].extend(eflags)

            # Cross-check the split against the official key: exactly one
            # explanation must read as "correct", and it must be the keyed
            # choice. A handful of items have stale letters in the rationale
            # prose after their options were reordered, so trusting the
            # mapping would tell a student their wrong pick was right.
            if explanations and norm["correct"]:
                reads_correct = [l for l, h in explanations.items()
                                 if rationale.classify(h) == "correct"]
                if reads_correct != [norm["correct"][0]]:
                    norm["flags"].append(
                        "explanation_key_mismatch_rationale_says_"
                        + ("".join(reads_correct) or "none"))
                    explanations = None   # fall back to the whole rationale

        if norm["flags"]:
            flagged[stub["_id"]] = norm["flags"]

        conn.execute("""
            INSERT INTO questions (id, source_path, section, domain, domain_name,
                skill, skill_name, difficulty, band, type, stimulus_html, stem_html,
                options_json, correct_json, rationale_html, explanations_json,
                key_recovered, flags_json, update_date, retired, live)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)
            ON CONFLICT(id) DO UPDATE SET
                source_path=excluded.source_path, section=excluded.section,
                domain=excluded.domain, domain_name=excluded.domain_name,
                skill=excluded.skill, skill_name=excluded.skill_name,
                difficulty=excluded.difficulty, band=excluded.band,
                type=excluded.type, stimulus_html=excluded.stimulus_html,
                stem_html=excluded.stem_html, options_json=excluded.options_json,
                correct_json=excluded.correct_json,
                rationale_html=excluded.rationale_html,
                explanations_json=excluded.explanations_json,
                key_recovered=excluded.key_recovered, flags_json=excluded.flags_json,
                update_date=excluded.update_date, retired=0, live=excluded.live
        """, (
            stub["_id"], stub["_path"], stub["_section"],
            stub.get("primary_class_cd") or "",
            stub.get("primary_class_cd_desc") or "",
            stub.get("skill_cd") or "", stub.get("skill_desc") or "",
            stub.get("difficulty") or "", stub.get("score_band_range_cd"),
            norm["type"], norm["stimulus_html"], norm["stem_html"],
            json.dumps(norm["options"]) if norm["options"] else None,
            json.dumps(norm["correct"]), norm["rationale_html"],
            json.dumps(explanations) if explanations else None,
            norm["key_recovered"],
            json.dumps(norm["flags"]) if norm["flags"] else None,
            stub["updateDate"], live_flag,
        ))
        seen.add(stub["_id"])
        written += 1
        live_count += live_flag

    # The index is the source of truth, not an append-only feed. An id that
    # disappears is retired, not silently left in the DB as a live question.
    retired = conn.execute(
        "UPDATE questions SET retired = 1 WHERE id NOT IN (%s)"
        % ",".join("?" * len(seen)), tuple(seen)).rowcount if seen else 0
    conn.commit()

    print(f"  wrote {written} questions" + (f", {missing_raw} raw files missing"
                                            if missing_raw else ""))
    print(f"  on official practice tests: {live_count}")
    if retired:
        print(f"  {retired} questions no longer in the index -> marked retired")
    print(f"  flagged: {len(flagged)}")
    if flagged:
        from collections import Counter
        counts = Counter(f for fl in flagged.values() for f in fl)
        for name, n in counts.most_common():
            print(f"    {n:5}  {name}")
    conn.close()
    return flagged
