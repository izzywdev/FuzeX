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

export interface ApiErrorBody {
  error?: string
  details?: string[]
}
