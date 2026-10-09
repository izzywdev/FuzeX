import assert from 'node:assert/strict'
import test from 'node:test'

// The graph builder has no browser dependency, so this contract test keeps the
// flow order and isolation rules stable without needing a DOM runner.
const { buildFlowCanvasGraph } = await import('./flowCanvasGraph.mjs')

test('buildFlowCanvasGraph keeps frames in journey order and connects them', () => {
  const { nodes, edges } = buildFlowCanvasGraph('checkout', [
    { id: 'cart', file: 'cart.html', label: 'Cart', flow: 'checkout' },
    { id: 'payment', file: 'payment.html', label: 'Payment', flow: 'checkout', summary: 'Enter payment details' },
    { id: 'account', file: 'account.html', label: 'Account', flow: 'account' },
  ])

  assert.deepEqual(nodes.map((node) => node.id), ['cart', 'payment'])
  assert.deepEqual(edges.map((edge) => [edge.source, edge.target]), [['cart', 'payment']])
  assert.equal(nodes[1].data.summary, 'Enter payment details')
})

test('buildFlowCanvasGraph includes unassigned frames for early flow planning', () => {
  const { nodes } = buildFlowCanvasGraph('onboarding', [
    { id: 'welcome', file: 'welcome.html', label: 'Welcome' },
  ])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].data.frameId, 'welcome')
})
