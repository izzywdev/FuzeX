import { query, withTransaction } from '../lib/db';
import { mintId, toUuid, fromUuid, type EntityId } from '../lib/identity';
import { ConflictError, NotFoundError } from '../lib/errors';
import type { ReqLogger } from '../lib/logger';

export interface ArtifactObjectInput { path: string; contentType: string; byteSize: number; sha256: string; }
export interface ArtifactBundleCreateInput {
  flowKey: string; displayName: string; contentSha256: string; objects: ArtifactObjectInput[]; createdBy: string; storageBucket: string;
}
interface BundleRow { id: string; project_id: string; flow_key: string; revision: number; display_name: string; content_sha256: string; storage_bucket: string; storage_prefix: string; state: 'uploading' | 'sealed'; created_by: string; created_at: Date; sealed_at: Date | null; }
interface ObjectRow { id: string; bundle_id: string; object_path: string; content_type: string; byte_size: string | number; sha256: string; storage_key: string; }
export interface ArtifactObjectDTO { path: string; contentType: string; byteSize: number; sha256: string; }
export interface ArtifactBundleDTO { id: EntityId<'artifactBundle'>; projectId: EntityId<'project'>; flowKey: string; revision: number; displayName: string; contentSha256: string; state: 'uploading' | 'sealed'; createdBy: string; createdAt: string; sealedAt: string | null; objects?: ArtifactObjectDTO[]; }

function dto(row: BundleRow): ArtifactBundleDTO { return { id: fromUuid('artifactBundle', row.id), projectId: fromUuid('project', row.project_id), flowKey: row.flow_key, revision: row.revision, displayName: row.display_name, contentSha256: row.content_sha256, state: row.state, createdBy: row.created_by, createdAt: row.created_at.toISOString(), sealedAt: row.sealed_at?.toISOString() ?? null }; }
function objectDto(row: ObjectRow): ArtifactObjectDTO { return { path: row.object_path, contentType: row.content_type, byteSize: Number(row.byte_size), sha256: row.sha256 }; }

export async function createArtifactBundle(projectId: EntityId<'project'>, input: ArtifactBundleCreateInput, log: ReqLogger): Promise<ArtifactBundleDTO> {
  return withTransaction(async (client) => {
    const project = await client.query('select id from design_frames.project where id = $1 for update', [toUuid(projectId)]);
    if (!project.rows[0]) throw new NotFoundError(`project '${projectId}' not found`);
    const duplicate = await client.query('select id from design_frames.artifact_bundle where project_id = $1 and content_sha256 = $2', [toUuid(projectId), input.contentSha256]);
    if (duplicate.rows[0]) throw new ConflictError('an immutable artifact bundle with this content already exists for this App');
    const next = await client.query<{ revision: number }>('select coalesce(max(revision), 0) + 1 as revision from design_frames.artifact_bundle where project_id = $1 and flow_key = $2', [toUuid(projectId), input.flowKey]);
    const id = mintId('artifactBundle');
    const prefix = `projects/${toUuid(projectId)}/flows/${input.flowKey}/revisions/${next.rows[0].revision}/${toUuid(id)}`;
    const row = await client.query<BundleRow>(`insert into design_frames.artifact_bundle (id, project_id, flow_key, revision, display_name, content_sha256, storage_bucket, storage_prefix, created_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`, [toUuid(id), toUuid(projectId), input.flowKey, next.rows[0].revision, input.displayName, input.contentSha256, input.storageBucket, prefix, input.createdBy]);
    for (const item of input.objects) {
      await client.query(`insert into design_frames.artifact_bundle_object (id, bundle_id, object_path, content_type, byte_size, sha256, storage_key)
        values ($1,$2,$3,$4,$5,$6,$7)`, [toUuid(mintId('artifactBundle')), toUuid(id), item.path, item.contentType, item.byteSize, item.sha256, `${prefix}/${item.path}`]);
    }
    return dto(row.rows[0]);
  }, log);
}

export async function getArtifactBundle(id: EntityId<'artifactBundle'>, log: ReqLogger, includeObjects = false): Promise<ArtifactBundleDTO> {
  const { rows } = await query<BundleRow>('select * from design_frames.artifact_bundle where id = $1', [toUuid(id)], log);
  if (!rows[0]) throw new NotFoundError(`artifact bundle '${id}' not found`);
  const result = dto(rows[0]);
  if (includeObjects) result.objects = await listArtifactObjects(id, log);
  return result;
}
export async function listArtifactBundles(projectId: EntityId<'project'>, flowKey: string | undefined, log: ReqLogger): Promise<ArtifactBundleDTO[]> {
  const { rows } = await query<BundleRow>(`select * from design_frames.artifact_bundle where project_id = $1 ${flowKey ? 'and flow_key = $2' : ''} order by flow_key asc, revision desc`, flowKey ? [toUuid(projectId), flowKey] : [toUuid(projectId)], log);
  return rows.map(dto);
}
export async function listArtifactObjects(bundleId: EntityId<'artifactBundle'>, log: ReqLogger): Promise<ArtifactObjectDTO[]> {
  const { rows } = await query<ObjectRow>('select * from design_frames.artifact_bundle_object where bundle_id = $1 order by object_path asc', [toUuid(bundleId)], log);
  return rows.map(objectDto);
}
export async function findArtifactObject(bundleId: EntityId<'artifactBundle'>, path: string, log: ReqLogger): Promise<{ storageKey: string; contentType: string; sha256: string }> {
  const { rows } = await query<ObjectRow>('select * from design_frames.artifact_bundle_object where bundle_id = $1 and object_path = $2', [toUuid(bundleId), path], log);
  if (!rows[0]) throw new NotFoundError('artifact object not declared in bundle');
  return { storageKey: rows[0].storage_key, contentType: rows[0].content_type, sha256: rows[0].sha256 };
}
export async function sealArtifactBundle(id: EntityId<'artifactBundle'>, log: ReqLogger): Promise<ArtifactBundleDTO> {
  const { rows } = await query<BundleRow>(`update design_frames.artifact_bundle set state = 'sealed', sealed_at = now()
    where id = $1 and state = 'uploading' returning *`, [toUuid(id)], log);
  if (rows[0]) return dto(rows[0]);
  return getArtifactBundle(id, log);
}
