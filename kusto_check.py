"""Standalone live test for the Kusto backend (run on your own laptop).

Why this exists: the dashboard's Kusto backend uses InteractiveBrowserCredential,
which signs in from whatever machine runs the code. Run THIS on your laptop (a
device your org trusts) and the Azure sign-in will succeed; a browser window opens
once, you pick your account, and the script then exercises the same three
functions the dashboard calls:

    get_filter_options()  -> the filter dropdown values
    get_metrics(...)      -> per-metric rows (box / percentile views)
    get_table_data(...)   -> per-iteration columns (table views)

Usage (from the repo folder, with the venv active or via the venv python):

    .\\venv\\Scripts\\python.exe kusto_check.py

It prints row counts plus a small sample of each result. If the tables are still
empty you'll see zero rows but NO error, which already confirms auth + the KQL are
working. Paste the output back if anything looks off.
"""

import json
import sys

import kusto_data


def _section(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main():
    print("HOBL Kusto backend live check")
    print(f"  Cluster : {kusto_data.config.KUSTO_CLUSTER}")
    print(f"  Database: {kusto_data.config.KUSTO_DATABASE}")
    print(f"  Table   : {kusto_data.config.KUSTO_TABLE}")
    print("\nA browser window should open for Azure sign-in (first call only)...")

    try:
        _section("1) get_filter_options()")
        opts = kusto_data.get_filter_options()
        for key in ("devices", "rams", "scenarios", "dates"):
            vals = opts.get(key, [])
            print(f"  {key:10s}: {len(vals)} value(s) -> {vals[:10]}")

        _section("2) get_metrics()  (no filters, first 5 rows)")
        metrics = kusto_data.get_metrics()
        print(f"  total rows: {len(metrics)}")
        for row in metrics[:5]:
            print("   ", json.dumps(row, default=str))

        _section("3) get_table_data()  (no filters, first column summarised)")
        cols = kusto_data.get_table_data()
        print(f"  total iteration-columns: {len(cols)}")
        if cols:
            c = cols[0]
            print("    Device / Ram / Scenario / Date / Iteration:",
                  c["Device"], "/", c["Ram"], "/", c["Scenario"], "/",
                  c["Date"], "/", c["Iteration"])
            print("    Header keys      :", list(c["Header"].keys()))
            print("    Power            :", c["Power"])
            print("    PowerCalculation :", len(c["PowerCalculation"]), "metric(s)")
            print("    PowerMetrics     :", len(c["PowerMetrics"]), "rail(s)")
            print("    PerfByPt pts     :", list(c["PerfByPt"].keys())[:20])
            print("    PerfByName names :", list(c["PerfByName"].keys())[:20])

        _section("4) Sanity: distinct scenarios + PerfMetrics name parsing")
        scn_kql = kusto_data._joined([]) + "| distinct Scenario"
        scenarios = sorted(
            r.get("Scenario") for r in kusto_data._run_query(scn_kql) if r.get("Scenario")
        )
        print(f"  distinct scenarios ({len(scenarios)}):", scenarios[:50])
        perf_kql = (
            kusto_data._joined([])
            + "| where MetricType == 'PerfMetrics'\n| distinct Name\n| take 15"
        )
        perf_names = [r.get("Name") for r in kusto_data._run_query(perf_kql)]
        if not perf_names:
            print("  PerfMetrics names: (none yet)")
        else:
            print("  PerfMetrics name -> parsed (base, pt, order):")
            for name in perf_names:
                parsed = kusto_data._parse_perf_name(kusto_data._normalize_name(name))
                print(f"    {str(name)!r:52s} -> {parsed}")

        _section("5) Iteration ranking is by RunDate, NOT the iteration number")
        diag_kql = (
            kusto_data._joined([])
            + "| summarize RawIter = min(Iteration), MetaIter = take_any(M_IterNum),\n"
            "    RunTs = take_any(RunTs), BuildDate = take_any(BuildDate)\n"
            "    by TRID, TestName, Scenario\n"
            "| sort by RunTs desc\n"
            "| take 25"
        )
        print("  Per-run fields (latest RunDate first):")
        for r in kusto_data._run_query(diag_kql):
            print("    TestName=%-22s Scenario=%-18s RunTs=%s  RawIter=%s  MetaIter=%s"
                  % (str(r.get("TestName"))[:22], str(r.get("Scenario"))[:18],
                     r.get("RunTs"), r.get("RawIter"), r.get("MetaIter")))

        from collections import Counter
        combo_counts = Counter((c["Device"], c["Ram"], c["Scenario"]) for c in cols)
        if combo_counts:
            (d, rmem, s), n = combo_counts.most_common(1)[0]
            subset = sorted(
                (c["Date"], c["Iteration"]) for c in cols
                if (c["Device"], c["Ram"], c["Scenario"]) == (d, rmem, s)
            )
            picked = kusto_data.get_table_data(device=d, ram=rmem, scenario=s, last_n=3)
            print(f"\n  Busiest combo {d} / {rmem} / {s}: {n} run(s)")
            print("    all runs (date, iter):", subset)
            print("    last_n=3 keeps        :",
                  [(c["Date"], c["Iteration"]) for c in picked])
            print("    (expect the 3 latest-by-RunDate runs; iteration numbers may be"
                  " out of order \u2014 that's fine, ranking is by date.)")

        _section("RESULT")
        if not metrics and not cols:
            print("  Auth + queries succeeded, but the tables returned NO rows.")
            print("  (Expected until data is ingested into Hobl_RawMetrics /")
            print("   Hobl_TestResultMetadata.) The backend is wired correctly.")
        else:
            print("  SUCCESS - live data returned from Kusto.")
        return 0

    except Exception as exc:  # noqa: BLE001
        _section("ERROR")
        print(f"  {type(exc).__name__}: {exc}")
        print("\n  If this is an authorization/Conditional-Access error, make sure")
        print("  you are running this ON YOUR OWN LAPTOP (not a remote/hosted shell)")
        print("  and signing in with the account that has Kusto access.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
