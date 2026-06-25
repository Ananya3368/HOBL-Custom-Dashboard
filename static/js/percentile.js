// ── Percentile Distribution view ────────────────────────────────────────────
//
// X axis = percentile (0–100), Y axis = the metric's value. For a single
// device/RAM/scenario, the chosen metric's values across the selected
// iterations ("Last N Iterations") are sorted ascending and spread across the
// percentile axis: rank i of n maps to percentile i/(n-1)*100. P50/P70/P90 are
// computed by linear interpolation and annotated.
//
// Depends on shared helpers from common.js: activeFilterSummary, escapeHtml,
// colorFor, valueAtPercentile, resultsDiv, pctMetricName.

function renderPercentile(metrics) {
    // The percentile view describes ONE config. Bail out clearly if the current
    // filters span multiple devices / RAM configs / scenarios.
    const groups = Array.from(new Set(metrics.map(m => [m.Device, m.Ram, m.Scenario].join('\u0001'))));
    if (groups.length > 1) {
        resultsDiv.innerHTML =
            `<div class="results-summary">${activeFilterSummary()} &nbsp;|&nbsp; ${metrics.length} metric(s)</div>` +
            `<div class="chart-note">The Percentile Distribution view shows one configuration at a time. ` +
            `Please narrow the filters to a single <strong>Device</strong>, <strong>RAM</strong>, and <strong>Scenario</strong> ` +
            `(currently ${groups.length} combinations match).</div>`;
        return;
    }

    // Distinct metrics for this config, ordered by metric type then name.
    const typeRank = { PowerMetrics: 0, PowerCalculation: 1, PerfMetrics: 2 };
    const byName = {};
    metrics.forEach(m => { (byName[m.MetricName] = byName[m.MetricName] || []).push(m); });
    const names = Object.keys(byName).sort((a, b) => {
        const ra = typeRank[byName[a][0].MetricType] ?? 9, rb = typeRank[byName[b][0].MetricType] ?? 9;
        return ra - rb || a.localeCompare(b);
    });

    if (pctMetricName === null || !byName[pctMetricName]) pctMetricName = names[0];

    const options = names.map(n =>
        `<option value="${escapeHtml(n)}"${n === pctMetricName ? ' selected' : ''}>${escapeHtml(n)}</option>`
    ).join('');

    resultsDiv.innerHTML = `
        <div class="results-summary">${activeFilterSummary()} &nbsp;|&nbsp; ${metrics.length} metric(s)</div>
        <div class="chart-card">
            <div class="pct-controls">
                <label for="pctMetric">Metric:</label>
                <select id="pctMetric">${options}</select>
            </div>
            <div class="chart-sub">Values across the selected iterations, sorted and spread over the 0–100 percentile axis. Set <strong>Last N Iterations</strong> to choose how many recent iterations to include.</div>
            <div id="pctChart"></div>
        </div>`;

    const sel = document.getElementById('pctMetric');
    sel.addEventListener('change', () => { pctMetricName = sel.value; drawPercentileChart(byName[pctMetricName]); });
    drawPercentileChart(byName[pctMetricName]);
}

function drawPercentileChart(rows) {
    const el = document.getElementById('pctChart');
    const m0 = rows[0];
    const device = m0.Device;
    const unit = m0.Unit && m0.Unit !== 'N/A' ? m0.Unit : '';
    const color = colorFor(device);

    // Each iteration contributes one value; sort ascending.
    const values = rows.map(r => Number(r.Value)).filter(Number.isFinite).sort((a, b) => a - b);
    if (!values.length) {
        el.innerHTML = '<div class="chart-empty">No numeric values for this metric.</div>';
        return;
    }

    const n = values.length;
    const xs = values.map((_, i) => (n === 1 ? 50 : (i / (n - 1)) * 100));

    const lineTrace = {
        type: 'scatter',
        mode: 'lines+markers',
        name: device,
        x: xs,
        y: values,
        line: { color: color, width: 2 },
        marker: { color: color, size: 6 },
        hovertemplate: 'Percentile %{x:.0f}<br>Value %{y}' + (unit ? ' ' + unit : '') + '<extra></extra>',
    };

    // P50 / P70 / P90 reference markers + annotations.
    const refs = [50, 70, 90];
    const refColors = { 50: '#8B0000', 70: '#E67E00', 90: '#1a237e' };
    const shapes = [], annotations = [];
    const refTrace = { type: 'scatter', mode: 'markers', x: [], y: [], showlegend: false,
        marker: { color: [], size: 11, symbol: 'diamond', line: { color: '#333', width: 1 } },
        hovertemplate: 'P%{x:.0f}<br>%{y:.1f}' + (unit ? ' ' + unit : '') + '<extra></extra>' };
    refs.forEach(p => {
        const v = valueAtPercentile(values, p);
        shapes.push({ type: 'line', x0: p, x1: p, yref: 'paper', y0: 0, y1: 1,
            line: { color: refColors[p], width: 1, dash: 'dash' } });
        refTrace.x.push(p); refTrace.y.push(v); refTrace.marker.color.push(refColors[p]);
        annotations.push({ x: p, y: v, text: `P${p}: ${v.toFixed(1)}${unit ? ' ' + unit : ''}`,
            showarrow: true, arrowhead: 0, ax: 0, ay: -28,
            bgcolor: refColors[p], font: { color: 'white', size: 11 }, bordercolor: refColors[p] });
    });

    const layout = {
        height: 460,
        margin: { l: 70, r: 30, t: 20, b: 50 },
        xaxis: { title: 'Percentile', range: [-2, 102], dtick: 10, gridcolor: '#eee', zeroline: false },
        yaxis: { title: unit ? `Value (${unit})` : 'Value', gridcolor: '#eee', zeroline: false },
        shapes: shapes,
        annotations: annotations,
        showlegend: true,
        legend: { orientation: 'h', y: 1.08, x: 0 },
        font: { family: 'Segoe UI, Tahoma, sans-serif', size: 12 },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
    };

    Plotly.newPlot('pctChart', [lineTrace, refTrace], layout, { responsive: true, displayModeBar: false });
}
