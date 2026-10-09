/**
 * Deterministic graph layout for a UX journey. It purposefully represents only
 * planning metadata; no preview HTML or JavaScript enters the canvas.
 */
const nodeWidth = 224
const nodeHeight = 116
const columns = 3

export function buildFlowCanvasGraph(flowId, frames) {
  const flowFrames = frames.filter((frame) => !frame.flow || frame.flow === flowId)
  const nodes = flowFrames.map((frame, index) => ({
    id: frame.id,
    position: {
      x: (index % columns) * (nodeWidth + 72),
      y: Math.floor(index / columns) * (nodeHeight + 88),
    },
    data: { frameId: frame.id, label: frame.label, summary: frame.summary, route: frame.route, index },
    type: 'default',
    style: {
      width: nodeWidth,
      minHeight: nodeHeight,
      borderRadius: 10,
      border: '1px solid var(--border-color, #414753)',
      background: 'var(--bg-secondary, #202631)',
      color: 'var(--text-primary, #f6f7f9)',
      fontFamily: 'inherit',
      padding: 12,
    },
  }))
  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index].id}-${node.id}`,
    source: nodes[index].id,
    target: node.id,
    label: index === 0 ? 'Start' : undefined,
    animated: false,
    style: { stroke: 'var(--accent-primary, #6ea8fe)' },
  }))
  return { nodes, edges }
}
