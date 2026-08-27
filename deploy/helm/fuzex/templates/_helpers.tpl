{{- define "fuzex.name" -}}
fuzex
{{- end -}}

{{- define "fuzex.fullname" -}}
{{- printf "%s-%s" .Release.Name "fuzex" | trunc 63 | trimSuffix "-" -}}
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
