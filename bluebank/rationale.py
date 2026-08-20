"""Splitting College Board rationales into per-choice explanations, and
recovering answer keys for the legacy `ibn` items that ship without one.

Everything here is derived from the official rationale text. Nothing is
generated or guessed: if a pattern does not match, we flag it rather than
inventing an explanation.
"""
import html as _html
import re

# `&nbsp;` shows up between words often enough to break a naive \s+ pattern,
# and the choice letter is sometimes wrapped in a tag:
# `Choice <span class="italic">C</span> is incorrect.`
_SP = r"(?:\s|&nbsp;|&#160;|<[^>]*>)+"
_SP0 = r"(?:\s|&nbsp;|&#160;|<[^>]*>)*"   # same, but genuinely optional

# "Choice B is the best answer because ..." / "Choice A is incorrect because ..."
# The `is` is occasionally missing in the source ("Choice B incorrect.") or
# folded into an adverb ("Choice C incorrectly limits the cost ...").
_SINGLE = re.compile(rf"Choice{_SP}([A-D]){_SP}(?:is\b|incorrect\w*\b)", re.IGNORECASE)

# "Choices A, B, and C are incorrect and may result from conceptual errors."
# The trailing `are incorrect` is required: "Choices B and D show models of the
# form ..." is a mid-explanation reference, not a rejection, and must not split.
# Up to two words may sit between ("are also incorrect", "are all incorrect").
# The plural `s` is optional because the source sometimes writes
# "Choice B, C, and D are incorrect"; two or more letters are required so this
# never competes with _SINGLE.
# The \b around each letter stops [A-D] from matching the "a" in "and".
_GROUPED = re.compile(
    rf"Choices?{_SP}([A-D]\b(?:{_SP0}(?:,{_SP0}and\b|,|and\b){_SP0}[A-D]\b)+)"
    rf"{_SP}are(?:{_SP}\w+){{0,2}}{_SP}incorrect",
    re.IGNORECASE,
)

_CORRECT_WORDS = re.compile(r"^(?:the\s+)?(?:best\s+answer|correct)\b", re.IGNORECASE)

_VOID_TAGS = {"br", "img", "hr", "input", "meta", "link", "source", "col", "area"}
_TAG = re.compile(r"<(/?)([a-zA-Z][\w:-]*)([^>]*?)(/?)>")


def _in_tag(text, pos):
    """True if `pos` falls inside a tag (e.g. within a MathML alttext value)."""
    lt = text.rfind("<", 0, pos)
    gt = text.rfind(">", 0, pos)
    return lt > gt


# Whitespace, tags, and sentence-final closing punctuation ("...Earthly
# Paradise." </p><p>) all sit between the period and the next sentence.
_SKIP_BACK = re.compile(
    r"""(?:\s|&nbsp;|&#160;|<[^>]*>|["')\]”’]|&rdquo;|&rsquo;|&quot;|&#822[01];|&#8217;)+$""")

# A line or block break ends a sentence just as firmly as a period. The `ibn`
# rationales use "<p>Incorrect Answer Rationale<br>" headers with no period.
_BLOCK_BREAK = re.compile(r"<\s*/?\s*(?:br|p|div|li|ul|ol|tr|td|h[1-6])\b", re.IGNORECASE)


def _at_sentence_start(text, pos):
    """True if `pos` begins a sentence.

    Rationales refer to choices mid-sentence ("...choice D is the only graph
    that passes through the point..."), which is a reference, not the start of
    that choice's explanation. Only sentence-initial mentions are boundaries.
    """
    head = text[:pos]
    skipped = _SKIP_BACK.search(head)
    if skipped and _BLOCK_BREAK.search(skipped.group(0)):
        return True
    head = _SKIP_BACK.sub("", head)
    return not head or head[-1] in ".!?:;"


def _open_tags(fragment):
    """Return (stack_of_open_tags, positions_of_orphan_closers)."""
    stack, orphans = [], set()
    for m in _TAG.finditer(fragment):
        closing, name, selfclose = m.group(1), m.group(2).lower(), m.group(4)
        if name in _VOID_TAGS or selfclose:
            continue
        if closing:
            if any(n == name for n, _ in stack):
                while stack and stack[-1][0] != name:
                    stack.pop()
                stack.pop()
            else:
                orphans.add(m.start())
        else:
            stack.append((name, m.start()))
    return stack, orphans


def _balance(fragment):
    """Close tags left open by cutting, and drop closers whose opener was cut off.

    Segments are carved out of the middle of the rationale HTML, so both ends
    can land inside a <p>. The UI injects this HTML directly, so it has to be
    well formed.
    """
    stack, orphans = _open_tags(fragment)
    if orphans:
        out, last = [], 0
        for m in _TAG.finditer(fragment):
            if m.start() in orphans:
                out.append(fragment[last:m.start()])
                last = m.end()
        out.append(fragment[last:])
        fragment = "".join(out)
        stack, _ = _open_tags(fragment)
    for name, _ in reversed(stack):
        fragment += f"</{name}>"
    return fragment.strip()


def split_explanations(rationale_html, labels=("A", "B", "C", "D")):
    """Split one rationale into {label: html}.

    Returns (explanations, flags). A missing label is left out of the dict and
    named in flags rather than filled with a guess.
    """
    flags = []
    if not rationale_html:
        return {}, ["empty_rationale"]

    def usable(pos):
        return (not _in_tag(rationale_html, pos)
                and _at_sentence_start(rationale_html, pos))

    singles, groups = [], []
    for m in _SINGLE.finditer(rationale_html):
        if usable(m.start()):
            singles.append((m.start(), [m.group(1).upper()], m.end()))
    for m in _GROUPED.finditer(rationale_html):
        if not usable(m.start()):
            continue
        # Case-sensitive on purpose: [A-D] with IGNORECASE also matches the
        # "a" and "d" in the connecting word "and".
        letters = re.findall(r"[A-D]", m.group(1))
        if letters:
            groups.append((m.start(), letters, m.end()))

    # A letter mentioned twice at sentence start ("Choice A is a point with
    # x-coordinate r" inside A's own explanation) is a self-reference, not a
    # second segment. Keep the first and drop the rest entirely, so the first
    # segment is not truncated at the reference.
    marks, claimed = [], set()
    for start, letters, end in singles:
        letter = letters[0]
        if letter in claimed:
            continue
        claimed.add(letter)
        marks.append((start, letters, end))

    # An individual explanation is more specific than a blanket "Choices A, B,
    # and D are incorrect", so singles win. A group whose letters are all
    # already covered still terminates the preceding segment, but contributes
    # no explanation of its own.
    for start, letters, end in groups:
        marks.append((start, [l for l in letters if l not in claimed], end))
    claimed.update(l for _, ls, _ in groups for l in ls)

    if not any(labels_ for _, labels_, _ in marks):
        return {}, ["no_choice_boundaries"]

    marks.sort(key=lambda t: t[0])
    # Drop a boundary swallowed by an earlier match.
    pruned = []
    for mark in marks:
        if pruned and mark[0] < pruned[-1][2]:
            continue
        pruned.append(mark)

    out = {}
    for i, (start, letters, _) in enumerate(pruned):
        end = pruned[i + 1][0] if i + 1 < len(pruned) else len(rationale_html)
        segment = _balance(rationale_html[start:end])
        for letter in letters:
            if letter in out:
                flags.append(f"duplicate_boundary_{letter}")
            else:
                out[letter] = segment

    missing = [l for l in labels if l not in out]
    if missing:
        flags.append("missing_explanations_" + "".join(missing))
    return out, flags


def classify(explanation_html):
    """'correct' or 'incorrect', read from the official wording itself."""
    m = _SINGLE.search(explanation_html or "")
    if not m:
        if re.search(r"are" + _SP + r"incorrect", explanation_html or "", re.IGNORECASE):
            return "incorrect"
        return "unknown"
    tail = _html.unescape(re.sub(r"<[^>]+>", " ", explanation_html[m.end():])).strip()
    return "correct" if _CORRECT_WORDS.match(tail) else "incorrect"


# --------------------------------------------------------------------------
# Answer-key recovery for the 81 keyless `ibn` items (handoff section 4).
# --------------------------------------------------------------------------

_WAYS = re.compile(
    r"Note that (.+?) (?:are|is) (?:examples?|an example) of ways to enter", re.IGNORECASE)
# The terminator must be a sentence-ending period (followed by space or end of
# string). A bare [^.] class would cut "0.25" down to "0".
_SPR_FALLBACK = re.compile(
    r"correct answer is\s*:?\s*(.+?)\s*(?:\.\s|\.$|$)", re.IGNORECASE)
_MCQ_FALLBACK = re.compile(
    r"Choice\s+([A-D])\s+is\s+(?:the\s+)?(?:best|correct)", re.IGNORECASE)
_NUMERIC = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:/[+-]?\d+(?:\.\d*)?)?$")


def _enterable(value):
    """Strip spaces and thousands commas; SPR entry accepts neither. Returns
    the enterable string, or None if it is not a plain number.

    Only the trailing period comes off: `.strip(".")` would turn the answer
    `.1667` into `1667`.
    """
    value = value.strip().rstrip(".").replace(" ", "").replace(",", "")
    return value if value and _NUMERIC.match(value) else None


def flatten(h):
    """HTML to plain text, promoting img alt text to inline words.

    The keyless items render their math as base64 images; the alt attribute is
    the only place the value survives.
    """
    h = re.sub(r'<img[^>]*\balt="([^"]*)"[^>]*>', r" \1 ", h or "")
    h = re.sub(r"<[^>]+>", " ", h)
    return " ".join(_html.unescape(h).split())


def recover_spr_answers(rationale_html):
    """Return (answers, flags). Empty answers means recovery failed, loudly."""
    text = flatten(rationale_html)

    m = _WAYS.search(text)
    if m:
        answers = [v for v in (_enterable(p) for p in re.split(r",|\band\b", m.group(1)))
                   if v]
        if answers:
            return answers, []
        return [], ["ways_to_enter_no_numeric"]

    m = _SPR_FALLBACK.search(text)
    if m:
        value = _enterable(m.group(1))
        if value:
            return [value], []
        # 'three halves', 'e' -- screen-reader prose, not an enterable value.
        return [], ["spr_answer_not_numeric"]
    return [], ["spr_no_answer_pattern"]


def recover_mcq_answer(rationale_html):
    """Return (letter_or_None, flags). Ambiguity is a flag, never a guess."""
    text = flatten(rationale_html)
    letters = {m.group(1).upper() for m in _MCQ_FALLBACK.finditer(text)}
    if len(letters) == 1:
        return letters.pop(), []
    if not letters:
        return None, ["mcq_no_correct_pattern"]
    return None, ["mcq_ambiguous_" + "".join(sorted(letters))]
