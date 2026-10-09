import React, { useEffect, useMemo, useState } from 'react'
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, type NodeMouseHandler, type OnEdgesChange, type OnNodesChange } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ManifestBuildFlow, ManifestFrame } from '../types'
import { buildFlowCanvasGraph } from './flowCanvasGraph.mjs'

export interface FlowCanvasNodeData {
  frameId: string
  label: string
  summary?: string
  route?: string
  index: number
}

export interface FlowCanvasProps {
  /** The product flow being planned or reviewed. */
  flow: Pick<ManifestBuildFlow, 'id' | 'route'>
  /** Frames belonging to the flow, in their intended journey order. */
  frames: ManifestFrame[]
  selectedFrameId?: string | null
  /** Lets the host switch its preview/review panel when a canvas node is selected. */
  onFrameSelect?: (frameId: string) => void
  /** Enables rearranging the visual map without changing flow content. */
  editable?: boolean
  ariaLabel?: string
}

export function FlowCanvas({ flow, frames, selectedFrameId, onFrameSelect, editable = false, ariaLabel }: FlowCanvasProps) {
  const initialGraph = useMemo(() => buildFlowCanvasGraph(flow.id, frames) as { nodes: Node<FlowCanvasNodeData>[]; edges: Edge[] }, [flow.id, frames])
  const [nodes, setNodes] = useState(initialGraph.nodes)
  const [edges, setEdges] = useState(initialGraph.edges)

  useEffect(() => {
    setNodes(initialGraph.nodes)
    setEdges(initialGraph.edges)
  }, [initialGraph])

  const onNodesChange: OnNodesChange = (changes) => {
    if (!editable) return
    setNodes((current) => changes.reduce<Node[]>((updated, change) => {
      if (change.type === 'position' && change.position) return updated.map((node) => node.id === change.id ? { ...node, position: change.position! } : node)
      return updated
    }, current))
  }
  const onEdgesChange: OnEdgesChange = () => undefined
  const onNodeClick: NodeMouseHandler = (_, node) => onFrameSelect?.(node.data.frameId)

  if (nodes.length === 0) return <p role="status">No frames have been assigned to this flow yet.</p>

  return <section aria-label={ariaLabel || `Flow map: ${flow.id}`} style={{ height: '430px', border: '1px solid var(--border-color, #414753)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-primary, #151922)' }}>
    <ReactFlow
      nodes={nodes.map((node) => ({ ...node, selected: node.id === selectedFrameId }))}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodesDraggable={editable}
      nodesConnectable={false}
      elementsSelectable={Boolean(onFrameSelect)}
      fitView
      proOptions={{ hideAttribution: true }}
      aria-label={ariaLabel || `UX flow ${flow.id}`}
    >
      <Background gap={18} size={1} color="var(--border-color, #414753)" />
      <MiniMap nodeColor="var(--accent-primary, #6ea8fe)" pannable zoomable />
      <Controls showInteractive={false} />
    </ReactFlow>
  </section>
}
