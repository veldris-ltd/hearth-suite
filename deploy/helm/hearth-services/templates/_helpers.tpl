{{/* Common labels applied to every object. */}}
{{- define "hearth.labels" -}}
app.kubernetes.io/part-of: hearth
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{/* Per-service selector labels. Call with (dict "name" $name "root" $). */}}
{{- define "hearth.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{/* Fully-qualified container image for a service name. */}}
{{- define "hearth.image" -}}
{{- $img := .root.Values.image -}}
{{- printf "%s/%s/%s:%s" $img.registry $img.prefix .name $img.tag -}}
{{- end -}}
