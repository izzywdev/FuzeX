# Private native UX artifact bundles

FuzeX-native UX flows are not authored in Git. A flow revision is declared as
an immutable object manifest in Postgres, uploaded through the FuzeX API, and
then sealed. HTML, JavaScript, CSS, images, and fonts are stored as private
objects only; PostgreSQL stores hashes, paths, lifecycle state, and audit
metadata, never artifact bytes.

## Runtime contract

The backend requires a server-side S3-compatible adapter:

```text
ARTIFACT_STORAGE_PROVIDER=s3
ARTIFACT_STORAGE_BUCKET=fuzex-<environment>-private
ARTIFACT_STORAGE_REGION=<region>
ARTIFACT_STORAGE_ENDPOINT=https://minio.<cluster-domain>   # MinIO only
```

The adapter is injected at the composition root via
`configureArtifactObjectStore()`. It must obtain credentials using the cluster
workload identity / secret-sealing path. Do not add `AWS_ACCESS_KEY_ID`, a
MinIO access key, a static secret, a public bucket policy, or browser-presigned
credentials to FuzeX.

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
