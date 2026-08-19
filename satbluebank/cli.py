"""Command line entry point: python -m satbluebank <command>"""
import argparse
import html as _html
import json
import re
import sys

from . import pipeline, session
from .db import connect


def _plain(h, width=100):
    h = re.sub(r'<img[^>]*\balt="([^"]*)"[^>]*>', r" [\1] ", h or "")
    h = re.sub(r'<math[^>]*\balttext="([^"]*)"[^>]*>.*?</math>', r" \1 ", h, flags=re.S)
    h = re.sub(r"<svg.*?</svg>", " [figure] ", h, flags=re.S)
    h = re.sub(r"</p>|<br\s*/?>", "\n", h)
    h = re.sub(r"<[^>]+>", " ", h)
    text = _html.unescape(h)
    lines = []
    for para in text.split("\n"):
        para = " ".join(para.split())
        if not para:
            continue
        while len(para) > width:
            cut = para.rfind(" ", 0, width)
            cut = cut if cut > 0 else width
            lines.append(para[:cut])
            para = para[cut:].lstrip()
        lines.append(para)
    return "\n".join(lines)


def cmd_index(args):
    print("Pass 1: index")
    pipeline.build_index()


def cmd_fetch(args):
    print("Pass 2: fetch")
    stubs = pipeline.load_index()
    conn = connect()
    try:
        pipeline.fetch_details(stubs, force=args.force, conn=conn)
    finally:
        conn.close()


def cmd_normalize(args):
    print("Pass 3: normalize")
    flagged = pipeline.normalize()
    return 1 if flagged and args.strict else 0


def cmd_build(args):
    cmd_index(args)
    print("Pass 2: fetch")
    stubs = pipeline.load_index()
    conn = connect()
    try:
        pipeline.fetch_details(stubs, force=args.force, conn=conn)
    finally:
        conn.close()
    print("Pass 3: normalize")
    pipeline.normalize()


def cmd_stats(args):
    conn = connect()
    rows = conn.execute("""
        SELECT section, domain, domain_name, type, COUNT(*) n,
               SUM(key_recovered) recovered, SUM(flags_json IS NOT NULL) flagged
        FROM questions WHERE retired = 0
        GROUP BY section, domain, type ORDER BY section, domain, type""").fetchall()
    total = 0
    print(f"{'sec':5} {'domain':6} {'type':5} {'count':>6} {'recovered':>10} {'flagged':>8}  name")
    for r in rows:
        total += r["n"]
        print(f"{r['section']:5} {r['domain']:6} {r['type']:5} {r['n']:6} "
              f"{r['recovered']:10} {r['flagged']:8}  {r['domain_name']}")
    print(f"{'':19}{total:6} total")
    s = session.stats(conn)
    if s["attempts"]:
        print(f"\nattempts: {s['attempts']}  correct: {s['correct']} "
              f"({s['accuracy']:.1%})")
        for d in s["by_domain"]:
            print(f"  {d['domain']:5} {d['c']}/{d['n']}  {d['domain_name']}")
    conn.close()


def cmd_show(args):
    conn = connect()
    q = (session.get_question(conn, args.id) if args.id
         else session.pick(conn, section=args.section, domain=args.domain,
                           difficulty=args.difficulty))
    if q is None:
        print("no question matched those filters")
        return 1
    print(f"[{q['id']}] {q['section']} / {q['domain_name']} / {q['skill_name']} "
          f"/ difficulty {q['difficulty']} band {q['band']} / {q['type']}")
    if q["stimulus_html"]:
        print("\n" + _plain(q["stimulus_html"]))
    print("\n" + _plain(q["stem_html"]))
    for opt in q["options"] or []:
        print(f"  {opt['label']}. {_plain(opt['html'])}")
    print(f"\naccepted: {q['correct']}" + ("  (key recovered from rationale)"
                                           if q["key_recovered"] else ""))
    conn.close()


def cmd_answer(args):
    conn = connect()
    result = session.submit(conn, args.id, args.response, record=not args.no_record)
    q = result["question"]
    print(f"[{q['id']}] {q['type']}  your answer: {result['response']!r}")
    print("CORRECT" if result["correct"] else "INCORRECT",
          f"(match: {result['match']})" if result["match"] else "")
    print(f"accepted answers: {', '.join(result['accepted'])}")
    if result["why_wrong_html"]:
        print("\n-- why your answer is wrong (College Board) --")
        print(_plain(result["why_wrong_html"]))
    if result["why_right_html"]:
        print("\n-- why the correct answer is right (College Board) --")
        print(_plain(result["why_right_html"]))
    if not result["why_wrong_html"] and not result["why_right_html"]:
        print("\n-- explanation (College Board) --")
        print(_plain(result["rationale_html"]))
    conn.close()


def cmd_audit(args):
    """Report every question the normalizer flagged. Should be empty."""
    conn = connect()
    rows = conn.execute(
        "SELECT id, source_path, section, domain, type, flags_json, correct_json "
        "FROM questions WHERE flags_json IS NOT NULL AND retired = 0").fetchall()
    print(f"{len(rows)} flagged questions")
    for r in rows[:args.limit]:
        print(f"  {r['id']:40} {r['source_path']:12} {r['section']:5} {r['domain']:4} "
              f"{r['type']:4} {json.loads(r['flags_json'])}")
    noqa = conn.execute(
        "SELECT COUNT(*) n FROM questions WHERE correct_json = '[]' AND retired = 0"
    ).fetchone()["n"]
    print(f"questions with no answer key: {noqa}")
    conn.close()
    return 1 if (rows and args.strict) else 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="satbluebank")
    sub = p.add_subparsers(dest="cmd", required=True)

    for name, fn in (("index", cmd_index), ("fetch", cmd_fetch),
                     ("normalize", cmd_normalize), ("build", cmd_build)):
        sp = sub.add_parser(name)
        sp.add_argument("--force", action="store_true",
                        help="refetch everything instead of only stale items")
        sp.add_argument("--strict", action="store_true",
                        help="exit nonzero if anything was flagged")
        sp.set_defaults(fn=fn)

    sp = sub.add_parser("stats"); sp.set_defaults(fn=cmd_stats)

    sp = sub.add_parser("show")
    sp.add_argument("--id")
    sp.add_argument("--section", choices=["RW", "MATH"])
    sp.add_argument("--domain")
    sp.add_argument("--difficulty", choices=["E", "M", "H"])
    sp.set_defaults(fn=cmd_show)

    sp = sub.add_parser("answer")
    sp.add_argument("id")
    sp.add_argument("response")
    sp.add_argument("--no-record", action="store_true")
    sp.set_defaults(fn=cmd_answer)

    sp = sub.add_parser("serve")
    sp.add_argument("--host", default="127.0.0.1",
                    help="0.0.0.0 to reach it from another device on your network")
    sp.add_argument("--port", type=int, default=8000)
    sp.add_argument("-v", "--verbose", action="store_true")
    sp.set_defaults(fn=lambda a: __import__(
        "satbluebank.server", fromlist=["serve"]).serve(
            host=a.host, port=a.port, verbose=a.verbose))

    sp = sub.add_parser("import")
    sp.add_argument("path", help="JSON array against the normalized schema")
    sp.set_defaults(fn=lambda a: pipeline.import_questions(a.path) and None)

    sp = sub.add_parser("audit")
    sp.add_argument("--limit", type=int, default=50)
    sp.add_argument("--strict", action="store_true")
    sp.set_defaults(fn=cmd_audit)

    args = p.parse_args(argv)
    return args.fn(args) or 0


if __name__ == "__main__":
    sys.exit(main())
