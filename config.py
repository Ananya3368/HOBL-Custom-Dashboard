"""Configuration for the HOBL Dashboard."""

# ── Data source ──────────────────────────────────────────────────────────────
# "json"  -> read metrics from local hobl_result*.json files (temporary stand-in
#            database used until the new Kusto columns/branch are merged &
#            ingested). All dashboard features are built against this.
# "kusto" -> query the Kusto table directly (the final, permanent source).
#
# Both backends expose the SAME query surface and schema, so switching sources
# is a one-line change here once the branch is merged.
DATA_SOURCE = "json"

# Folder containing hobl_result*.json files (used when DATA_SOURCE == "json").
JSON_DIR = r"C:\Json\Json"

KUSTO_CLUSTER = "https://fungateprd.centralus.kusto.windows.net"
KUSTO_DATABASE = "FungatesDataStore"
KUSTO_TABLE = "Hobl_RawMetrics"

# Flask settings
HOST = "127.0.0.1"
PORT = 5000
DEBUG = True
