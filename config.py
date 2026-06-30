"""Configuration for the HOBL Dashboard."""

import os

_HERE = os.path.dirname(os.path.abspath(__file__))

# ── Data source ──────────────────────────────────────────────────────────────
# "json"  -> read metrics from local hobl_result*.json files (temporary stand-in
#            database used until the new Kusto columns/branch are merged &
#            ingested). All dashboard features are built against this.
# "kusto" -> query the Kusto table directly (the final, permanent source).
#
# Both backends expose the SAME query surface and schema, so switching sources
# is a one-line change here once the branch is merged.
#
# This is only the DEFAULT source on first run. The active source can be changed
# at runtime from the dashboard UI (top-right data-source control); the choice is
# persisted to RUNTIME_STATE_FILE and survives restarts.
DATA_SOURCE = "json"

# In JSON mode, the dashboard reads ONLY from files the user uploads through the
# UI. They are stored in this folder; when it is empty, no data is shown.
UPLOAD_DIR = os.path.join(_HERE, "uploaded_json")

# Persists the runtime-selected data source across restarts.
RUNTIME_STATE_FILE = os.path.join(_HERE, "runtime_state.json")

KUSTO_CLUSTER = "https://fungateprd.centralus.kusto.windows.net"
KUSTO_DATABASE = "FungatesDataStore"
KUSTO_TABLE = "Hobl_RawMetrics"

# Flask settings
HOST = "127.0.0.1"
PORT = 5000
DEBUG = True
