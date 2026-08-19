"""SQLite schema and connection."""
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


def connect(path=None):
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn
