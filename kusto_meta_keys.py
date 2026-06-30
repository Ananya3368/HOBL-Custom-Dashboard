"""Dump the real keys/values inside Hobl_TestResultMetadata.Metadata so we can map
them correctly. Run on your laptop:  .\\venv\\Scripts\\python.exe kusto_meta_keys.py
"""

import json
import sys

import kusto_data as k


def main():
    print("Distinct keys present across all Metadata bags:")
    try:
        rows = k._run_query(
            "Hobl_TestResultMetadata\n"
            "| extend _md = parse_json(tostring(Metadata))\n"
            "| project keys = bag_keys(_md)\n"
            "| mv-expand keys\n"
            "| summarize by Key = tostring(keys)\n"
            "| order by Key asc"
        )
        for r in rows:
            print("   ", r.get("Key"))
    except Exception as exc:  # noqa: BLE001
        print(f"  ERROR: {type(exc).__name__}: {exc}")

    print("\nOne full Metadata bag (pretty-printed):")
    try:
        rows = k._run_query(
            "Hobl_TestResultMetadata | take 1 "
            "| project MetadataStr = tostring(Metadata)"
        )
        if rows:
            raw = rows[0].get("MetadataStr") or "{}"
            try:
                print(json.dumps(json.loads(raw), indent=2, sort_keys=True))
            except ValueError:
                print(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"  ERROR: {type(exc).__name__}: {exc}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
