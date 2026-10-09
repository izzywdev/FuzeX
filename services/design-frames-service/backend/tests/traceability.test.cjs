'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTraceLink, parsePolicy } = require('../dist/lib/traceability.js');

const flowId = 'fxdf_flw_01h455vb4pex5vsknk084sn02q';
const frameId = 'fxdf_frm_01h455vb4pex5vsknk084sn02q';

test('accepts FuzePlan requirements and immutable LLM quote evidence only in their valid source system', () => {
  assert.equal(parseTraceLink({ targetType: 'flow', targetRef: flowId, sourceSystem: 'fuzeplan', sourceKind: 'requirement', externalRef: 'FUZEPLAN-123' }).sourceKind, 'requirement');
  const quote = parseTraceLink({ targetType: 'element', targetRef: frameId, selector: '[data-testid=continue]', sourceSystem: 'fuzeplan', sourceKind: 'llm_quote', externalRef: 'conversation:42#quote:3', quoteText: 'Continue means advance to the next step.' });
  assert.equal(quote.quoteText, 'Continue means advance to the next step.');
  assert.throws(() => parseTraceLink({ targetType: 'project', targetRef: 'fxdf_prj_01h455vb4pex5vsknk084sn02q', sourceSystem: 'fuzequality', sourceKind: 'requirement', externalRef: 'FQ-4' }), /invalid FuzeQuality/);
  assert.throws(() => parseTraceLink({ targetType: 'project', targetRef: 'fxdf_prj_01h455vb4pex5vsknk084sn02q', sourceSystem: 'fuzeplan', sourceKind: 'llm_quote', externalRef: 'q', quoteText: '   ' }), /quoteText/);
});

test('requires a stable node or selector for an evidence-linked UX flow step or component', () => {
  const step = parseTraceLink({ targetType: 'flowStep', targetRef: flowId, selector: 'payment-method', sourceSystem: 'fuzequality', sourceKind: 'test_case', externalRef: 'FQ-100' });
  assert.equal(step.targetType, 'flowStep');
  assert.throws(() => parseTraceLink({ targetType: 'flowStep', targetRef: flowId, sourceSystem: 'fuzequality', sourceKind: 'test_case', externalRef: 'FQ-100' }), /selector/);
  assert.throws(() => parsePolicy({ targetType: 'element', targetRef: frameId, title: 'Semantic labels', instruction: 'Use action labels.' }), /selector/);
});
