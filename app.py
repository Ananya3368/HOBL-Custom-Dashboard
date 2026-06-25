"""HOBL Dashboard – Flask app that serves an interactive metrics dashboard.

The data layer is pluggable: ``config.DATA_SOURCE`` selects between a temporary
local-JSON backend (``json_data``) and the final Kusto backend (``kusto_data``).
Both expose the same ``get_tiers`` / ``get_scenarios`` / ``get_dates`` /
``get_metrics`` surface and the same record shape, so the routes and the
frontend are identical regardless of source. Switching back to Kusto after the
branch merges is a one-line change in ``config.py``.
"""

from flask import Flask, render_template, jsonify, request

import config

if config.DATA_SOURCE == "kusto":
    import kusto_data as backend
else:
    import json_data as backend

app = Flask(__name__)


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/filters")
def api_filters():
    """Return distinct values for each independent, optional filter."""
    try:
        return jsonify(backend.get_filter_options())
    except Exception as exc:  # surfaced to the UI as a friendly error
        return jsonify({"error": str(exc)}), 500


def _parse_filters():
    """Parse the shared optional filter query params used by metrics + table."""
    def _int(name):
        raw = request.args.get(name, "")
        try:
            return int(raw) if raw.strip() else None
        except ValueError:
            return None

    def _list(name):
        """Collect a multi-valued filter: repeated params and/or comma-separated."""
        out = []
        for raw in request.args.getlist(name):
            out.extend(p.strip() for p in raw.split(",") if p.strip())
        return out

    return {
        "device": _list("device"),
        "ram": _list("ram"),
        "scenario": _list("scenario"),
        "start_date": request.args.get("start_date", ""),
        "end_date": request.args.get("end_date", ""),
        "last_n": _int("last_n"),
        "start_iter": _int("start_iter"),
        "end_iter": _int("end_iter"),
    }


@app.route("/api/metrics")
def api_metrics():
    """Return metrics matching the selected filters. Any omitted filter = all."""
    f = _parse_filters()
    try:
        return jsonify(
            backend.get_metrics(
                f["device"], f["ram"], f["scenario"], f["start_date"],
                f["end_date"], f["last_n"], f["start_iter"], f["end_iter"],
            )
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/table")
def api_table():
    """Return per-iteration columns for the transposed Excel-style table view."""
    f = _parse_filters()
    try:
        return jsonify(
            backend.get_table_data(
                f["device"], f["ram"], f["scenario"], f["start_date"],
                f["end_date"], f["last_n"], f["start_iter"], f["end_iter"],
            )
        )
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"Starting HOBL Dashboard on http://{config.HOST}:{config.PORT}")
    print(f"Data source: {config.DATA_SOURCE}")
    if config.DATA_SOURCE == "kusto":
        print("A browser window will open for Azure AD sign-in...")
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
