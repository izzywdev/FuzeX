import type { Edge, Node } from '@xyflow/react'
import type { ManifestFrame } from '../types'
import type { FlowCanvasNodeData } from './FlowCanvas'

export function buildFlowCanvasGraph(
  flowId: string,
  frames: ManifestFrame[],
): { nodes: Node<FlowCanvasNodeData>[]; edges: Edge[] }
