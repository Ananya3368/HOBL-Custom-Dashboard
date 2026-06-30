"""Verify the CORRECTED Metadata key mapping resolves against live metadata
(Hobl_TestResultMetadata has rows even though Hobl_RawMetrics is still empty).

Run on your laptop:  .\\venv\\Scripts\\python.exe kusto_meta_verify.py
"""

import json
import sys

import kusto_data as k


def main():
    kql = (
        "Hobl_TestResultMetadata\n"
        "| extend _md = parse_json(tostring(Metadata))\n"
        "| extend Device = tostring(_md.DeviceName),\n"
        "    Ram = tostring(_md.UsableRam),\n"
        "    Host = tostring(_md.hostname),\n"
        "    DUTType = tostring(_md.DUTType),\n"
        "    IHV = tostring(_md.IHV),\n"
        "    LKG = tostring(_md.LKG),\n"
        "    OSBuild = tostring(_md.OSBuild),\n"
        "    HWVersion = tostring(_md.HWVersion),\n"
        "    Battery = tostring(_md.BatteryCapacity_wh),\n"
        "    DefaultRam = tostring(_md.DefaultRam),\n"
        "    Tier = tostring(_md.TierDefinitionKey)\n"
        "| extend _prefix = strcat(Device, '_', Ram, '_')\n"
        "| extend Scenario = iif(isnotempty(Device) and isnotempty(Ram) and "
        "(Tier startswith_cs _prefix), substring(Tier, strlen(_prefix)), Tier)\n"
        "| project Device, Ram, Host, DUTType, IHV, LKG, OSBuild, HWVersion, "
        "Battery, DefaultRam, Tier, Scenario\n"
        "| take 8"
    )
    print("Corrected metadata mapping (live, first 8 rows):\n")
    try:
        rows = k._run_query(kql)
        for r in rows:
            print(json.dumps(r, default=str))
        print(f"\n{len(rows)} row(s).")
        if rows:
            blanks = [key for key, val in rows[0].items() if val in (None, "")]
            print("Blank fields in row 1 (expected: OEM absent so not shown here):",
                  blanks or "none")
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {type(exc).__name__}: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
