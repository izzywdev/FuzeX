'use strict';

const { ValidationError } = require('./store');

const ENGINE = 'deterministic-wireframe-v1';
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAMP = /^[a-f0-9]{64}$/;

function object(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ValidationError(`${label} contains unknown fields`, unknown);
}

function text(value, label, max, optional = false) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ValidationError(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

/** Validate before constructing or persisting any output; callers cannot submit HTML. */
function validateBrief(input) {
  object(input, ['flowId', 'title', 'goal', 'audience', 'steps'], 'brief');
  const flowId = text(input.flowId, 'flowId', 64);
  if (!KEY.test(flowId)) throw new ValidationError('flowId must be a lowercase hyphenated key');
  if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 12) {
    throw new ValidationError('steps must contain between 1 and 12 screens');
  }
  return {
    flowId,
    title: text(input.title, 'title', 160),
    goal: text(input.goal, 'goal', 2000),
    ...(input.audience !== undefined ? { audience: text(input.audience, 'audience', 500) } : {}),
    steps: input.steps.map((step, index) => {
      object(step, ['title', 'description', 'action'], `steps[${index}]`);
      return {
        title: text(step.title, `steps[${index}].title`, 160),
        description: text(step.description, `steps[${index}].description`, 2000),
        ...(step.action !== undefined ? { action: text(step.action, `steps[${index}].action`, 160) } : {}),
      };
    }),
  };
}

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** Credential-free scaffold provider. Its engine name and draft marker are always explicit. */
function generateDraft(input, context) {
  const brief = validateBrief(input);
  if (!context || typeof context.baseStamp !== 'string' || !STAMP.test(context.baseStamp)) {
    throw new ValidationError('generation requires a valid baseStamp');
  }
  const frames = brief.steps.map((step, index) => {
    const id = `${brief.flowId}-${index + 1}`;
    const file = `${id}.html`;
    const next = index + 1 < brief.steps.length ? `${brief.flowId}-${index + 2}.html` : '#complete';
    return {
      id, file, label: step.title, summary: step.description, flow: brief.flowId,
      testHooks: [`[data-testhook="${id}-screen"]`, `[data-testhook="${id}-action"]`],
      html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(step.title)}</title><style>body{margin:0;background:#f4f6fa;color:#172033;font:16px/1.5 system-ui,sans-serif}header,main{max-width:960px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;border-bottom:1px solid #dce2eb}.badge{font-size:12px;background:#fff2cd;padding:4px 10px;border-radius:16px}main{margin-top:32px;background:white;border:1px solid #dce2eb;border-radius:12px}nav{display:flex;gap:12px;margin-top:32px}a{color:#2556b8}a.primary{display:inline-block;background:#2556b8;color:white;padding:12px 20px;border-radius:6px;text-decoration:none}.muted{color:#647084;font-size:14px}</style></head><body><header><span>${escape(brief.title)}</span><span class="badge">Draft wireframe</span></header><main data-testhook="${id}-screen"><p class="muted">Step ${index + 1} of ${brief.steps.length}</p><h1>${escape(step.title)}</h1><p>${escape(step.description)}</p><p class="muted">Goal: ${escape(brief.goal)}</p>${brief.audience ? `<p class="muted">Audience: ${escape(brief.audience)}</p>` : ''}<nav>${index ? `<a href="${brief.flowId}-${index}.html">Back</a>` : ''}<a class="primary" data-testhook="${id}-action" href="${next}">${escape(step.action || (index + 1 < brief.steps.length ? 'Continue' : 'Finish'))}</a></nav></main></body></html>`,
    };
  });
  return {
    engine: ENGINE,
    baseStamp: context.baseStamp,
    brief,
    designSystem: context.designSystem || null,
    flow: { id: brief.flowId, title: brief.title, orchestrator: ENGINE, route: `/${brief.flowId}`, approved: false, status: 'draft' },
    frames,
  };
}

module.exports = { ENGINE, validateBrief, generateDraft };
