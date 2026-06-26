"""Kusto data source for the HOBL Dashboard (the final, permanent source).

Exposes the same query surface as ``json_data`` so the rest of the app and the
frontend are source-agnostic. Targets the NEW ``Hobl_RawMetrics`` schema in which
per-device attributes live in a single ``DeviceConfig`` dynamic column.

Used only when ``config.DATA_SOURCE == "kusto"``. Authentication is lazy so no
browser sign-in happens while the JSON backend is active.

NOTE: cannot be exercised until the branch adding DeviceConfig / Pt / HostName is
merged and data is ingested. The Device / Ram / Scenario expressions mirror the
JSON backend; confirm the exact column carrying run_info.test_name once real rows
exist (marked TODO below).
"""

import re

from azure.identity import InteractiveBrowserCredential
from azure.kusto.data import KustoClient, KustoConnectionStringBuilder

import config

_client = None

# Device and RAM come from the DeviceConfig dynamic column.
_DEVICE_EXPR = "Device = tostring(DeviceConfig.device_name)"
_RAM_EXPR = "Ram = tostring(DeviceConfig.usable_ram_config_gb)"
# TODO(post-merge): confirm the column carrying run_info.test_name / scenario.
_SCENARIO_EXPR = "Scenario = tostring(TestName)"
_DATE_EXPR = 'Date = format_datetime(RunDate, "yyyy-MM-dd")'

_BASE = (
    f"{config.KUSTO_TABLE}\n"
    f"    | extend {_DEVICE_EXPR}\n"
    f"    | extend {_RAM_EXPR}\n"
    f"    | extend {_SCENARIO_EXPR}\n"
    f"    | extend {_DATE_EXPR}\n"
)


def _get_client() -> KustoClient:
    global _client
    if _client is None:
        credential = InteractiveBrowserCredential()
        kcs = KustoConnectionStringBuilder.with_azure_token_credential(
            config.KUSTO_CLUSTER, credential
        )
        _client = KustoClient(kcs)
    return _client


def _run_query(kql: str) -> list[dict]:
    response = _get_client().execute(config.KUSTO_DATABASE, kql)
    primary = response.primary_results[0]
    columns = [col.column_name for col in primary.columns]
    rows = []
    for row in primary:
        record = {}
        for col, val in zip(columns, row):
            if val is not None and not isinstance(val, (str, int, float, bool)):
                val = str(val)
            record[col] = val
        rows.append(record)
    return rows


def _sanitize(value: str) -> str:
    """Basic KQL injection prevention – strip single quotes and control chars."""
    return re.sub(r"['\\\x00-\x1f]", "", value)


def _in_clause(column: str, value) -> str | None:
    """Build a KQL filter for a single value or a list of values.

    Returns ``None`` when no filtering should be applied (empty/falsy), an
    ``==`` clause for one value, or an ``in (...)`` clause for several.
    """
    if value is None or value == "":
        return None
    if isinstance(value, str):
        values = [value]
    else:
        values = [str(v) for v in value if str(v) != ""]
    if not values:
        return None
    if len(values) == 1:
        return f"    | where {column} == '{_sanitize(values[0])}'"
    joined = ", ".join(f"'{_sanitize(v)}'" for v in values)
    return f"    | where {column} in ({joined})"


def _distinct(column: str) -> list[str]:
    kql = f"{_BASE}    | where isnotempty({column})\n    | distinct {column}"
    return [r[column] for r in _run_query(kql)]


def get_filter_options() -> dict:
    """Distinct values for each independent filter, across all data."""
    rams = _distinct("Ram")
    try:
        rams = sorted(rams, key=lambda r: (0, float(r)))
    except (TypeError, ValueError):
        rams = sorted(rams)
    return {
        "devices": sorted(_distinct("Device")),
        "rams": rams,
        "scenarios": sorted(_distinct("Scenario")),
        "dates": sorted(_distinct("Date"), reverse=True),
    }


def _apply_last_n(rows: list[dict], last_n) -> list[dict]:
    """Keep only the most recent ``last_n`` iterations per Device+Ram+Scenario."""
    if not last_n or last_n <= 0:
        return rows

    from collections import defaultdict

    iterations = defaultdict(set)
    for r in rows:
        iterations[(r["Device"], r["Ram"], r["Scenario"])].add((r["Date"], r["Iteration"]))

    keep = {}
    for key, values in iterations.items():
        ordered = sorted(
            values,
            key=lambda x: (x[0], x[1] if x[1] is not None else 0),
            reverse=True,
        )[:last_n]
        keep[key] = set(ordered)

    return [
        r
        for r in rows
        if (r["Date"], r["Iteration"]) in keep[(r["Device"], r["Ram"], r["Scenario"])]
    ]


def _apply_iter_range(rows: list[dict], start_iter, end_iter) -> list[dict]:
    """Keep iterations whose chronological rank is in [start_iter, end_iter].

    Within each Device+Ram+Scenario group, distinct (Date, Iteration) pairs are
    ranked ascending (earliest run = rank 1, latest = N). ``start_iter`` defaults
    to 1 and ``end_iter`` defaults to N (all) when None.
    """
    if (start_iter is None or start_iter <= 1) and end_iter is None:
        return rows

    from collections import defaultdict

    iterations = defaultdict(set)
    for r in rows:
        iterations[(r["Device"], r["Ram"], r["Scenario"])].add((r["Date"], r["Iteration"]))

    keep = {}
    for key, values in iterations.items():
        ordered = sorted(values, key=lambda x: (x[0], x[1] if x[1] is not None else 0))
        lo = start_iter if start_iter and start_iter > 1 else 1
        hi = end_iter if end_iter is not None else len(ordered)
        keep[key] = set(ordered[lo - 1:hi])

    return [
        r
        for r in rows
        if (r["Date"], r["Iteration"]) in keep[(r["Device"], r["Ram"], r["Scenario"])]
    ]


def get_metrics(
    device: str = "",
    ram: str = "",
    scenario: str = "",
    start_date: str = "",
    end_date: str = "",
    last_n=None,
    start_iter=None,
    end_iter=None,
) -> list[dict]:
    """Metrics matching the provided filters. Any empty filter means "all".

    Dates are filtered as an inclusive [start_date, end_date] range.
    ``start_iter``/``end_iter`` keep only iterations whose chronological rank
    (earliest = 1) is in that inclusive window, per Device+Ram+Scenario.
    ``last_n`` then keeps only the most recent N of the remaining iterations.
    """
    clauses = []
    for col, val in (("Device", device), ("Ram", ram), ("Scenario", scenario)):
        clause = _in_clause(col, val)
        if clause:
            clauses.append(clause)
    if start_date:
        clauses.append(f"    | where Date >= '{_sanitize(start_date)}'")
    if end_date:
        clauses.append(f"    | where Date <= '{_sanitize(end_date)}'")

    kql = (
        _BASE
        + "\n".join(clauses)
        + '\n    | extend MetricTypeRank = case(MetricType == "PowerMetrics", 0, '
        'MetricType == "PowerCalculation", 1, MetricType == "PerfMetrics", 2, 99)'
        "\n    | order by Device asc, Ram asc, Scenario asc, Date desc, "
        "Iteration desc, MetricTypeRank asc, Name asc"
        "\n    | project Device, Ram, Scenario, Date, Iteration, "
        "MetricName = Name, Value, Unit, MetricType, Pt"
    )
    return _apply_last_n(_apply_iter_range(_run_query(kql), start_iter, end_iter), last_n)


# ── Transposed table view (parity with json_data.get_table_data) ──────────────
#
# TODO(post-merge): implement against the real Kusto schema. Each iteration
# column needs: DeviceConfig header attrs, power_calculation values, and the raw
# perf samples (grouped by Pt, original order, NOT de-duplicated) so the UI can
# compute "first value" and per-iteration P50/P70/P90. The DeviceConfig dynamic
# column carries cpu_mfg (IHV) / device_name / dut_type / LKG / os_build /
# HWVersion / battery_capacity_wh / memory_size_gb (Default RAM) /
# usable_ram_config_gb; perf samples live in
# the Pt/Value rows. Confirm the exact
# perf-sample shape once real rows exist, then return the same structure as
# json_data.get_table_data so the frontend stays source-agnostic.

def get_table_data(
    device: str = "",
    ram: str = "",
    scenario: str = "",
    start_date: str = "",
    end_date: str = "",
    last_n=None,
    start_iter=None,
    end_iter=None,
) -> list[dict]:
    raise NotImplementedError(
        "get_table_data is not yet implemented for the Kusto backend; it will be "
        "added once the DeviceConfig / Pt schema is deployed."
    )
