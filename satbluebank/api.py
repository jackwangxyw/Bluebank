"""HTTP client for the three College Board question-bank endpoints.

No authentication of any kind is required. Stdlib only, on purpose: the whole
point of shipping the exporter instead of the data is that anyone can run it
without a setup ritual.
"""
import json
import time
import urllib.error
import urllib.request

LIST_URL = ("https://qbank-api.collegeboard.org/msreportingquestionbank-prod"
            "/questionbank/digital/get-questions")
DETAIL_URL = ("https://qbank-api.collegeboard.org/msreportingquestionbank-prod"
              "/questionbank/digital/get-question")
IBN_URL = "https://saic.collegeboard.org/disclosed/{ibn}.json"

SAT_EVENT_ID = 99
RW, MATH = 1, 2
DOMAINS = {
    RW: "INI,CAS,EOI,SEC",
    MATH: "H,P,Q,S",
}
DOMAIN_NAMES = {
    "INI": "Information and Ideas",
    "CAS": "Craft and Structure",
    "EOI": "Expression of Ideas",
    "SEC": "Standard English Conventions",
    "H": "Algebra",
    "P": "Advanced Math",
    "Q": "Problem-Solving and Data Analysis",
    "S": "Geometry and Trigonometry",
}

TIMEOUT = 60
RETRIES = 4


def _request(req):
    last = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last = exc
            if attempt < RETRIES - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{req.full_url} failed after {RETRIES} attempts: {last}")


def _post(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    return _request(req)


def fetch_index(test):
    """Return the full stub list for one section. No question content."""
    return _post(LIST_URL, {
        "asmtEventId": SAT_EVENT_ID,
        "test": test,
        "domain": DOMAINS[test],
    })


def fetch_external(external_id):
    return _post(DETAIL_URL, {"external_id": external_id})


def fetch_ibn(ibn):
    """The ibn endpoint returns a one-element array. Unwrap it here so callers
    only ever deal with one shape."""
    data = _request(urllib.request.Request(IBN_URL.format(ibn=ibn)))
    if not isinstance(data, list) or len(data) != 1:
        raise ValueError(f"ibn {ibn}: expected 1-element array, got {type(data).__name__} "
                         f"of length {len(data) if isinstance(data, list) else 'n/a'}")
    return data[0]
