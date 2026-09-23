{{- define "fuzex.name" -}}
fuzex
{{- end -}}

{{- define "fuzex.fullname" -}}
{{- printf "%s-%s" .Release.Name "fuzex" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
The design-store PVC's name. DELIBERATELY NOT `fuzex.fullname`-derived
(`<release>-fuzex-data`, i.e. `fuzex-fuzex-data`): the original claim of that
name bound a local-path PersistentVolume pinned to a since-tainted node, so its
pod sat `Pending` on "didn't match PersistentVolume's node affinity" for 7d+ and
never registered with the FuzeFront portal (FuzeInfra#980). This name is distinct
from the old claim so Argo provisions a FRESH claim on the node-agnostic
`longhorn` StorageClass (set in values-prod.yaml). The old local-path claim is
left behind — the PVC carries `helm.sh/resource-policy: keep` and the Argo
Application runs `prune: false` — and nothing is lost: the pod never ran, so the
old claim holds no approvals.
*/}}
{{- define "fuzex.dataClaimName" -}}
{{- printf "%s-design-frames-data" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "fuzex.labels" -}}
app.kubernetes.io/name: fuzex
app.kubernetes.io/part-of: fuzex
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "fuzex.selectorLabels" -}}
app.kubernetes.io/name: fuzex
app.kubernetes.io/component: design-frames-service
{{- end -}}

{{- define "fuzex.pgTierSelectorLabels" -}}
app.kubernetes.io/name: fuzex
app.kubernetes.io/component: postgres-tier
{{- end -}}

{{- define "fuzex.webappMfeSelectorLabels" -}}
app.kubernetes.io/name: fuzex
app.kubernetes.io/component: webapp-mfe
{{- end -}}
