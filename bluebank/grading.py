"""Auto-grading against the official accepted-answer list.

`correct_answer` is an array of accepted strings, and it conflates two
different things: alternate spellings of one value (["0.25", "1/4"]) and
genuinely different valid answers (["7", "8", "13"] for "a possible value of
a"). Grading is a membership test either way. The review UI must show every
accepted form, never accepted[0].
"""
from fractions import Fraction

_MINUS = {"−": "-", "–": "-", "—": "-"}


def canonical(value):
    """Canonical string form: strip whitespace, thousands commas, unicode
    minus, leading zero, and trailing decimal zeros."""
    if value is None:
        return ""
    s = str(value).strip()
    for bad, good in _MINUS.items():
        s = s.replace(bad, good)
    s = "".join(s.split()).replace(",", "").replace("$", "")
    if not s:
        return ""
    neg = s.startswith("-")
    if neg or s.startswith("+"):
        s = s[1:]
    if "/" not in s and "." in s:
        s = s.rstrip("0").rstrip(".") or "0"
        if s.startswith("0.") and len(s) > 2:
            s = s[1:]
    return ("-" if neg and s != "0" else "") + s


def as_fraction(value):
    """Exact rational value, or None if the string is not a plain number."""
    s = canonical(value)
    if not s:
        return None
    try:
        if "/" in s:
            num, _, den = s.partition("/")
            return Fraction(int(num), int(den))
        return Fraction(s)
    except (ValueError, ZeroDivisionError, ArithmeticError):
        return None


def grade_spr(response, accepted):
    """Return (is_correct, match_kind). match_kind is 'listed', 'equivalent',
    or None."""
    canon_response = canonical(response)
    if not canon_response:
        return False, None
    if any(canon_response == canonical(a) for a in accepted):
        return True, "listed"
    # A student typing 1.5 for a listed 3/2 is right even when the bank only
    # lists one spelling.
    value = as_fraction(response)
    if value is not None:
        for a in accepted:
            other = as_fraction(a)
            if other is not None and other == value:
                return True, "equivalent"
    return False, None


def grade_mcq(response, accepted):
    if response is None:
        return False, None
    letter = str(response).strip().upper()
    hit = letter in {str(a).strip().upper() for a in accepted}
    return hit, ("listed" if hit else None)


def grade(question, response):
    """Grade one response and assemble the full review payload.

    `question` is a dict with keys type, correct, explanations, rationale_html,
    options. Everything returned is official College Board text.
    """
    accepted = question["correct"]
    is_mcq = question["type"] == "mcq"
    correct, match = (grade_mcq if is_mcq else grade_spr)(response, accepted)

    explanations = question.get("explanations") or {}
    picked_html = None
    if is_mcq and response:
        picked_html = explanations.get(str(response).strip().upper())
    key_html = explanations.get(str(accepted[0]).strip().upper()) if is_mcq and accepted else None

    return {
        "question_id": question.get("id"),
        "response": response,
        "correct": correct,
        "match": match,
        "accepted": list(accepted),
        "why_wrong_html": None if correct else picked_html,
        "why_right_html": key_html,
        "rationale_html": question.get("rationale_html"),
    }
