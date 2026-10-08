FuzeInfra's `publish-sealed-handoff` workflow owns
`design-frames-db-sealed.yaml` in this directory. Hand-off ID: `fuzex-postgres`.
The publisher composes the Postgres URL from its in-cluster service password,
seals it for `fuzex/fuzex-design-frames-db`, and opens a ciphertext-only PR.
No password, connection string, empty secret, or placeholder ciphertext belongs
in Git. The file is created by the first successful hand-off.

`templates/design-frames-db-sealed.yaml` validates the immutable sealing scope
and encrypted key, then assigns Argo sync wave -2. The migration Sync hook runs
in wave -1, after the SealedSecrets controller has delivered the credential.
The API's pod checksum changes on credential delivery/rotation, so Argo rolls
the consumer even when the image is unchanged.
