"""Diagnostic: figure out whether 0 rows is empty tables vs a broken join.

Run on your laptop:  .\\venv\\Scripts\\python.exe kusto_diag.py

It runs small, independent probes (NOT the dashboard join) so we can see exactly
where the data is.
"""

import json
import sys

import kusto_data as k


def probe(label, kql):
    print("\n" + "-" * 70)
    print(label)
    print("  KQL:", kql.replace("\n", " "))
    try:
        rows = k._run_query(kql)
        print(f"  -> {len(rows)} row(s)")
        for r in rows[:5]:
            print("    ", json.dumps(r, default=str)[:400])
        return rows
    except Exception as exc:  # noqa: BLE001
        print(f"  ERROR: {type(exc).__name__}: {exc}")
        return []


def main():
    M = "Hobl_RawMetrics"
    MD = "Hobl_TestResultMetadata"

    probe("A) Hobl_RawMetrics total count", f"{M} | count")
    probe("B) Hobl_TestResultMetadata total count", f"{MD} | count")

    probe("C) Hobl_RawMetrics sample (raw)", f"{M} | take 3")
    probe("D) Metadata sample (raw, Metadata as string)",
          f"{MD} | take 3 | project TestResultId, TestName, "
          "MetadataStr = tostring(Metadata)")

    probe("E) Distinct MetricType in RawMetrics", f"{M} | distinct MetricType")

    probe("F) RawMetrics distinct TestResultId (first 5)",
          f"{M} | distinct TestResultId | take 5")
    probe("G) Metadata distinct TestResultId (first 5)",
          f"{MD} | distinct TestResultId | take 5")

    probe("H) JOIN count on TestResultId (tostring both sides)",
          f"{M} | extend TRID = tostring(TestResultId) "
          f"| join kind=inner ({MD} | extend TRID = tostring(TestResultId)) on TRID "
          "| count")

    probe("I) Metadata key check (DeviceName / usable_Ram_config_gb / TierDisplayName)",
          f"{MD} | take 3 | extend _md = parse_json(tostring(Metadata)) "
          "| project DeviceName = tostring(_md.DeviceName), "
          "UsableRam = tostring(_md['usable_Ram_config_gb']), "
          "Tier = tostring(_md.TierDisplayName)")

    print("\n" + "=" * 70)
    print("Interpretation:")
    print("  - If A and B are both 0  -> tables are simply empty (ingest pending).")
    print("  - If A,B > 0 but H = 0   -> TestResultId values don't match across tables.")
    print("  - If I shows blank keys  -> Metadata dynamic uses different key names.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
