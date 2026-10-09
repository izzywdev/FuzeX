// Wire types mirroring services/design-frames-service/openapi.yaml. Kept
// hand-written (not generated) because this service ships its API spec but no
// generated TS client yet — see api-contract-first notes in App.tsx.

export interface FeatureFlowSummary {
  id: string
  approved: boolean
}

export interface FeatureSummary {
  slug: string
  name: string
  description: string
  sourceRepo?: string | null
  stamp?: string | null
  frameCount: number
  flows: FeatureFlowSummary[]
}

export interface ManifestFrame {
  id: string
  file: string
  label: string
  route?: string
  flow?: string
  summary?: string
  acceptanceNotes?: string
  testHooks?: string[]
}

export interface ManifestBuildFlow {
  id: string
  orchestrator: string
  route: string
  approved?: boolean
  approvedBy?: string | null
  approvedAt?: string | null
}

export interface ManifestBuild {
  flows?: ManifestBuildFlow[]
  components?: string[]
  packages?: string[]
}

export interface ManifestContract {
  openapi?: string
  client?: string
  schemas?: string[]
  endpoints?: string[]
  component?: string
  featureFlag?: string
}

export interface Manifest {
  name: string
  description: string
  designSystem: string
  entry: string
  sourceRepo?: string | null
  stamp?: string | null
  frames: ManifestFrame[]
  contract?: ManifestContract
  build?: ManifestBuild
}

export interface StampInfo {
  slug: string
  stamp: string
  manifestStamp: string | null
  current: boolean
}

export interface ContentRevision {
  stamp: string
  createdAt: string
  sourceRepo: string | null
}

export interface RevisionDetail {
  slug: string
  stamp: string
  revision: ContentRevision
  manifest: Manifest
  frames: Record<string, string>
}

export interface RevisionFrameRef {
  id: string
  file: string
  flowId: string | null
  contentStamp: string
}

export interface Discussion {
  id: string
  targetType: 'project' | 'feature' | 'flow' | 'frame' | 'element'
  targetRef: string
  targetSelector: string | null
  title: string | null
  resolved: boolean
  createdAt: string
  updatedAt: string
}

export interface DiscussionComment {
  id: string
  discussionId: string
  parentCommentId: string | null
  body: string
  authorRef: string
  authorType: 'user' | 'agent'
  deleted: boolean
  createdAt: string
}

export interface DiscussionDetail extends Discussion {
  comments: DiscussionComment[]
}

export interface DiscussionPage {
  items: Discussion[]
  page: { nextCursor: string | null; hasMore: boolean; total?: number | null }
}

export interface ApiErrorBody {
  error?: string
  details?: string[]
}

export interface Page<T> {
  items: T[]
  page: { nextCursor: string | null; hasMore: boolean; total?: number | null }
}

export interface Project {
  id: string
  name: string
  description: string | null
  sourceRepo: string | null
  createdAt: string
  updatedAt: string
}

export interface DesignSystemComponent {
  key: string
  name: string
  description?: string
  selector?: string
  usage?: string
  status?: 'draft' | 'approved' | 'rejected'
  reason?: string
}

export interface DesignSystemRevision {
  projectId: string
  revision: number
  name: string
  description: string | null
  tokens: Record<string, unknown>
  components: DesignSystemComponent[]
  createdBy: string
  createdAt: string
}

export interface DesignSystemInput {
  expectedRevision: number
  name: string
  description: string | null
  tokens: Record<string, unknown>
  components: DesignSystemComponent[]
}

export interface ProjectWorkspace {
  project: Project
  repositories: ProjectRepository[]
  detectedServices: DetectedService[]
  featureCount: number
  flowCount: number
  frameCount: number
  designSystem: DesignSystemRevision | null
}

export interface ProjectRepository {
  repository: string
  framesPath: string
  createdAt: string
  adoptedFeatures?: number
}

export interface DetectedService {
  name: string
  openapi: string
  featureCount: number
}

export type TraceTargetType = 'project' | 'flow' | 'flowStep' | 'frame' | 'element' | 'designSystemComponent'
export interface TraceLink {
  id: string
  projectId: string
  target: { targetType: TraceTargetType; targetRef: string; selector: string | null; contentStamp: string | null }
  source: { system: 'fuzeplan' | 'fuzequality' | 'fuzex'; kind: 'requirement' | 'llm_quote' | 'test_case' | 'design_decision'; externalRef: string; externalUrl: string | null; quoteText: string | null; metadata: Record<string, unknown> }
  createdBy: string
  createdAt: string
}
export interface DesignPolicy {
  id: string
  projectId: string
  target: { targetType: TraceTargetType; targetRef: string; selector: string | null }
  title: string
  instruction: string
  status: 'draft' | 'approved' | 'superseded'
  traceLinkIds: string[]
  createdBy: string
  createdAt: string
  approvedBy: string | null
  approvedAt: string | null
  supersedesId: string | null
}

export interface GenerationBrief {
  flowId: string
  title: string
  goal: string
  audience?: string
  steps: { title: string; description: string; action?: string }[]
}

export interface GenerationSummary {
  id: string
  status: 'draft' | 'applied' | 'dismissed'
  baseStamp: string
  resultStamp: string | null
  actorRef: string
  createdAt: string
  updatedAt: string
  engine: string
  flowId: string
  title: string
  frameCount: number
}

export interface GenerationDetail extends Omit<GenerationSummary, 'engine' | 'flowId' | 'title' | 'frameCount'> {
  draft: {
    engine: string
    baseStamp: string
    designSystem: string | null
    brief: GenerationBrief
    flow: ManifestBuildFlow & { title: string; status: string }
    frames: (ManifestFrame & { html: string })[]
  }
}
