// Private artifact storage boundary. The API never exposes a bucket listing,
// an object key outside a declared bundle, or long-lived storage credentials.
//
// The production adapter is deliberately injected by the runtime composition
// root. This package does not carry cloud keys and does not make a public
// bucket fallback possible. Both AWS S3 and MinIO implement this narrow,
// server-side adapter contract (normally with workload identity/IRSA or a
// mounted short-lived credential provider).

import { NotFoundError } from './errors';

export interface ArtifactStorageConfig {
  provider: 's3';
  endpoint?: string;
  region: string;
  bucket: string;
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

export function artifactStorageConfigFromEnv(env = process.env): ArtifactStorageConfig {
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

let objectStore: ArtifactObjectStore | null = null;

export function configureArtifactObjectStore(store: ArtifactObjectStore): void { objectStore = store; }

export function getArtifactObjectStore(): ArtifactObjectStore {
  if (objectStore) return objectStore;
  // A missing adapter is intentionally an error on first use rather than a
  // local-disk/public-bucket fallback. Config is read only to produce a useful
  // operator error and never includes credentials.
  objectStore = new UnconfiguredArtifactObjectStore(artifactStorageConfigFromEnv());
  return objectStore;
}
