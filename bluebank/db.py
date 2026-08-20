"""SQLite schema and connection."""
import hashlib
import sqlite3
from pathlib import Path

DB_PATH = Path("data/bluebank.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS questions (
  id             TEXT PRIMARY KEY,   -- external_id or ibn
  source_path    TEXT NOT NULL,      -- 'external_id' | 'ibn'
  section        TEXT NOT NULL,      -- 'RW' | 'MATH'
  domain         TEXT NOT NULL,      -- INI/CAS/EOI/SEC/H/P/Q/S
  domain_name    TEXT NOT NULL,
  skill          TEXT NOT NULL,
  skill_name     TEXT NOT NULL,
  difficulty     TEXT NOT NULL,      -- E | M | H
  band           INTEGER,            -- 1-7, finer than difficulty
  type           TEXT NOT NULL,      -- 'mcq' | 'spr'
  stimulus_html  TEXT,
  stem_html      TEXT NOT NULL,
  options_json   TEXT,               -- [{"label":"A","html":"..."}], null for spr
  correct_json   TEXT NOT NULL,      -- ["B"] or ["3/2","1.5"]
  rationale_html TEXT NOT NULL,
  explanations_json TEXT,            -- {"A":"<html>", ...} per-choice, null for spr
  key_recovered  INTEGER NOT NULL DEFAULT 0,
  flags_json     TEXT,               -- normalize-time warnings, null when clean
  update_date    INTEGER NOT NULL,
  retired        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_q_section    ON questions(section, retired);
CREATE INDEX IF NOT EXISTS idx_q_domain     ON questions(domain, retired);
CREATE INDEX IF NOT EXISTS idx_q_difficulty ON questions(difficulty, retired);

CREATE TABLE IF NOT EXISTS attempts (
  id          INTEGER PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  answered_at INTEGER NOT NULL,      -- unix seconds
  response    TEXT,
  correct     INTEGER NOT NULL,
  seconds     INTEGER
);

CREATE INDEX IF NOT EXISTS idx_a_question ON attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_a_time     ON attempts(answered_at);

-- Highlights and notes, anchored by character offset into a field's rendered
-- text. Offsets are computed over text nodes only, skipping math and figures,
-- so MathJax rewriting the DOM cannot shift them.
CREATE TABLE IF NOT EXISTS annotations (
  id           INTEGER PRIMARY KEY,
  question_id  TEXT NOT NULL REFERENCES questions(id),
  field        TEXT NOT NULL,      -- 'stimulus' | 'stem' | 'option:A'
  start_offset INTEGER NOT NULL,
  end_offset   INTEGER NOT NULL,
  color        TEXT NOT NULL DEFAULT 'yellow',
  note         TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_an_question ON annotations(question_id);

-- "Mark for Review" flag, one row per question.
CREATE TABLE IF NOT EXISTS marks (
  question_id TEXT PRIMARY KEY REFERENCES questions(id),
  flagged     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);
"""


# FNV-1a, 64-bit, followed by a splitmix64 finalizer.
#
# The finalizer is not optional. Raw FNV-1a barely avalanches into the high
# bits, which are exactly the bits that decide a sort: every id beginning "m"
# hashed to 0x08a98..., every id beginning "r" to 0x08dc8..., so ordering by it
# was really "sort by first character" and grouped the sections right back
# together. The synthetic interleaving test in tests/test_backend.py catches
# this; do not remove it.
#
# Chosen over blake2b/SHA so the TypeScript build can compute
# the identical value: FNV is five lines in any language and needs no crypto
# library, while blake2b has no browser equivalent and WebCrypto's SHA-256 is
# async, which a sort comparator cannot use. web/src/lib/shuffle.ts is the twin
# and tests/test_backend.py pins values shared by both.
_FNV_OFFSET = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_MASK64 = 0xFFFFFFFFFFFFFFFF


def _mix(z):
    """splitmix64 finalizer: spreads every input bit across all 64 output bits."""
    z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & _MASK64
    z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & _MASK64
    return z ^ (z >> 31)


def shuffle_key(question_id):
    """A stable pseudo-random sort key for a question id.

    Ordering a practice set by this interleaves the sections instead of running
    all 1,922 Math questions before the first Reading one, while keeping the
    order *fixed*: question 40 is the same question tomorrow, after a rebuild,
    on another machine, and in the static build. Only questions newly added to
    the bank move, and they slot in without disturbing the rest.

    Do NOT reach for the builtin hash() here. Python randomises string hashing
    per process unless PYTHONHASHSEED is set, so the set would reshuffle on
    every server restart -- exactly the thing this avoids.

    Masked to 63 bits because SQLite integers are signed and a full 64-bit
    value would overflow to negative.
    """
    h = _FNV_OFFSET
    for byte in question_id.encode("utf-8"):
        h = ((h ^ byte) * _FNV_PRIME) & _MASK64
    return _mix(h) & 0x7FFFFFFFFFFFFFFF


def connect(path=None):
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.create_function("shuffle_key", 1, shuffle_key, deterministic=True)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn
