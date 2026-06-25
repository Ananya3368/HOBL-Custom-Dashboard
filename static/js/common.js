// ── Shared dashboard infrastructure ─────────────────────────────
//
// Loaded first. Owns DOM references, the filter bar (multi-selects + dates +
// last-N), data fetching, cross-view state, generic helpers, and the bootstrap
// that wires up event listeners. Each viewer (table.js / box.js /
// percentile.js) defines its own render function which renderCurrentView()
// dispatches to.

const startDate = document.getElementById('startDate');
const endDate = document.getElementById('endDate');
const lastN = document.getElementById('lastN');
const applyBtn = document.getElementById('applyBtn');
const resetBtn = document.getElementById('resetBtn');
const viewSelect = document.getElementById('viewSelect');
const resultsDiv = document.getElementById('results');
const metricModal = document.getElementById('metricModal');
const modalTitle = document.getElementById('modalTitle');
const modalChart = document.getElementById('modalChart');
const modalClose = document.getElementById('modalClose');

// ── Multi-select checkbox dropdown ──────────────────────────────
// Lightweight component: a toggle button showing a summary, plus a panel
// with "Select all" / "Clear" links and one checkbox per option.
const _allMultiSelects = [];
function createMultiSelect(container, opts) {
    opts = opts || {};
    const allLabel = opts.allLabel || 'All';
    const formatLabel = opts.formatLabel || (v => String(v));
    let values = [];
    const selected = new Set();

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'ms-toggle';
    const text = document.createElement('span');
    text.className = 'ms-text';
    const caret = document.createElement('span');
    caret.className = 'ms-caret';
    caret.textContent = '\u25be';
    toggle.appendChild(text);
    toggle.appendChild(caret);

    const panel = document.createElement('div');
    panel.className = 'ms-panel';
    panel.style.display = 'none';

    const actions = document.createElement('div');
    actions.className = 'ms-actions';
    const selAll = document.createElement('a');
    selAll.href = '#'; selAll.textContent = 'Select all';
    const clr = document.createElement('a');
    clr.href = '#'; clr.textContent = 'Clear';
    actions.appendChild(selAll);
    actions.appendChild(clr);
    panel.appendChild(actions);

    const list = document.createElement('div');
    list.className = 'ms-list';
    panel.appendChild(list);

    container.appendChild(toggle);
    container.appendChild(panel);

    function updateText() {
        if (selected.size === 0 || selected.size === values.length) {
            text.textContent = `${allLabel} (${values.length})`;
        } else if (selected.size === 1) {
            text.textContent = formatLabel(Array.from(selected)[0]);
        } else {
            text.textContent = `${selected.size} selected`;
        }
    }

    function render() {
        list.innerHTML = '';
        values.forEach(v => {
            const item = document.createElement('label');
            item.className = 'ms-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = selected.has(v);
            cb.addEventListener('change', () => {
                if (cb.checked) selected.add(v); else selected.delete(v);
                updateText();
            });
            const span = document.createElement('span');
            span.textContent = formatLabel(v);
            item.appendChild(cb);
            item.appendChild(span);
            list.appendChild(item);
        });
        updateText();
    }

    toggle.addEventListener('click', e => {
        e.stopPropagation();
        const open = panel.style.display !== 'none';
        _allMultiSelects.forEach(ms => ms._close());
        panel.style.display = open ? 'none' : 'block';
    });
    selAll.addEventListener('click', e => {
        e.preventDefault();
        values.forEach(v => selected.add(v));
        render();
    });
    clr.addEventListener('click', e => {
        e.preventDefault();
        selected.clear();
        render();
    });

    const api = {
        setOptions(items) {
            values = (items || []).map(String);
            selected.clear();
            render();
        },
        getSelected() { return Array.from(selected); },
        clear() { selected.clear(); render(); },
        _close() { panel.style.display = 'none'; },
    };
    _allMultiSelects.push(api);
    return api;
}

const deviceMS = createMultiSelect(document.getElementById('deviceMS'), { allLabel: 'All devices' });
const ramMS = createMultiSelect(document.getElementById('ramMS'), { allLabel: 'All RAM configs', formatLabel: v => `${v} GB` });
const scenarioMS = createMultiSelect(document.getElementById('scenarioMS'), { allLabel: 'All scenarios' });

// Close any open multi-select panel when clicking outside.
document.addEventListener('click', () => { _allMultiSelects.forEach(ms => ms._close()); });

// ── Cross-view state ────────────────────────────────────────────
// Last fetched metrics, so switching views doesn't require a refetch.
let currentMetrics = null;
let currentTable = null;   // per-iteration columns for the transposed table views
let lastParams = '';

// Remembers the metric chosen in the Percentile Distribution view so it
// survives re-renders (e.g. switching metric without refetching).
let pctMetricName = null;

// Stable device→color map so a device keeps the same color in the main
// box charts, the legend, and the zoomed-in modal.
const DEVICE_COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];
let deviceColorMap = {};

function buildDeviceColorMap(metrics) {
    const devices = Array.from(new Set(metrics.map(m => m.Device))).sort();
    deviceColorMap = {};
    devices.forEach((d, i) => { deviceColorMap[d] = DEVICE_COLORS[i % DEVICE_COLORS.length]; });
}

function colorFor(device) {
    return deviceColorMap[device] || DEVICE_COLORS[0];
}

// ── Helpers ─────────────────────────────────────────────────────

function showStatus(msg, isError = false) {
    resultsDiv.innerHTML = `<div class="status ${isError ? 'error' : ''}">${msg}</div>`;
}

function showLoading(msg = 'Loading...') {
    resultsDiv.innerHTML = `<div class="status"><div class="spinner"></div><br>${msg}</div>`;
}

async function fetchJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) {
        let detail = `Request failed: ${resp.status}`;
        try { const j = await resp.json(); if (j && j.error) detail = j.error; } catch (e) {}
        throw new Error(detail);
    }
    return resp.json();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function fmtNum(v) {
    if (v === null || v === undefined || v === '' || Number.isNaN(v)) return '';
    if (typeof v !== 'number') return escapeHtml(String(v));
    return Number.isInteger(v) ? String(v) : (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3));
}

// Linear-interpolated value at percentile p (0–100) of an ascending array.
// Shared by the table's P50/P70/P90 columns and the Percentile view.
function valueAtPercentile(sorted, p) {
    const n = sorted.length;
    if (n === 0) return null;
    if (n === 1) return sorted[0];
    const pos = (p / 100) * (n - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (pos - lo) * (sorted[hi] - sorted[lo]);
}

// ── Load filter options on page load ───────────────────────────

async function loadFilters() {
    try {
        const opts = await fetchJson('/api/filters');
        if (opts.error) {
            showStatus('Error loading filters: ' + opts.error, true);
            return;
        }
        deviceMS.setOptions(opts.devices || []);
        ramMS.setOptions(opts.rams || []);
        scenarioMS.setOptions(opts.scenarios || []);
        // Constrain the date pickers to the available range and default to it.
        const dates = (opts.dates || []).slice().sort();  // ascending
        if (dates.length) {
            const min = dates[0];
            const max = dates[dates.length - 1];
            startDate.min = min; startDate.max = max; startDate.value = min;
            endDate.min = min; endDate.max = max; endDate.value = max;
        }
    } catch (e) {
        showStatus('Failed to load filters: ' + e.message, true);
    }
}

// ── Apply / Reset ──────────────────────────────────────────────

async function applyFilters() {
    const useLastN = lastN.value && Number(lastN.value) > 0;
    if (!useLastN && startDate.value && endDate.value && startDate.value > endDate.value) {
        showStatus('Start date must be on or before end date.', true);
        return;
    }
    const params = new URLSearchParams();
    deviceMS.getSelected().forEach(v => params.append('device', v));
    ramMS.getSelected().forEach(v => params.append('ram', v));
    scenarioMS.getSelected().forEach(v => params.append('scenario', v));
    // Date range and Last-N are mutually exclusive: Last-N takes precedence.
    if (useLastN) {
        params.set('last_n', lastN.value);
    } else {
        if (startDate.value) params.set('start_date', startDate.value);
        if (endDate.value) params.set('end_date', endDate.value);
    }

    showLoading('Fetching metrics...');
    lastParams = params.toString();
    try {
        const [metrics, table] = await Promise.all([
            fetchJson('/api/metrics?' + lastParams),
            fetchJson('/api/table?' + lastParams),
        ]);
        if (metrics.error) { showStatus('Error loading metrics: ' + metrics.error, true); return; }
        currentMetrics = (metrics && metrics.length) ? metrics : null;
        currentTable = (table && table.length) ? table : null;
        if (!currentMetrics && !currentTable) {
            showStatus('No data found for the selected filters.');
            return;
        }
        renderCurrentView();
    } catch (e) {
        showStatus('Failed to load data: ' + e.message, true);
    }
}

// Re-render the already-fetched data in whichever view is selected.
// The render functions live in table.js / box.js / percentile.js.
function renderCurrentView() {
    const v = viewSelect.value;
    if (v === 'box') {
        if (currentMetrics) renderBoxplots(currentMetrics);
    } else if (v === 'percentile') {
        if (currentMetrics) renderPercentile(currentMetrics);
    } else if (v === 'table_all') {
        if (currentTable) renderTableTransposed(currentTable, false);
        else showStatus('No data found for the selected filters.');
    } else {
        if (currentTable) renderTableTransposed(currentTable, true);
        else showStatus('No data found for the selected filters.');
    }
}

function resetFilters() {
    deviceMS.clear();
    ramMS.clear();
    scenarioMS.clear();
    startDate.value = startDate.min || '';
    endDate.value = endDate.max || '';
    lastN.value = '';
    syncExclusiveFilters();
    pctMetricName = null;
    currentMetrics = null;
    showStatus('Choose any filters (or none) and click <strong>Apply</strong> to view metrics.');
}

function activeFilterSummary() {
    const parts = [];
    const dev = deviceMS.getSelected();
    const ram = ramMS.getSelected();
    const scn = scenarioMS.getSelected();
    parts.push(`Device: <strong>${dev.length ? escapeHtml(dev.join(', ')) : 'All'}</strong>`);
    parts.push(`RAM: <strong>${ram.length ? escapeHtml(ram.map(r => r + ' GB').join(', ')) : 'All'}</strong>`);
    parts.push(`Scenario: <strong>${scn.length ? escapeHtml(scn.join(', ')) : 'All'}</strong>`);
    const useLastN = lastN.value && Number(lastN.value) > 0;
    if (useLastN) {
        parts.push(`Dates: <strong>All</strong>`);
        parts.push(`Last <strong>${escapeHtml(lastN.value)}</strong> iter.`);
    } else {
        const range = (startDate.value || endDate.value)
            ? `${escapeHtml(startDate.value || '…')} → ${escapeHtml(endDate.value || '…')}`
            : 'All';
        parts.push(`Dates: <strong>${range}</strong>`);
    }
    return parts.join(' &nbsp;|&nbsp; ');
}

// ── Init ───────────────────────────────────────────────────────
// Date range and Last-N are mutually exclusive. Entering a Last-N value
// disables (greys out) the date pickers; clearing it re-enables them.
function syncExclusiveFilters() {
    const useLastN = lastN.value && Number(lastN.value) > 0;
    startDate.disabled = useLastN;
    endDate.disabled = useLastN;
    startDate.classList.toggle('disabled', useLastN);
    endDate.classList.toggle('disabled', useLastN);
}

// Wire up event listeners once every viewer module has loaded and defined its
// globals (closeMetricModal lives in box.js, render*() in the viewer files).
document.addEventListener('DOMContentLoaded', () => {
    applyBtn.addEventListener('click', applyFilters);
    resetBtn.addEventListener('click', resetFilters);
    viewSelect.addEventListener('change', renderCurrentView);
    lastN.addEventListener('input', syncExclusiveFilters);
    modalClose.addEventListener('click', closeMetricModal);
    metricModal.addEventListener('click', evt => { if (evt.target === metricModal) closeMetricModal(); });
    document.addEventListener('keydown', evt => { if (evt.key === 'Escape' && !metricModal.hidden) closeMetricModal(); });
    loadFilters();
});
