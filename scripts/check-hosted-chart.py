#!/usr/bin/env python3
"""Validate the rendered hosted cutover, including the dormant production tier.

Requires Helm and PyYAML. Never contacts a cluster or reads a credential.
"""
import os
from pathlib import Path
import subprocess

import yaml


ROOT = Path(__file__).resolve().parents[1]
CHART = ROOT / "deploy/helm/fuzex"
HELM = os.environ.get("HELM_BIN", "helm")


def render(*overrides):
    command = [HELM, "template", "fuzex", str(CHART), "-n", "fuzex", "-f", str(CHART / "values-prod.yaml")]
    for override in overrides:
        command += ["--set", override]
    result = subprocess.run(command, text=True, capture_output=True, check=True)
    return {(doc["kind"], doc["metadata"]["name"]): doc for doc in yaml.safe_load_all(result.stdout) if doc}


def reject(*overrides):
    try:
        render(*overrides)
    except subprocess.CalledProcessError:
        return
    raise AssertionError(f"unsafe values unexpectedly rendered: {overrides}")


legacy = render()
hosted = render("postgresTier.enabled=true")

for documents, target in ((legacy, "fuzex-fuzex"), (hosted, "fuzex-fuzex-postgres-tier")):
    ingress = documents[("Ingress", "fuzex-fuzex-api")]
    paths = ingress["spec"]["rules"][0]["http"]["paths"]
    assert len(paths) == 1 and paths[0]["path"] == "/apps/fuzex/api"
    assert paths[0]["backend"]["service"]["name"] == target
    middleware = documents[("Middleware", "fuzex-fuzex-api-prefix")]
    assert middleware["spec"]["stripPrefix"]["prefixes"] == ["/apps/fuzex/api"]
    assert ingress["metadata"]["annotations"]["traefik.ingress.kubernetes.io/router.middlewares"] == "fuzex-fuzex-fuzex-api-prefix@kubernetescrd"
    mfe = documents[("Ingress", "fuzex-fuzex-federated-mount")]
    assert mfe["spec"]["rules"][0]["http"]["paths"][0]["path"] == "/apps/fuzex"
    assert "traefik.ingress.kubernetes.io/router.middlewares" not in mfe["metadata"].get("annotations", {})
    pvc = documents[("PersistentVolumeClaim", "fuzex-design-frames-data")]
    assert pvc["metadata"]["annotations"]["argocd.argoproj.io/sync-options"] == "Prune=false,Delete=false"
    assert pvc["spec"]["storageClassName"] == "longhorn"

assert legacy[("Deployment", "fuzex-fuzex")]["spec"]["replicas"] == 1
assert ("Deployment", "fuzex-fuzex-postgres-tier") not in legacy
previous = hosted[("Deployment", "fuzex-fuzex")]
writer = hosted[("Deployment", "fuzex-fuzex-postgres-tier")]
assert previous["spec"]["replicas"] == 0
assert int(previous["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"]) < int(writer["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"])
assert writer["spec"]["replicas"] == 1 and writer["spec"]["strategy"]["type"] == "Recreate"
pod = writer["spec"]["template"]["spec"]
container = pod["containers"][0]
env = {item["name"]: item for item in container["env"]}
assert env["DESIGN_FRAMES_DATA_DIR"]["value"] == "/data/features"
assert env["NODE_ENV"]["value"] == "production"
assert env["FUZEFRONT_API_URL"]["value"].startswith("http://fuzefront-")
assert env["DATABASE_URL"]["valueFrom"]["secretKeyRef"] == {"name": "fuzex-design-frames-db", "key": "DATABASE_URL"}
assert container["readinessProbe"]["httpGet"]["path"] == "/ready"
assert container["livenessProbe"]["httpGet"]["path"] == "/health"
assert container["startupProbe"]["httpGet"]["path"] == "/health"
assert container["volumeMounts"] == [{"name": "data", "mountPath": "/data/features"}]
assert pod["volumes"][0]["persistentVolumeClaim"]["claimName"] == "fuzex-design-frames-data"
assert pod["securityContext"]["fsGroup"] == 1000
assert pod["initContainers"][0]["env"][1]["valueFrom"]["secretKeyRef"]["name"] == "fuzefront-registration"
assert hosted[("Service", "fuzex-fuzex")]["spec"]["selector"]["app.kubernetes.io/component"] == "postgres-tier"
job = hosted[("Job", "fuzex-fuzex-db-migrate")]
assert job["metadata"]["annotations"]["argocd.argoproj.io/hook"] == "PreSync"
assert job["metadata"]["annotations"]["argocd.argoproj.io/hook-delete-policy"] == "BeforeHookCreation,HookSucceeded"
assert job["spec"]["activeDeadlineSeconds"] == 300

unregistered = render("postgresTier.enabled=true", "registration.enabled=false", "federatedMount.enabled=false")
assert "initContainers" not in unregistered[("Deployment", "fuzex-fuzex-postgres-tier")]["spec"]["template"]["spec"]
assert ("Ingress", "fuzex-fuzex-api") not in unregistered
reject("postgresTier.enabled=true", "persistence.enabled=false")
reject("postgresTier.enabled=true", "fuzefront.apiUrl=")
reject("federatedMount.apiPath=/api")
reject("federatedMount.host=")
print("Hosted chart validation passed: durable sole writer, cutover ordering, isolated routes, health and migration guards.")
