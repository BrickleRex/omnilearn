"""Persistent jedi completion daemon for Omnilearn.

Deliberately NOT an LLM: this is local static analysis, so completions stay
instant, free and offline. The node side (server/complete.ts) spawns exactly one
of these per server process and keeps it warm.

Protocol — one JSON object per line, both directions:

  in   {"id": 7, "source": "import numpy as np\\nnp.", "path": "/abs/mhsa.py"|null,
        "line": 2, "column": 3}
  out  {"id": 7, "items": [{"label": "zeros", "kind": "function", "detail": "zeros(shape, ...)"}]}
  out  {"id": 7, "error": "..."}          on a request that could not be answered

Rules of this loop: one bad request must never kill it, and stdout is flushed
after every response so the reader is never left waiting on a buffer.
"""

import json
import signal
import sys

# A bare `np.` offers 542 names in jedi's (alphabetical, not relevance) order, so
# an 80-item cut would stop at "b" and hide `zeros` — the editor's completion list
# has to carry the whole module surface. What actually costs time is inferring
# signatures, so THAT is what stays capped at 80: everything past it comes back as
# label + kind, which is all the popup shows until you arrow onto the row anyway.
MAX_ITEMS = 1000
MAX_DETAILED = 80
MAX_DETAIL = 200

try:
    import jedi
except Exception as exc:  # pragma: no cover - the node side probes for jedi first
    sys.stderr.write("jedi_daemon: cannot import jedi: %s\n" % exc)
    sys.stderr.flush()
    sys.exit(1)


def _detail_for(completion, kind):
    """A short signature for callables, else None. Never raise, never linger.

    Only called for the first MAX_DETAILED completions: get_signatures() infers,
    and inference over a whole module's surface is what would blow the latency
    budget.
    """
    if kind not in ("function", "class"):
        return None
    try:
        signatures = completion.get_signatures()
    except Exception:
        return None
    for signature in signatures:
        try:
            text = signature.to_string()
        except Exception:
            continue
        if text:
            return text[:MAX_DETAIL]
    return None


def _clamp_position(source, line, column):
    """jedi raises on out-of-range positions; a stale buffer must not error."""
    lines = source.split("\n")
    if line < 1:
        line = 1
    if line > len(lines):
        line = len(lines)
    text = lines[line - 1]
    if column < 0:
        column = 0
    if column > len(text):
        column = len(text)
    return line, column


def _handle(request):
    request_id = request.get("id")
    source = request.get("source")
    if not isinstance(source, str):
        source = ""
    path = request.get("path")
    if not isinstance(path, str) or not path:
        path = None
    try:
        line = int(request.get("line", 1))
    except (TypeError, ValueError):
        line = 1
    try:
        column = int(request.get("column", 0))
    except (TypeError, ValueError):
        column = 0
    line, column = _clamp_position(source, line, column)

    script = jedi.Script(code=source, path=path)
    completions = script.complete(line, column)

    items = []
    for completion in completions[:MAX_ITEMS]:
        try:
            label = completion.name
        except Exception:
            continue
        if not label:
            continue
        try:
            kind = completion.type or "unknown"
        except Exception:
            kind = "unknown"
        item = {"label": label, "kind": kind}
        if len(items) < MAX_DETAILED:
            detail = _detail_for(completion, kind)
            if detail:
                item["detail"] = detail
        items.append(item)

    return {"id": request_id, "items": items}


def main():
    # Ctrl-C belongs to whoever is at the terminal, not to this child.
    try:
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    except Exception:
        pass

    while True:
        try:
            raw = sys.stdin.readline()
        except Exception:
            break
        if raw == "":  # parent closed stdin
            break
        raw = raw.strip()
        if not raw:
            continue

        request_id = None
        try:
            request = json.loads(raw)
            if isinstance(request, dict):
                request_id = request.get("id")
            else:
                raise ValueError("expected a JSON object")
            response = _handle(request)
        except Exception as exc:
            response = {"id": request_id, "error": "%s: %s" % (type(exc).__name__, exc)}

        try:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
        except Exception:
            break


if __name__ == "__main__":
    main()
