'use strict';

/**
 * app.js — vanilla JS frontend for design-frames-service. No build step, no
 * framework, matching this repo's existing convention (ui.html/code.js).
 * Talks to the REST API only; the API base defaults to same-origin so this
 * page works whether served by the service itself or reverse-proxied.
 */

const API_BASE = window.DESIGN_FRAMES_API_BASE || '';

const el = (id) => document.getElementById(id);
const listSection = el('feature-list-section');
const detailSection = el('feature-detail-section');
const featureListEl = el('feature-list');
const tokenInput = el('token');

function authHeaders(extra) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const token = tokenInput.value.trim();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function loadFeatureList() {
  featureListEl.innerHTML = '<li class="muted">loading…</li>';
  try {
    const { features } = await api('/api/v1/features');
    if (!features.length) {
      featureListEl.innerHTML = '<li class="muted">No features yet.</li>';
      return;
    }
    featureListEl.innerHTML = '';
    for (const f of features) {
      const approvedCount = f.flows.filter((fl) => fl.approved).length;
      const li = document.createElement('li');
      li.innerHTML = `<a href="#/${encodeURIComponent(f.slug)}">${escapeHtml(f.name)}</a>
        <span class="muted"> — ${escapeHtml(f.description || '')} (${f.frameCount} frames, ${approvedCount}/${f.flows.length} flows approved${f.sourceRepo ? `, for ${escapeHtml(f.sourceRepo)}` : ''})</span>`;
      featureListEl.appendChild(li);
    }
  } catch (err) {
    featureListEl.innerHTML = `<li class="muted">Failed to load: ${escapeHtml(err.message)}</li>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let current = null;

async function loadFeatureDetail(slug) {
  listSection.hidden = true;
  detailSection.hidden = false;
  el('feature-name').textContent = 'loading…';
  el('feature-description').textContent = '';
  el('frame-nav').innerHTML = '';
  el('flow-list').innerHTML = '';

  const { manifest } = await api(`/api/v1/features/${encodeURIComponent(slug)}`);
  current = { slug, manifest };

  el('feature-name').textContent = manifest.name;
  el('feature-description').textContent = manifest.description;
  el('feature-stamp').textContent = manifest.stamp ? manifest.stamp.slice(0, 12) + '…' : '(unstamped)';

  try {
    const stampInfo = await api(`/api/v1/features/${encodeURIComponent(slug)}/stamp`);
    el('stamp-state').textContent = stampInfo.current ? '✓ up to date' : '⚠ stale — recompute';
  } catch (_) { /* non-fatal */ }

  renderFrameNav();
  renderFlowList();

  if (manifest.frames && manifest.frames.length) selectFrame(manifest.frames[0]);
}

function renderFrameNav() {
  const nav = el('frame-nav');
  nav.innerHTML = '';
  for (const frame of current.manifest.frames || []) {
    const btn = document.createElement('button');
    btn.textContent = frame.label;
    btn.dataset.frameId = frame.id;
    btn.addEventListener('click', () => selectFrame(frame));
    nav.appendChild(btn);
  }
}

function selectFrame(frame) {
  document.querySelectorAll('#frame-nav button').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.frameId === frame.id));
  });
  el('frame-frame').src = `${API_BASE}/site/${encodeURIComponent(current.slug)}/${encodeURIComponent(frame.file)}`;
}

function renderFlowList() {
  const ul = el('flow-list');
  ul.innerHTML = '';
  const flows = (current.manifest.build && current.manifest.build.flows) || [];
  if (!flows.length) {
    ul.innerHTML = '<li class="muted">No flows declared.</li>';
    return;
  }
  for (const flow of flows) {
    const li = document.createElement('li');
    const state = document.createElement('span');
    state.className = `flow-state flow-state--${!!flow.approved}`;
    state.textContent = flow.approved ? 'approved' : 'pending';
    li.innerHTML = `<strong>${escapeHtml(flow.id)}</strong> <span class="muted">${escapeHtml(flow.orchestrator)} → ${escapeHtml(flow.route)}</span>`;
    li.appendChild(state);

    if (!flow.approved) {
      const approveBtn = document.createElement('button');
      approveBtn.className = 'approve';
      approveBtn.textContent = 'Approve';
      approveBtn.addEventListener('click', () => approveFlow(flow.id));
      li.appendChild(approveBtn);
    } else {
      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'reject';
      rejectBtn.textContent = 'Revoke';
      rejectBtn.addEventListener('click', () => rejectFlow(flow.id));
      li.appendChild(rejectBtn);
    }
    ul.appendChild(li);
  }
}

async function approveFlow(flowId) {
  const approvedBy = window.prompt('Approving as (name/handle):');
  if (!approvedBy) return;
  try {
    await api(`/api/v1/features/${encodeURIComponent(current.slug)}/flows/${encodeURIComponent(flowId)}/approve`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ approvedBy }),
    });
    await loadFeatureDetail(current.slug);
  } catch (err) {
    window.alert(`Approve failed: ${err.message}`);
  }
}

async function rejectFlow(flowId) {
  const reason = window.prompt('Reason for revoking approval (optional):') || undefined;
  try {
    await api(`/api/v1/features/${encodeURIComponent(current.slug)}/flows/${encodeURIComponent(flowId)}/reject`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reason }),
    });
    await loadFeatureDetail(current.slug);
  } catch (err) {
    window.alert(`Revoke failed: ${err.message}`);
  }
}

el('back-btn').addEventListener('click', () => {
  window.location.hash = '';
});

function route() {
  const hash = window.location.hash.replace(/^#\//, '');
  if (hash) {
    loadFeatureDetail(decodeURIComponent(hash)).catch((err) => {
      window.alert(`Failed to load feature: ${err.message}`);
      window.location.hash = '';
    });
  } else {
    detailSection.hidden = true;
    listSection.hidden = false;
    loadFeatureList();
  }
}

window.addEventListener('hashchange', route);
route();
