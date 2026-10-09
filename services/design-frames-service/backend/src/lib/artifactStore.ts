// Private artifact storage boundary. The API never exposes a bucket listing,
// an object key outside a declared bundle, or long-lived storage credentials.
//
// The production adapter is deliberately injected by the runtime composition
// root. This package does not carry cloud keys and does not make a public
// bucket fallback possible. Both AWS S3 and MinIO implement this narrow,
// server-side adapter contract (normally with workload identity/IRSA or a
// mounted short-lived credential provider).

import { NotFoundError } from './errors';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

export interface ArtifactStorageConfig {
  provider: 's3';
  endpoint?: string;
  region: string;
  bucket: string;
}

/**
 * FuzeInfra seals this complete, server-only runtime contract.  The public
 * `ArtifactStorageConfig` intentionally omits the credential so routes and
 * logs cannot accidentally serialize it.  This is a workload principal, not
 * the provider account credential and it receives no ListBucket permission.
 */
interface ArtifactStorageRuntimeConfig extends ArtifactStorageConfig {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
}

export interface StoredArtifact {
  body: Uint8Array;
  contentType: string;
}

export interface ArtifactObjectStore {
  readonly config: ArtifactStorageConfig;
  putObject(input: { key: string; body: Uint8Array; contentType: string; sha256: string }): Promise<void>;
  objectExists(key: string, expectedSha256: string): Promise<boolean>;
  getObject(key: string): Promise<StoredArtifact>;
}

/** A fail-closed store used until the cluster composes an S3/MinIO adapter. */
export class UnconfiguredArtifactObjectStore implements ArtifactObjectStore {
  readonly config: ArtifactStorageConfig;
  constructor(config: ArtifactStorageConfig) { this.config = config; }
  private unavailable(): never {
    throw new Error('artifact object storage is not configured with a private S3/MinIO runtime adapter');
  }
  async putObject(): Promise<void> { return this.unavailable(); }
  async objectExists(): Promise<boolean> { return this.unavailable(); }
  async getObject(): Promise<StoredArtifact> { return this.unavailable(); }
}

/**
 * Adapter shape for AWS SDK v3, MinIO, or an internal workload-identity
 * client. Keeping it structural makes it easy to inject a fake in tests and
 * prevents a static S3 access key from becoming part of FuzeX configuration.
 */
export interface S3CompatibleClient {
  put(input: { bucket: string; key: string; body: Uint8Array; contentType: string; sha256: string }): Promise<void>;
  head(input: { bucket: string; key: string }): Promise<{ sha256?: string } | null>;
  get(input: { bucket: string; key: string }): Promise<StoredArtifact | null>;
}

export class S3CompatibleArtifactObjectStore implements ArtifactObjectStore {
  constructor(readonly config: ArtifactStorageConfig, private readonly client: S3CompatibleClient) {}
  putObject(input: { key: string; body: Uint8Array; contentType: string; sha256: string }): Promise<void> {
    return this.client.put({ bucket: this.config.bucket, ...input });
  }
  async objectExists(key: string, expectedSha256: string): Promise<boolean> {
    const result = await this.client.head({ bucket: this.config.bucket, key });
    return result?.sha256 === expectedSha256;
  }
  async getObject(key: string): Promise<StoredArtifact> {
    const result = await this.client.get({ bucket: this.config.bucket, key });
    if (!result) throw new NotFoundError('artifact object not found');
    return result;
  }
}

/**
 * Server-side AWS-SDK adapter that works with AWS S3 and MinIO/S3-compatible
 * endpoints.  It intentionally exposes only put/head/get; there is no list,
 * delete, presigning, or caller-controlled bucket/key capability.
 */
export class AwsSdkS3CompatibleClient implements S3CompatibleClient {
  private readonly client: S3Client;
  constructor(private readonly runtime: ArtifactStorageRuntimeConfig) {
    const config: S3ClientConfig = {
      region: runtime.region,
      credentials: {
        accessKeyId: runtime.accessKeyId,
        secretAccessKey: runtime.secretAccessKey,
        ...(runtime.sessionToken ? { sessionToken: runtime.sessionToken } : {}),
      },
      ...(runtime.endpoint ? { endpoint: runtime.endpoint } : {}),
      ...(runtime.forcePathStyle === undefined ? {} : { forcePathStyle: runtime.forcePathStyle }),
    };
    this.client = new S3Client(config);
  }

  async put(input: { bucket: string; key: string; body: Uint8Array; contentType: string; sha256: string }): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: { sha256: input.sha256 },
    }));
  }

  async head(input: { bucket: string; key: string }): Promise<{ sha256?: string } | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: input.bucket, Key: input.key }));
      return { sha256: result.Metadata?.sha256 };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  async get(input: { bucket: string; key: string }): Promise<StoredArtifact | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: input.bucket, Key: input.key }));
      if (!result.Body) return null;
      return {
        body: await result.Body.transformToByteArray(),
        contentType: result.ContentType ?? 'application/octet-stream',
      };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }
}

function isMissingObject(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.name === 'NoSuchKey' || candidate?.name === 'NotFound' || candidate?.$metadata?.httpStatusCode === 404;
}

export function artifactStorageConfigFromEnv(env = process.env): ArtifactStorageConfig {
  // FuzeInfra delivers this one opaque JSON value through a strictly-scoped
  // SealedSecret. Credentials, if present, remain available only to the
  // server-side runtime adapter; this parser returns no credential material.
  const handoff = env.ARTIFACT_STORAGE_CONFIG;
  if (handoff) {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(handoff) as Record<string, unknown>; }
    catch { throw new Error('ARTIFACT_STORAGE_CONFIG must be valid JSON from the FuzeInfra object-storage handoff'); }
    const config = {
      ARTIFACT_STORAGE_PROVIDER: parsed.provider,
      ARTIFACT_STORAGE_BUCKET: parsed.bucket,
      ARTIFACT_STORAGE_REGION: parsed.region,
      ARTIFACT_STORAGE_ENDPOINT: parsed.endpoint,
    } as Record<string, string | undefined>;
    return artifactStorageConfigFromEnv(config);
  }
  const provider = env.ARTIFACT_STORAGE_PROVIDER;
  const bucket = env.ARTIFACT_STORAGE_BUCKET;
  const region = env.ARTIFACT_STORAGE_REGION;
  const endpoint = env.ARTIFACT_STORAGE_ENDPOINT;
  if (provider !== 's3' || !bucket || !region) {
    throw new Error('ARTIFACT_STORAGE_PROVIDER=s3, ARTIFACT_STORAGE_BUCKET, and ARTIFACT_STORAGE_REGION are required');
  }
  if (endpoint && !/^https:\/\//.test(endpoint)) {
    throw new Error('ARTIFACT_STORAGE_ENDPOINT must use https');
  }
  return { provider, bucket, region, ...(endpoint ? { endpoint } : {}) };
}

function artifactStorageRuntimeConfigFromEnv(env = process.env): ArtifactStorageRuntimeConfig {
  const handoff = env.ARTIFACT_STORAGE_CONFIG;
  if (!handoff) {
    throw new Error('ARTIFACT_STORAGE_CONFIG is required for the hosted private artifact store');
  }
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(handoff) as Record<string, unknown>; }
  catch { throw new Error('ARTIFACT_STORAGE_CONFIG must be valid JSON from the FuzeInfra object-storage handoff'); }
  const config = artifactStorageConfigFromEnv({ ARTIFACT_STORAGE_CONFIG: handoff });
  const accessKeyId = parsed.accessKeyId;
  const secretAccessKey = parsed.secretAccessKey;
  const sessionToken = parsed.sessionToken;
  const forcePathStyle = parsed.forcePathStyle;
  if (typeof accessKeyId !== 'string' || !accessKeyId || typeof secretAccessKey !== 'string' || !secretAccessKey) {
    throw new Error('ARTIFACT_STORAGE_CONFIG requires a dedicated workload accessKeyId and secretAccessKey');
  }
  if (sessionToken !== undefined && (typeof sessionToken !== 'string' || !sessionToken)) {
    throw new Error('ARTIFACT_STORAGE_CONFIG sessionToken must be a non-empty string when supplied');
  }
  if (forcePathStyle !== undefined && typeof forcePathStyle !== 'boolean') {
    throw new Error('ARTIFACT_STORAGE_CONFIG forcePathStyle must be boolean when supplied');
  }
  return { ...config, accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}), ...(forcePathStyle === undefined ? {} : { forcePathStyle }) };
}

let objectStore: ArtifactObjectStore | null = null;

export function configureArtifactObjectStore(store: ArtifactObjectStore): void { objectStore = store; }

/** Constructs the private server-side adapter without exposing its credential. */
export function createArtifactObjectStoreFromEnv(env = process.env): ArtifactObjectStore {
  const runtime = artifactStorageRuntimeConfigFromEnv(env);
  return new S3CompatibleArtifactObjectStore(runtime, new AwsSdkS3CompatibleClient(runtime));
}

export function getArtifactObjectStore(): ArtifactObjectStore {
  if (objectStore) return objectStore;
  objectStore = createArtifactObjectStoreFromEnv();
  return objectStore;
}
