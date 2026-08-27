// projection.ts — pure logic turning the append-only approval log into the
// v0.1.0 manifest.build.flows[].approved/approvedBy/approvedAt shape
// (docs/postgres-tier.md "Backward-compatibility — the manifest-projection
// strategy"). Postgres is the source of truth; the flat file's own
// bookkeeping is only a fallback for a flow this tier has not (yet) indexed
// — e.g. before the backfill script has run — so an absent Postgres row
// must NEVER regress a flow that the file already shows approved.

export interface LatestApprovalForFlow {
  decision: 'approve' | 'reject';
  actorRef: string;
  decidedAt: string; // ISO 8601
}

export interface ManifestFlow {
  id: string;
  orchestrator?: string;
  route?: string;
  approved?: boolean;
  approvedBy?: string | null;
  approvedAt?: string | null;
  [key: string]: unknown;
}

export interface ManifestLike {
  build?: { flows?: ManifestFlow[]; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * Overlays the latest Postgres approval decision onto each flow, keyed by
 * the flow's manifest id (== the wire {flowId} == flow.flow_key).
 * A flow with no Postgres row yet falls back to the flat file's own
 * approved/approvedBy/approvedAt fields unchanged (pre-backfill safety).
 */
export function projectManifest(
  manifest: ManifestLike,
  latestByFlowKey: ReadonlyMap<string, LatestApprovalForFlow>
): ManifestLike {
  if (!manifest?.build?.flows || !Array.isArray(manifest.build.flows)) return manifest;
  const flows = manifest.build.flows.map((flow) => {
    const latest = latestByFlowKey.get(flow.id);
    if (!latest) return flow;
    return {
      ...flow,
      approved: latest.decision === 'approve',
      approvedBy: latest.actorRef,
      approvedAt: latest.decidedAt,
    };
  });
  return { ...manifest, build: { ...manifest.build, flows } };
}
