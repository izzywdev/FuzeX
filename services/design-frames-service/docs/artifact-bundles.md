# Private native UX artifact bundles

FuzeX-native UX flows are not authored in Git. A flow revision is declared as
an immutable object manifest in Postgres, uploaded through the FuzeX API, and
then sealed. HTML, JavaScript, CSS, images, and fonts are stored as private
objects only; PostgreSQL stores hashes, paths, lifecycle state, and audit
metadata, never artifact bytes.

## Runtime contract

The backend consumes the FuzeInfra-owned object-storage handoff. Its preferred
runtime input is one opaque JSON value, `ARTIFACT_STORAGE_CONFIG`, delivered in
the `fuzex-artifact-storage` SealedSecret. FuzeX never provisions a bucket or
holds the FuzeInfra/Contabo account credential. The generic allocation contract
lives in FuzeInfra's `governance/object-storage-allocations.json`.

For local development only, the backend can instead be configured directly:

```text
ARTIFACT_STORAGE_PROVIDER=s3
ARTIFACT_STORAGE_BUCKET=fuzex-<environment>-private
ARTIFACT_STORAGE_REGION=<region>
ARTIFACT_STORAGE_ENDPOINT=https://minio.<cluster-domain>   # MinIO only
```

The hosted adapter creates a server-only S3 client from that sealed JSON at
startup on first artifact access. The JSON includes a dedicated bucket-scoped
workload `accessKeyId` and `secretAccessKey` (and optional `sessionToken` and
`forcePathStyle` for MinIO). They are never returned by the API or written to
logs. `configureArtifactObjectStore()` remains available only for tests or a
controlled runtime composition override.

Do not add a provider-account key, a public bucket policy, `ListBucket`, or
browser-presigned credentials to FuzeX. The workload policy is limited to the
declared FuzeX bucket and the backend exposes only put/head/get for immutable,
database-declared object keys.

Each bundle maps to a deterministic private key prefix:

```text
projects/<project-uuid>/flows/<flow-key>/revisions/<n>/<bundle-uuid>/<path>
```

The API permits only object paths declared before upload. Sealing verifies each
object's SHA-256 through the store adapter, then locks the bundle metadata and
object list. Previews are served by the FuzeX relay endpoint after FuzeFront's
existing Security + Permit.io/OPAL authorization decision; the browser never
receives a bucket URL, list permission, or storage credential.

This is intentionally a UX preview runtime, not a general website hosting
service. The UI must render a sealed bundle on an isolated preview origin in a
sandboxed iframe and restrict outbound network capability with CSP.
