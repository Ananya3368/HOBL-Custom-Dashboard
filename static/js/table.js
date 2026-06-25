// ── Table view (Excel-style transposed: iterations as columns) ──────────────
//
// Rows = metrics/attributes, columns = iterations (grouped by scenario, then by
// date within a scenario). Two modes:
//   curated=true  -> only the user-specified metrics, with first / P50-P70-P90.
//   curated=false -> every metric (all power + all perf samples).
//
// Depends on shared helpers from common.js: escapeHtml, fmtNum,
// valueAtPercentile, activeFilterSummary, showStatus, resultsDiv.

// Curated perf metrics, in display order. `pts` = acceptable Perftrack Ids
// (match any). `kind`: 'first' shows the first matching sample; 'pct' shows
// P50/P70/P90 computed across that iteration's samples. `name` matches a
// no-pt perf entry (e.g. teams_fps). N/A when nothing matches in a column.
const CURATED_PERF = [
    { label: 'Office-Outlook-Boot v2', kind: 'first', pts: [8804] },
    { label: 'Office-Word-Boot v2', kind: 'first', pts: [8805] },
    { label: 'Office-XL-Boot v2', kind: 'first', pts: [8806] },
    { label: 'Office-PPT-Boot v2', kind: 'first', pts: [8807] },
    { label: 'Edge Launch (First Launch)', kind: 'first', pts: [8998] },
    { label: 'Edge Page Load', kind: 'first', pts: [9412] },
    { label: 'Start Launch', kind: 'pct', pts: [1809, 9917] },
    { label: 'File Explorer Launch', kind: 'first', pts: [9475, 10052] },
    { label: 'Snipping Tool Overlay Launch Performance', kind: 'first', pts: [9971] },
    { label: 'Type-to-Search', kind: 'pct', pts: [2430, 9459] },
    { label: 'Search Full Activation', kind: 'pct', pts: [9232] },
    { label: 'Explorer Input Delay', kind: 'first', pts: [6352] },
    { label: 'Teams FPS', kind: 'first', pts: [], name: 'teams_fps' },
];

const HEADER_LABELS = ['IHV', 'OEM', 'Device', 'Device name', 'LKG', 'OS Build', 'HW Version (EV/DV)', 'Battery Capacity', 'Usable RAM'];
const POWER_LABELS = ['SoC Power (W)', 'Memory Power (W)', 'Display Power (W)', 'System Power (W)', 'Battery Life (hrs)'];

// Column indices that start a new scenario group (set by renderTableTransposed,
// read while emitting each cell so we can draw a divider on its left edge).
let _groupBoundaries = new Set();
function grpCls(i) { return _groupBoundaries.has(i) ? ' grp-start' : ''; }

// Collect a curated perf metric's matching samples within one column.
function curatedSamples(col, cfg) {
    if (cfg.pts && cfg.pts.length) {
        for (const pt of cfg.pts) {
            const arr = col.PerfByPt[pt];
            if (arr && arr.length) return arr;
        }
    }
    if (cfg.name && col.PerfByName[cfg.name] !== undefined) return [col.PerfByName[cfg.name]];
    return null;
}

function renderTableTransposed(cols, curated) {
    if (!cols || !cols.length) { showStatus('No data found for the selected filters.'); return; }

    // Group columns by scenario (contiguous, since backend sorts by scenario),
    // and by date *within* a scenario (so a date never merges across scenarios).
    const scenarioGroups = [];
    const dateGroups = [];
    cols.forEach(c => {
        let sg = scenarioGroups[scenarioGroups.length - 1];
        if (!sg || sg.scenario !== c.Scenario) { sg = { scenario: c.Scenario, cols: [] }; scenarioGroups.push(sg); }
        sg.cols.push(c);

        let dg = dateGroups[dateGroups.length - 1];
        if (!dg || dg.date !== c.Date || dg.scenario !== c.Scenario) {
            dg = { date: c.Date, scenario: c.Scenario, cols: [] }; dateGroups.push(dg);
        }
        dg.cols.push(c);
    });
    const nCols = cols.length;

    // Mark the first column index of each scenario group as a boundary so we
    // can draw a divider line on the left edge of those cells.
    _groupBoundaries = new Set();
    { let idx = 0; scenarioGroups.forEach((g, gi) => { if (gi > 0) _groupBoundaries.add(idx); idx += g.cols.length; }); }

    const td = (s, cls) => `<td${cls ? ` class="${cls}"` : ''}>${s}</td>`;
    const labelCell = s => `<td class="row-label">${escapeHtml(s)}</td>`;
    const join = (base, i) => (base + grpCls(i)).trim();

    let body = '';

    // DUT header rows (one value per column).
    HEADER_LABELS.forEach(lbl => {
        body += `<tr class="hdr-row">` + labelCell(lbl) +
            cols.map((c, i) => td(escapeHtml(String(c.Header[lbl] ?? '')), join('', i))).join('') + `</tr>`;
    });

    // Scenario row (merged per scenario group).
    body += `<tr class="scenario-row">` + `<td class="row-label">Scenario</td>` +
        scenarioGroups.map((g, gi) => `<td class="${gi > 0 ? 'scenario-cell grp-start' : 'scenario-cell'}" colspan="${g.cols.length}">${escapeHtml(g.scenario)}</td>`).join('') + `</tr>`;

    // Date row (merged per date group, broken on scenario change).
    body += `<tr class="date-row">` + `<td class="row-label">Date</td>` +
        (() => { let idx = 0; return dateGroups.map(g => { const cell = td(escapeHtml(g.date), join('date-cell', idx) + `" colspan="${g.cols.length}`); idx += g.cols.length; return cell; }).join(''); })() + `</tr>`;

    // File Path row = run_number.
    body += `<tr class="filepath-row">` + `<td class="row-label">File Path</td>` +
        cols.map((c, i) => td(escapeHtml(String(c.Iteration ?? '')), join('', i))).join('') + `</tr>`;

    // Iteration row = 1..N per scenario group.
    body += `<tr class="iter-row">` + `<td class="row-label">Iteration</td>` +
        (() => { let idx = 0; return scenarioGroups.map(g => g.cols.map((c, i) => td(String(i + 1), join('', idx++))).join('')).join(''); })() + `</tr>`;

    // Power Metrics section.
    body += `<tr class="section-row"><td class="row-label" colspan="${nCols + 1}">Power Metrics</td></tr>`;
    POWER_LABELS.forEach(lbl => {
        body += `<tr>` + labelCell(lbl) +
            cols.map((c, i) => td(fmtNum(c.Power[lbl]), join('num', i))).join('') + `</tr>`;
    });

    // Performance Metrics section.
    body += `<tr class="section-row"><td class="row-label" colspan="${nCols + 1}">Performance Metrics</td></tr>`;
    body += curated ? curatedPerfRows(cols) : allPerfRows(cols);

    const html = `
    <div class="table-wrapper">
        <div class="results-summary">${activeFilterSummary()} &nbsp;|&nbsp; ${nCols} iteration(s)</div>
        <div class="xtable-scroll">
            <table class="xtable">
                <tbody>${body}</tbody>
            </table>
        </div>
    </div>`;
    resultsDiv.innerHTML = html;
}

// Curated perf rows: first-value or P50/P70/P90 (collapsed if all equal).
function curatedPerfRows(cols) {
    const td = (s, cls) => `<td${cls ? ` class="${cls}"` : ''}>${s}</td>`;
    const labelCell = s => `<td class="row-label">${escapeHtml(s)}</td>`;
    let out = '';

    CURATED_PERF.forEach(cfg => {
        if (cfg.kind === 'first') {
            out += `<tr>` + labelCell(cfg.label) + cols.map((c, i) => {
                const s = curatedSamples(c, cfg);
                return td(s ? fmtNum(s[0]) : 'N/A', ((s ? 'num' : 'na') + grpCls(i)));
            }).join('') + `</tr>`;
        } else {
            // Per-column P50/P70/P90.
            const p50 = [], p70 = [], p90 = [];
            cols.forEach(c => {
                const s = curatedSamples(c, cfg);
                if (s) {
                    const sorted = s.slice().sort((a, b) => a - b);
                    p50.push(valueAtPercentile(sorted, 50));
                    p70.push(valueAtPercentile(sorted, 70));
                    p90.push(valueAtPercentile(sorted, 90));
                } else { p50.push(null); p70.push(null); p90.push(null); }
            });
            const equal = p50.every((v, i) => v === p70[i] && v === p90[i]);
            const rowFor = (label, arr) =>
                `<tr>` + labelCell(label) +
                arr.map((v, i) => td(v === null ? 'N/A' : fmtNum(v), ((v === null ? 'na' : 'num') + grpCls(i)))).join('') + `</tr>`;
            if (equal) {
                out += rowFor(cfg.label, p50);
            } else {
                out += rowFor(cfg.label + ' P50', p50);
                out += rowFor(cfg.label + ' P70', p70);
                out += rowFor(cfg.label + ' P90', p90);
            }
        }
    });
    return out;
}

// All-metrics perf rows: every metric, all sample values listed per column.
function allPerfRows(cols) {
    const td = (s, cls) => `<td${cls ? ` class="${cls}"` : ''}>${s}</td>`;
    const labelCell = s => `<td class="row-label">${escapeHtml(s)}</td>`;

    // Union of all perf identities across columns. Key by pt when present,
    // else by name. Keep a friendly display name.
    const order = [];
    const seen = new Map();
    cols.forEach(c => {
        c.PerfAll.forEach(p => {
            const key = (p.pt !== null && p.pt !== undefined) ? 'pt:' + p.pt : 'nm:' + p.name;
            if (!seen.has(key)) {
                seen.set(key, { key, pt: p.pt, name: p.name });
                order.push(key);
            }
        });
    });

    let out = '';
    order.forEach(key => {
        const meta = seen.get(key);
        const label = meta.name + (meta.pt != null ? ` (pt ${meta.pt})` : '');
        out += `<tr>` + labelCell(label) + cols.map((c, i) => {
            let vals;
            if (meta.pt != null) vals = c.PerfByPt[meta.pt];
            else vals = (c.PerfByName[meta.name] !== undefined) ? [c.PerfByName[meta.name]] : null;
            if (!vals || !vals.length) return td('N/A', ('na' + grpCls(i)));
            return td(vals.map(fmtNum).join(', '), ('num' + grpCls(i)));
        }).join('') + `</tr>`;
    });

    // Also list all power_metrics (pm_emi_*) in the all view.
    const pmNames = [];
    const pmSeen = new Set();
    cols.forEach(c => Object.keys(c.PowerMetrics).forEach(n => { if (!pmSeen.has(n)) { pmSeen.add(n); pmNames.push(n); } }));
    if (pmNames.length) {
        out += `<tr class="section-row"><td class="row-label" colspan="${cols.length + 1}">Power Metrics (raw rails)</td></tr>`;
        pmNames.forEach(n => {
            out += `<tr>` + labelCell(n) + cols.map((c, i) => {
                const e = c.PowerMetrics[n];
                return td(e ? fmtNum(e.value) : 'N/A', (e ? 'num' : 'na') + grpCls(i));
            }).join('') + `</tr>`;
        });
    }
    return out;
}
