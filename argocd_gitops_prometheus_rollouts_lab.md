# Báo cáo hướng dẫn Lab GitOps với ArgoCD, Prometheus và Argo Rollouts

## Mục tiêu tổng quát

Bộ bài lab này hướng dẫn triển khai mô hình GitOps trên Kubernetes local bằng ArgoCD, sau đó mở rộng sang quan sát hệ thống bằng Prometheus và triển khai canary bằng Argo Rollouts.

Nội dung chính gồm hai phần:

1. GitOps cơ bản với ArgoCD:
   - Cài ArgoCD vào cluster.
   - Tạo ArgoCD Application.
   - Tự động sync app từ Git.
   - Self-heal khi cluster bị sửa tay.
   - Rollback đúng bằng `git revert`.
   - App-of-apps để quản lý nhiều app.
   - Sync waves để ép thứ tự apply resource.
   - CI validate manifest bằng GitHub Actions.

2. Progressive delivery với Prometheus và Argo Rollouts:
   - Cài Prometheus và Argo Rollouts qua GitOps.
   - Viết app Flask có endpoint `/metrics`.
   - Deploy app bằng `Rollout` thay vì `Deployment`.
   - Tạo `ServiceMonitor` để Prometheus scrape metric.
   - Thực hiện canary thủ công bằng Argo Rollouts.
   - Challenge: dùng Prometheus AnalysisTemplate để tự động đánh giá rollout.

---

# PHẦN 1: GITOPS CƠ BẢN VỚI ARGOCD

## 1. Bài lab GitOps chứng minh điều gì?

Bài lab chứng minh rằng trong mô hình GitOps, Git là nguồn sự thật của hệ thống.

Trước đây, khi muốn deploy ứng dụng lên Kubernetes, ta thường chạy trực tiếp:

```bash
kubectl apply -f deployment.yaml
```

Cách này có vấn đề là trạng thái thật trong cluster có thể bị sửa tay, khó kiểm soát, khó biết ai thay đổi, lúc nào thay đổi và vì sao thay đổi.

Với GitOps:

```text
Git = desired state
Kubernetes = live state
ArgoCD = controller so sánh và đồng bộ giữa Git và Kubernetes
```

Khi manifest trong Git thay đổi, ArgoCD tự động sync vào cluster. Khi ai đó sửa tay trong cluster, ArgoCD phát hiện drift và kéo trạng thái cluster về đúng với Git.

Bài lab cũng chứng minh:

- CI chỉ kiểm tra, không cần quyền deploy vào cluster.
- CD do ArgoCD thực hiện.
- Rollback đúng phải rollback bằng Git.
- App-of-apps giúp quản lý nhiều ứng dụng bằng một root Application.
- Sync waves giúp ép thứ tự apply resource.
- Branch protection giúp chặn manifest lỗi trước khi merge vào `main`.

---

## 2. Cấu trúc repo GitOps

Cấu trúc repo sau phần GitOps cơ bản:

```text
gitops/
├─ k8s/
│  ├─ namespace.yaml
│  └─ web.yaml
├─ argocd/
│  ├─ root.yaml
│  └─ apps/
│     └─ web.yaml
└─ .github/
   └─ workflows/
      └─ validate.yml
```

Ý nghĩa:

- `k8s/`: chứa manifest Kubernetes của app web.
- `argocd/apps/`: chứa các ArgoCD Application con.
- `argocd/root.yaml`: Application cha quản lý thư mục `argocd/apps/`.
- `.github/workflows/validate.yml`: workflow CI để validate manifest.

---

# Lab 1: Cài ArgoCD

## Mục tiêu

Cài ArgoCD vào cluster Kubernetes local để ArgoCD đóng vai trò là "người thợ" kéo manifest từ Git về cluster.

## Bước 1: Kiểm tra cluster

```bash
kubectl get nodes
```

Kết quả mong đợi:

```text
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane    ...
```

Nguyên nhân:

Cần đảm bảo `kubectl` đang kết nối đúng cluster. Nếu cluster chưa chạy, mọi lệnh cài ArgoCD đều thất bại.

Kết quả:

Cluster sẵn sàng để cài ArgoCD.

---

## Bước 2: Tạo namespace cho ArgoCD

```bash
kubectl create namespace argocd
```

Nguyên nhân:

ArgoCD nên được cài trong namespace riêng để tách biệt với ứng dụng khác.

Kết quả:

Namespace `argocd` được tạo.

---

## Bước 3: Cài ArgoCD

```bash
kubectl apply -n argocd --server-side --force-conflicts \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

Nguyên nhân:

Manifest cài ArgoCD chứa nhiều CRD lớn. Dùng `--server-side` giúp tránh lỗi annotation quá dài.

Kết quả:

Cluster được cài các thành phần của ArgoCD:

- `argocd-server`
- `argocd-repo-server`
- `argocd-application-controller`
- `argocd-redis`
- CRD `Application`

---

## Bước 4: Đợi ArgoCD sẵn sàng

```bash
kubectl -n argocd rollout status deploy/argocd-server
kubectl -n argocd get pods
```

Kết quả mong đợi:

```text
argocd-application-controller-...   Running
argocd-server-...                   Running
argocd-repo-server-...              Running
argocd-redis-...                    Running
```

Nguyên nhân:

Cần đợi ArgoCD server chạy ổn định trước khi đăng nhập UI hoặc tạo Application.

Kết quả:

ArgoCD đã sống trong cluster.

---

## Bước 5: Mở UI ArgoCD

```bash
kubectl -n argocd port-forward svc/argocd-server 8080:443
```

Mở trình duyệt:

```text
https://localhost:8080
```

Tài khoản mặc định:

```text
username: admin
```

Lấy password trên Linux, Git Bash hoặc WSL:

```bash
kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d; echo
```

Lấy password trên PowerShell:

```powershell
$pwd = kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}"
[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pwd))
```

Nguyên nhân:

PowerShell không có sẵn lệnh `base64 -d`, nên phải decode bằng .NET.

Kết quả:

Đăng nhập được vào ArgoCD UI.

---

# Lab 2: Tạo Application để ArgoCD sync app

## Mục tiêu

Tạo một ArgoCD Application tên `web`, trỏ tới thư mục `k8s/` trong repo GitOps. ArgoCD sẽ tự deploy app từ Git vào namespace `demo`.

---

## Bước 1: Tạo manifest app web

Tạo file:

```text
k8s/web.yaml
```

Nội dung:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          ports:
            - containerPort: 80
```

Nguyên nhân:

Đây là desired state của ứng dụng web. Git sẽ lưu trạng thái mong muốn này.

Kết quả:

Manifest mô tả Deployment `web` có 2 replicas.

---

## Bước 2: Tạo namespace demo

Ở Lab 2, nếu chưa đưa namespace vào Git, tạo tay:

```bash
kubectl create namespace demo
```

Nguyên nhân:

Deployment khai báo `namespace: demo`. Nếu namespace chưa tồn tại, ArgoCD sync sẽ lỗi.

Kết quả:

Namespace `demo` tồn tại để chứa app `web`.

---

## Bước 3: Commit và push manifest

```bash
git add k8s/web.yaml
git commit -m "add web deployment"
git push
```

Nguyên nhân:

ArgoCD đọc manifest từ remote Git repo, nên file phải được push lên Git.

Kết quả:

Repo Git có trạng thái mong muốn của app web.

---

## Bước 4: Tạo ArgoCD Application cho web

Tạo file:

```text
argocd/apps/web.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: web
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<ban>/gitops.git
    targetRevision: HEAD
    path: k8s
  destination:
    server: https://kubernetes.default.svc
    namespace: demo
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Thay:

```text
https://github.com/<ban>/gitops.git
```

bằng repo thật, ví dụ:

```text
https://github.com/tuanpm2003/gitops.git
```

Nguyên nhân:

Application là resource của ArgoCD, khai báo:

- Lấy manifest từ repo nào.
- Lấy ở path nào.
- Deploy vào cluster nào.
- Deploy vào namespace nào.
- Có tự sync và self-heal hay không.

Kết quả:

Manifest Application `web` đã sẵn sàng.

---

## Bước 5: Apply Application bằng tay

```bash
kubectl apply -f argocd/apps/web.yaml
```

Nguyên nhân:

Lúc này chưa có root Application, nên ArgoCD chưa tự biết file `argocd/apps/web.yaml` tồn tại. Vì vậy phải apply tay lần đầu.

Kết quả:

ArgoCD bắt đầu theo dõi thư mục `k8s/`.

Kiểm tra:

```bash
kubectl -n argocd get app web
kubectl -n demo get deploy,pod
```

Kết quả mong đợi:

```text
web   Synced   Healthy
```

và namespace `demo` có 2 pod nginx.

---

# Lab 3: Sync và Self-heal

## Mục tiêu

Chứng minh rằng:

- Sửa Git thì cluster tự đổi theo.
- Sửa tay trong cluster thì ArgoCD kéo lại theo Git.

---

## Phần A: Đổi replicas qua Git

Sửa file:

```text
k8s/web.yaml
```

Đổi:

```yaml
replicas: 2
```

thành:

```yaml
replicas: 4
```

Commit và push:

```bash
git add k8s/web.yaml
git commit -m "scale web from 2 to 4"
git push
```

Nguyên nhân:

Bạn đã thay đổi desired state trong Git từ 2 pod thành 4 pod.

Kết quả:

ArgoCD phát hiện Git thay đổi, app chuyển sang `OutOfSync`, sau đó auto-sync về 4 pod.

Kiểm tra:

```bash
kubectl -n demo get deploy web
kubectl -n demo get pods
```

Kết quả mong đợi:

```text
READY   UP-TO-DATE   AVAILABLE
4/4     4            4
```

---

## Phần B: Sửa tay trong cluster

```bash
kubectl -n demo scale deploy/web --replicas=9
kubectl -n demo get deploy web -w
```

Nguyên nhân:

Bạn cố tình làm live state trong cluster khác với desired state trong Git. Git đang ghi `replicas: 4`, nhưng cluster bị sửa tay thành 9.

Kết quả:

Vì Application bật:

```yaml
selfHeal: true
```

ArgoCD sẽ kéo Deployment về lại 4 replicas.

Kết luận:

Cluster không còn là nơi quyết định trạng thái cuối cùng. Git mới là nguồn sự thật.

---

# Lab 4: Rollback bằng Git

## Mục tiêu

Chứng minh rollback đúng trong GitOps phải rollback bằng Git.

---

## Bước 1: Rollback bằng git revert

```bash
git revert HEAD --no-edit
git push
```

Nguyên nhân:

`git revert` tạo một commit mới để đảo ngược commit trước đó. Nếu commit trước đổi replicas từ 2 lên 4, revert sẽ đưa Git về trạng thái 2 replicas.

Kết quả:

ArgoCD thấy Git thay đổi và sync cluster về trạng thái cũ.

Kiểm tra:

```bash
kubectl -n demo get deploy web
kubectl -n argocd get app web
```

---

## Vì sao không nên rollback bằng kubectl rollout undo?

Ví dụ:

```bash
kubectl -n demo rollout undo deploy/web
```

Lệnh này chỉ sửa live state trong cluster. Nhưng Git vẫn giữ version mới.

Vì ArgoCD coi Git là nguồn sự thật, nó sẽ thấy cluster bị lệch và sync lại theo Git.

Kết luận:

```text
git revert = rollback thật
kubectl rollout undo = rollback tạm, dễ bị ArgoCD ghi đè
```

---

# Lab 5: App-of-apps

## Mục tiêu

Không cần apply từng ArgoCD Application con bằng tay nữa.

Thay vào đó, chỉ apply một root Application. Sau đó, thêm app mới bằng cách thả file vào `argocd/apps/` và push lên Git.

---

## Bước 1: Tạo root Application

Tạo file:

```text
argocd/root.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: root
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<ban>/gitops.git
    targetRevision: HEAD
    path: argocd/apps
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Nguyên nhân:

Root Application không deploy nginx trực tiếp. Nó deploy các Application con nằm trong thư mục `argocd/apps/`.

Kết quả:

Root Application có khả năng quản lý file `argocd/apps/web.yaml`.

---

## Bước 2: Commit và push root

```bash
git add argocd/root.yaml argocd/apps/web.yaml
git commit -m "add app-of-apps root"
git push
```

Nguyên nhân:

Root Application cũng là manifest và cần được lưu trong Git.

Kết quả:

Repo có root Application và app con `web`.

---

## Bước 3: Apply root một lần cuối

```bash
kubectl apply -f argocd/root.yaml
```

Nguyên nhân:

Cần một điểm khởi đầu. Sau khi root tồn tại trong cluster, root sẽ tự quản lý các app con.

Kết quả:

Kiểm tra:

```bash
kubectl -n argocd get applications
```

Kết quả mong đợi:

```text
NAME   SYNC STATUS   HEALTH STATUS
root   Synced        Healthy
web    Synced        Healthy
```

Từ đây trở đi, thêm app mới bằng Git:

```text
thêm file vào argocd/apps/ → git push → root tự tạo Application con
```

---

# Lab 6: Sync waves

## Mục tiêu

Ép thứ tự apply resource.

Thứ tự mong muốn:

```text
Namespace -1 → ConfigMap 0 → Deployment 1 → Service 2
```

Nếu không có thứ tự, Deployment có thể chạy trước ConfigMap hoặc namespace chưa tồn tại, gây lỗi.

---

## Bước 1: Tạo namespace bằng Git

Tạo file:

```text
k8s/namespace.yaml
```

Nội dung:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: demo
  annotations:
    argocd.argoproj.io/sync-wave: "-1"
```

Nguyên nhân:

Namespace phải được tạo trước các resource nằm trong namespace đó.

Kết quả:

ArgoCD apply Namespace trước vì wave `-1`.

---

## Bước 2: Sửa file k8s/web.yaml

Nội dung đầy đủ:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: demo
  annotations:
    argocd.argoproj.io/sync-wave: "0"
data:
  MESSAGE: "hello from gitops"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: demo
  annotations:
    argocd.argoproj.io/sync-wave: "1"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          envFrom:
            - configMapRef:
                name: web-config
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: demo
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80
```

Nguyên nhân:

- ConfigMap cần có trước Deployment vì Deployment dùng `envFrom`.
- Deployment cần có trước Service để Service chọn pod.
- Service chạy sau cùng.

Kết quả:

ArgoCD apply đúng thứ tự:

```text
Namespace → ConfigMap → Deployment → Service
```

---

## Bước 3: Commit và push

```bash
git add k8s/namespace.yaml k8s/web.yaml
git commit -m "add sync waves"
git push
```

Kiểm tra:

```bash
kubectl -n demo get cm,deploy,svc,pod
```

Kết quả mong đợi:

- Có ConfigMap `web-config`.
- Có Deployment `web`.
- Có Service `web`.
- Pod chạy bình thường.

---

# Lab 7: CI validate manifest với GitHub Actions

## Mục tiêu

CI chỉ validate manifest, không deploy.

Nếu manifest sai schema, PR không được merge vào `main`.

---

## Bước 1: Tạo workflow validate

Tạo file:

```text
.github/workflows/validate.yml
```

Nội dung:

```yaml
name: validate

on:
  pull_request:
    paths:
      - "k8s/**"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install kubeconform
        run: |
          curl -sSLo kc.tgz https://github.com/yannh/kubeconform/releases/download/v0.6.7/kubeconform-linux-amd64.tar.gz
          tar -xzf kc.tgz
          sudo mv kubeconform /usr/local/bin/

      - name: Validate Kubernetes manifests
        run: kubeconform -strict -summary k8s/
```

Nguyên nhân:

`kubeconform` kiểm tra manifest Kubernetes có đúng schema hay không. CI không cần quyền vào cluster.

Kết quả:

Mỗi PR sửa file trong `k8s/` sẽ chạy job validate.

---

## Bước 2: Commit và push workflow

```bash
git add .github/workflows/validate.yml
git commit -m "add manifest validation workflow"
git push
```

---

## Bước 3: Bật Branch protection

Trên GitHub:

```text
Settings → Branches → Add branch protection rule
```

Cấu hình branch:

```text
main
```

Bật:

```text
Require a pull request before merging
Require approvals
Require status checks to pass before merging
Chọn check: validate
```

Nguyên nhân:

Ngăn manifest lỗi đi vào nhánh `main`.

Kết quả:

Nếu PR có YAML sai schema, GitHub Actions fail và nút Merge bị khóa.

---

## Tổng kết phần 1

Luồng GitOps sau khi hoàn thành:

```text
Developer sửa YAML
        ↓
Tạo Pull Request
        ↓
GitHub Actions chạy kubeconform
        ↓
Review + CI pass
        ↓
Merge vào main
        ↓
ArgoCD phát hiện Git thay đổi
        ↓
ArgoCD sync vào Kubernetes
        ↓
Nếu ai sửa tay trong cluster, ArgoCD self-heal về đúng Git
```

Câu chốt khi demo:

Bài lab chứng minh mô hình GitOps với ArgoCD. Thay vì deploy trực tiếp bằng `kubectl apply`, toàn bộ trạng thái mong muốn của ứng dụng được lưu trong Git. ArgoCD chạy trong Kubernetes, liên tục so sánh Git với trạng thái thật trong cluster và tự động sync khi có thay đổi. Khi sửa manifest trong Git, cluster tự cập nhật; khi sửa tay trong cluster, ArgoCD self-heal về đúng Git. Rollback đúng được thực hiện bằng `git revert`, vì Git là nguồn sự thật. App-of-apps giúp quản lý nhiều app bằng một root Application, sync waves đảm bảo resource được apply đúng thứ tự, còn CI với kubeconform giúp chặn manifest lỗi trước khi merge.

---

# PHẦN 2: PROMETHEUS VÀ ARGO ROLLOUTS

## 1. Bài lab này chứng minh điều gì?

Phần này mở rộng GitOps sang progressive delivery.

Bài lab chứng minh:

- GitOps không chỉ deploy app, mà còn deploy cả platform như Prometheus và Argo Rollouts.
- Observability là điều kiện để triển khai an toàn.
- Argo Rollouts thay Deployment thường bằng Rollout để hỗ trợ canary.
- Canary giúp release từng phần, không đẩy 100% traffic ngay.
- Prometheus metric có thể được dùng để quyết định promote hoặc abort rollout.

---

## 2. Cấu trúc repo sau phần 2

```text
gitops/
├─ app/
│  ├─ app.py
│  └─ Dockerfile
├─ k8s-api/
│  ├─ api.yaml
│  ├─ servicemonitor.yaml
│  └─ analysis-template.yaml
├─ argocd/
│  ├─ root.yaml
│  └─ apps/
│     ├─ web.yaml
│     ├─ kube-prometheus-stack.yaml
│     ├─ argo-rollouts.yaml
│     └─ api.yaml
└─ k8s/
   ├─ namespace.yaml
   └─ web.yaml
```

---

## Điều kiện trước khi bắt đầu

Nên dùng Minikube profile đủ tài nguyên:

```bash
minikube start -p w9 --cpus=4 --memory=6g
```

Kiểm tra context:

```bash
kubectl config current-context
```

Kết quả nên là:

```text
w9
```

Kiểm tra ArgoCD:

```bash
kubectl -n argocd get applications
```

Phải thấy:

```text
root
web
```

---

# Lab 1: Cài Prometheus + Argo Rollouts qua GitOps

## Mục tiêu

Không cài tay bằng Helm CLI.

Không chạy:

```bash
helm install ...
```

Thay vào đó:

```text
thêm Application vào argocd/apps/ → git push → root tự cài
```

---

## Bước 1: Tạo Application kube-prometheus-stack

Tạo file:

```text
argocd/apps/kube-prometheus-stack.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kube-prometheus-stack
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://prometheus-community.github.io/helm-charts
    chart: kube-prometheus-stack
    targetRevision: 65.1.1
    helm:
      values: |
        prometheus:
          prometheusSpec:
            serviceMonitorSelectorNilUsesHelmValues: false
            serviceMonitorNamespaceSelectorNilUsesHelmValues: false
        grafana:
          adminPassword: admin123
  destination:
    server: https://kubernetes.default.svc
    namespace: monitoring
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

Nguyên nhân:

`kube-prometheus-stack` cài đầy đủ monitoring stack gồm Prometheus, Grafana, Alertmanager, Prometheus Operator và CRD liên quan.

Cần:

```yaml
serviceMonitorSelectorNilUsesHelmValues: false
```

để Prometheus có thể scrape `ServiceMonitor` do mình tự tạo cho app `api`.

Cần:

```yaml
CreateNamespace=true
```

để ArgoCD tự tạo namespace `monitoring`.

Cần:

```yaml
ServerSideApply=true
```

để hạn chế lỗi khi apply CRD lớn.

Kết quả:

ArgoCD có thể cài Prometheus stack qua GitOps.

---

## Bước 2: Tạo Application argo-rollouts

Tạo file:

```text
argocd/apps/argo-rollouts.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: argo-rollouts
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://argoproj.github.io/argo-helm
    chart: argo-rollouts
    targetRevision: 2.37.7
  destination:
    server: https://kubernetes.default.svc
    namespace: argo-rollouts
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

Nguyên nhân:

Argo Rollouts cần controller riêng để xử lý kind `Rollout`.

Kết quả:

Cluster sẽ có namespace `argo-rollouts` và rollout controller.

---

## Bước 3: Commit và push

```bash
git add argocd/apps/
git commit -m "add monitoring and rollouts"
git push
```

Nguyên nhân:

Root Application đang theo dõi thư mục `argocd/apps/`. Khi push 2 file Application mới, root sẽ tự tạo 2 app con.

Kết quả:

Không cần `kubectl apply`.

Kiểm tra:

```bash
kubectl -n argocd get applications
```

Kết quả mong đợi:

```text
root
web
kube-prometheus-stack
argo-rollouts
```

---

## Bước 4: Kiểm tra pod

```bash
kubectl -n monitoring get pods
```

Kết quả mong đợi:

```text
prometheus-kube-prometheus-stack-prometheus-0
kube-prometheus-stack-grafana-...
kube-prometheus-stack-operator-...
alertmanager-kube-prometheus-stack-alertmanager-0
```

Kiểm tra Argo Rollouts:

```bash
kubectl -n argo-rollouts get pods
```

Kết quả mong đợi:

```text
argo-rollouts-...   Running
```

---

# Lab 2: Viết app Flask có /metrics

## Mục tiêu

Tạo app nhỏ có các endpoint:

```text
/         trả JSON ok hoặc lỗi 500 tùy ERROR_RATE
/healthz  health check
/metrics  Prometheus scrape metric
```

---

## Bước 1: Tạo app/app.py

Tạo file:

```text
app/app.py
```

Nội dung:

```python
import os
import random
from flask import Flask, jsonify
from prometheus_flask_exporter import PrometheusMetrics

app = Flask(__name__)
PrometheusMetrics(app)

ERR = float(os.getenv("ERROR_RATE", "0"))
VER = os.getenv("VERSION", "v1")

@app.get("/")
def index():
    if random.random() < ERR:
        return jsonify(error="injected", version=VER), 500
    return jsonify(ok=True, version=VER)

@app.get("/healthz")
def healthz():
    return "ok", 200
```

Nguyên nhân:

`prometheus_flask_exporter` tự thêm endpoint `/metrics`.

Kết quả:

App có metric HTTP để Prometheus scrape.

---

## Bước 2: Tạo Dockerfile

Tạo file:

```text
app/Dockerfile
```

Nội dung:

```dockerfile
FROM python:3.12-slim

RUN pip install flask prometheus-flask-exporter

COPY app.py /app/app.py
WORKDIR /app

ENV FLASK_APP=app.py

EXPOSE 8080

CMD ["flask", "run", "--host=0.0.0.0", "--port=8080"]
```

Nguyên nhân:

Đóng gói Flask app thành container image để chạy trong Kubernetes.

Kết quả:

Có Dockerfile để build image `w9-api:1`.

---

## Bước 3: Build image

```bash
docker build -t w9-api:1 app/
```

Kiểm tra Linux/Git Bash/WSL:

```bash
docker images | grep w9-api
```

Kiểm tra PowerShell:

```powershell
docker images | Select-String w9-api
```

Nguyên nhân:

Kubernetes sẽ chạy container từ image `w9-api:1`.

Kết quả:

Máy local có image `w9-api:1`.

---

## Bước 4: Load image vào Minikube

```bash
minikube image load w9-api:1 -p w9
```

Nguyên nhân:

Vì không push image lên Docker Hub, ECR hoặc GHCR, Minikube cần image nằm bên trong node của nó.

Kết quả:

Pod trong Minikube có thể chạy image `w9-api:1`.

Kiểm tra:

```bash
minikube image ls -p w9 | grep w9-api
```

PowerShell:

```powershell
minikube image ls -p w9 | Select-String w9-api
```

---

# Lab 3: Viết manifest Rollout + ServiceMonitor

## Mục tiêu

Deploy app `api` bằng Argo Rollouts thay vì Deployment thường.

Prometheus scrape được metric từ `/metrics`.

---

## Bước 1: Tạo k8s-api/api.yaml

Tạo file:

```text
k8s-api/api.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: api
  namespace: demo
  labels:
    app: api
spec:
  replicas: 4
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
        - name: api
          image: w9-api:1
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: ERROR_RATE
              value: "0"
            - name: VERSION
              value: "v1"
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 3
            periodSeconds: 5
  strategy:
    canary:
      steps:
        - setWeight: 25
        - pause: {}
        - setWeight: 50
        - pause:
            duration: 30s
        - setWeight: 100
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: demo
  labels:
    app: api
spec:
  selector:
    app: api
  ports:
    - name: http
      port: 8080
      targetPort: 8080
```

Nguyên nhân:

`Rollout` giống Deployment ở phần replicas, selector, pod template, nhưng có thêm `strategy.canary`.

Kết quả:

App `api` chạy 4 replicas và có Service nội bộ `api:8080`.

---

## Bước 2: Tạo ServiceMonitor

Tạo file:

```text
k8s-api/servicemonitor.yaml
```

Nội dung:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: api
  namespace: demo
  labels:
    app: api
spec:
  selector:
    matchLabels:
      app: api
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

Nguyên nhân:

Prometheus Operator dùng `ServiceMonitor` để biết phải scrape service nào.

`ServiceMonitor` chọn Service có label:

```yaml
app: api
```

và scrape port tên:

```yaml
http
```

Kết quả:

Prometheus có thể tự động phát hiện app `api` và lấy metric từ `/metrics`.

---

## Bước 3: Tạo ArgoCD Application cho api

Tạo file:

```text
argocd/apps/api.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: api
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/<ban>/gitops.git
    targetRevision: HEAD
    path: k8s-api
  destination:
    server: https://kubernetes.default.svc
    namespace: demo
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
      - ServerSideApply=true
```

Thay repoURL bằng repo thật của bạn.

Nguyên nhân:

Application này cho ArgoCD biết app `api` nằm trong thư mục `k8s-api`.

Kết quả:

Root Application sẽ tự tạo Application `api`.

---

## Bước 4: Commit và push

```bash
git add app/ k8s-api/ argocd/apps/api.yaml
git commit -m "add api rollout with metrics"
git push
```

Nguyên nhân:

Đưa source app, Dockerfile, manifest Kubernetes và Application vào Git.

Kết quả:

Root tự deploy app `api`.

Kiểm tra:

```bash
kubectl -n argocd get applications
```

Kết quả mong đợi:

```text
api   Synced   Healthy
```

Kiểm tra resource:

```bash
kubectl -n demo get rollout,pod,svc
```

---

## Bước 5: Tạo traffic giả

```bash
kubectl -n demo run load --image=busybox --restart=Never -- \
  sh -c "while true; do wget -qO- http://api:8080/; sleep 1; done"
```

Nguyên nhân:

Không có traffic thì metric request không tăng.

Kết quả:

Pod `load` gọi liên tục vào Service `api`.

Kiểm tra log:

```bash
kubectl -n demo logs load -f
```

---

## Bước 6: Mở Prometheus UI

```bash
kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090:9090
```

Mở:

```text
http://localhost:9090
```

Vào:

```text
Status → Targets
```

Tìm target liên quan đến `demo/api`.

Query thử:

```promql
flask_http_request_total{namespace="demo"}
```

Hoặc:

```promql
sum(rate(flask_http_request_total{namespace="demo"}[1m]))
```

Kết quả mong đợi:

Metric tăng dần khi pod `load` đang gọi API.

---

# Lab 4: Canary thủ công bằng Argo Rollouts

## Mục tiêu

Release app từ `v1` sang `v2`, nhưng không đưa 100% traffic sang bản mới ngay.

Rollout sẽ:

```text
25% → pause vô hạn → chờ người quyết định promote hoặc abort
```

---

## Bước 1: Cài kubectl plugin cho Argo Rollouts

### Windows PowerShell

```powershell
$version = "v1.7.2"
$url = "https://github.com/argoproj/argo-rollouts/releases/download/$version/kubectl-argo-rollouts-windows-amd64"
Invoke-WebRequest -Uri $url -OutFile kubectl-argo-rollouts.exe
```

Di chuyển file vào thư mục có trong PATH, ví dụ:

```powershell
mkdir C:\kubectl-plugins
Move-Item .\kubectl-argo-rollouts.exe C:\kubectl-plugins\
```

Thêm `C:\kubectl-plugins` vào Environment Variables → Path.

Mở terminal mới và kiểm tra:

```powershell
kubectl argo rollouts version
```

### WSL/Linux

```bash
curl -LO https://github.com/argoproj/argo-rollouts/releases/download/v1.7.2/kubectl-argo-rollouts-linux-amd64
chmod +x kubectl-argo-rollouts-linux-amd64
sudo mv kubectl-argo-rollouts-linux-amd64 /usr/local/bin/kubectl-argo-rollouts
kubectl argo rollouts version
```

Nguyên nhân:

Plugin giúp xem trạng thái rollout, promote, abort, restart rollout.

Kết quả:

Có thể dùng lệnh:

```bash
kubectl argo rollouts get rollout api -n demo --watch
```

---

## Bước 2: Sửa VERSION từ v1 sang v2

Mở file:

```text
k8s-api/api.yaml
```

Đổi:

```yaml
- name: VERSION
  value: "v1"
```

thành:

```yaml
- name: VERSION
  value: "v2"
```

Giữ:

```yaml
- name: ERROR_RATE
  value: "0"
```

Nguyên nhân:

Thay đổi pod template khiến Rollout tạo ReplicaSet mới.

Kết quả:

Khi push Git, ArgoCD sync thay đổi và Argo Rollouts bắt đầu canary.

---

## Bước 3: Commit và push

```bash
git add k8s-api/api.yaml
git commit -m "release api v2"
git push
```

Theo dõi:

```bash
kubectl argo rollouts get rollout api -n demo --watch
```

Kết quả mong đợi:

Rollout dừng ở:

```text
setWeight: 25
pause
```

Nguyên nhân:

Trong strategy có:

```yaml
- setWeight: 25
- pause: {}
```

`pause: {}` là pause vô hạn, cần người quyết định.

---

## Bước 4: Kiểm tra traffic

```bash
kubectl -n demo run test-v2 --image=busybox --restart=Never --rm -it -- \
  sh -c "for i in 1 2 3 4 5 6 7 8 9 10; do wget -qO- http://api:8080/; echo; done"
```

Có thể thấy lẫn:

```json
{"ok":true,"version":"v1"}
```

và:

```json
{"ok":true,"version":"v2"}
```

Nguyên nhân:

Đang canary 25%, một phần pod chạy bản mới, phần còn lại vẫn chạy bản stable cũ.

---

## Bước 5: Promote nếu app ổn

```bash
kubectl argo rollouts promote api -n demo
```

Nguyên nhân:

Người vận hành xác nhận bản canary ổn.

Kết quả:

Rollout đi tiếp:

```text
25% → 50% → pause 30s → 100%
```

Theo dõi:

```bash
kubectl argo rollouts get rollout api -n demo --watch
```

---

## Bước 6: Abort nếu app lỗi

```bash
kubectl argo rollouts abort api -n demo
```

Nguyên nhân:

Hủy rollout hiện tại nếu bản mới lỗi.

Kết quả:

Argo Rollouts quay về stable ReplicaSet cũ.

Kiểm tra:

```bash
kubectl -n demo get pods
kubectl argo rollouts get rollout api -n demo
```

---

# Lab 5 Challenge: Tự động đánh giá rollout bằng Prometheus AnalysisTemplate

## Mục tiêu

Thay vì người nhìn metric rồi quyết định promote hoặc abort, Argo Rollouts sẽ hỏi Prometheus:

```text
error rate có cao không?
nếu tốt → đi tiếp
nếu xấu → fail hoặc abort
```

---

## Bước 1: Tạo AnalysisTemplate

Tạo file:

```text
k8s-api/analysis-template.yaml
```

Nội dung:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: api-success-rate
  namespace: demo
spec:
  metrics:
    - name: api-success-rate
      interval: 30s
      count: 3
      successCondition: result[0] >= 0.95
      failureCondition: result[0] < 0.95
      provider:
        prometheus:
          address: http://kube-prometheus-stack-prometheus.monitoring.svc:9090
          query: |
            sum(rate(flask_http_request_total{namespace="demo",status!~"5.."}[1m]))
            /
            sum(rate(flask_http_request_total{namespace="demo"}[1m]))
```

Nguyên nhân:

Query tính success rate:

```text
request không phải 5xx / tổng request
```

Điều kiện:

```text
success rate >= 95% → pass
success rate < 95%  → fail
```

Kết quả:

Argo Rollouts có template để đánh giá chất lượng bản canary.

---

## Bước 2: Gắn analysis vào Rollout

Sửa phần `strategy.canary` trong:

```text
k8s-api/api.yaml
```

Thành:

```yaml
  strategy:
    canary:
      steps:
        - setWeight: 25
        - pause:
            duration: 30s
        - analysis:
            templates:
              - templateName: api-success-rate
        - setWeight: 50
        - pause:
            duration: 30s
        - analysis:
            templates:
              - templateName: api-success-rate
        - setWeight: 100
```

Nguyên nhân:

Rollout sẽ:

```text
đẩy 25%
chờ 30 giây cho Prometheus có dữ liệu
chạy analysis
nếu pass thì đi tiếp
nếu fail thì dừng rollout
đẩy 50%
chạy analysis lần nữa
nếu vẫn pass thì lên 100%
```

Kết quả:

Canary không còn phụ thuộc hoàn toàn vào quyết định thủ công.

---

## Bước 3: Commit và push

```bash
git add k8s-api/analysis-template.yaml k8s-api/api.yaml
git commit -m "add rollout prometheus analysis"
git push
```

Kiểm tra:

```bash
kubectl -n demo get analysistemplate
kubectl -n demo get rollout api
```

Kết quả mong đợi:

```text
api-success-rate
```

---

## Bước 4: Test case tốt

Sửa trong `k8s-api/api.yaml`:

```yaml
- name: VERSION
  value: "v3"
- name: ERROR_RATE
  value: "0"
```

Commit và push:

```bash
git add k8s-api/api.yaml
git commit -m "release api v3 healthy"
git push
```

Theo dõi:

```bash
kubectl argo rollouts get rollout api -n demo --watch
```

Kết quả mong đợi:

Analysis pass và rollout tự đi tiếp.

Kiểm tra AnalysisRun:

```bash
kubectl -n demo get analysisrun
```

Xem chi tiết:

```bash
kubectl -n demo describe analysisrun
```

---

## Bước 5: Test case lỗi

Sửa:

```yaml
- name: VERSION
  value: "v4"
- name: ERROR_RATE
  value: "0.5"
```

Nghĩa là khoảng 50% request trả lỗi 500.

Commit và push:

```bash
git add k8s-api/api.yaml
git commit -m "release api v4 bad"
git push
```

Theo dõi:

```bash
kubectl argo rollouts get rollout api -n demo --watch
```

Kết quả mong đợi:

Canary bị fail do success rate thấp. Rollout không lên 100%.

Nếu cần hủy thủ công:

```bash
kubectl argo rollouts abort api -n demo
```

---

# Lỗi thường gặp và cách xử lý

## 1. Lỗi no matches for kind "Rollout"

Nguyên nhân:

Argo Rollouts CRD chưa được cài.

Kiểm tra:

```bash
kubectl get crd | grep rollouts
```

PowerShell:

```powershell
kubectl get crd | Select-String rollouts
```

Cần thấy:

```text
rollouts.argoproj.io
```

Nếu chưa có, kiểm tra app:

```bash
kubectl -n argocd get app argo-rollouts
```

---

## 2. Prometheus không thấy target api

Kiểm tra ServiceMonitor:

```bash
kubectl -n demo get servicemonitor
```

Kiểm tra Service có đúng label không:

```bash
kubectl -n demo get svc api --show-labels
```

Phải có:

```text
app=api
```

Kiểm tra Service port:

```bash
kubectl -n demo get svc api -o yaml
```

Phải có port tên:

```yaml
name: http
```

Vì ServiceMonitor đang dùng:

```yaml
port: http
```

Nếu tên port sai, Prometheus không scrape được.

---

## 3. Pod api bị ImagePullBackOff

Nguyên nhân:

Minikube chưa có image `w9-api:1`.

Sửa:

```bash
docker build -t w9-api:1 app/
minikube image load w9-api:1 -p w9
kubectl argo rollouts restart api -n demo
```

---

## 4. Query Prometheus ra NaN

Nguyên nhân:

Chưa có traffic hoặc metric chưa đủ dữ liệu.

Sửa bằng cách tạo load:

```bash
kubectl -n demo run load --image=busybox --restart=Never -- \
  sh -c "while true; do wget -qO- http://api:8080/; sleep 1; done"
```

Chờ 1 đến 2 phút rồi query lại.

---

# Luồng tổng thể sau toàn bộ bài lab

Sau khi hoàn thành cả hai phần, luồng hệ thống là:

```text
Developer sửa manifest hoặc config trong Git
        ↓
Tạo Pull Request
        ↓
GitHub Actions validate manifest
        ↓
Review + CI pass
        ↓
Merge vào main
        ↓
Root Application của ArgoCD phát hiện thay đổi
        ↓
ArgoCD sync Application con
        ↓
Nếu là app thường, ArgoCD deploy theo manifest
        ↓
Nếu là Rollout, Argo Rollouts điều khiển canary
        ↓
Prometheus scrape metric từ /metrics
        ↓
AnalysisTemplate query Prometheus
        ↓
Metric tốt  → tiếp tục rollout
Metric xấu  → fail hoặc abort rollout
```

---

# Câu trả lời ngắn dùng khi demo

Bài lab này chứng minh mô hình GitOps kết hợp progressive delivery và observability. Ở phần đầu, ArgoCD được cài vào cluster để đồng bộ trạng thái từ Git vào Kubernetes. Git trở thành nguồn sự thật, nên khi sửa manifest trong Git, cluster tự cập nhật; còn khi sửa tay trong cluster, ArgoCD self-heal về đúng Git. Rollback đúng được thực hiện bằng `git revert`, app-of-apps giúp quản lý nhiều ứng dụng bằng một root Application, sync waves đảm bảo resource được apply đúng thứ tự, và CI với kubeconform giúp chặn manifest lỗi trước khi merge.

Ở phần tiếp theo, Prometheus và Argo Rollouts cũng được cài bằng GitOps thông qua app-of-apps. App Flask expose endpoint `/metrics`, Prometheus scrape metric qua ServiceMonitor. Thay vì dùng Deployment thường, app được deploy bằng Rollout để hỗ trợ canary. Khi release version mới, Argo Rollouts chỉ đưa một phần traffic sang bản mới, có thể pause để người vận hành promote hoặc abort. Challenge nâng cao là dùng AnalysisTemplate query Prometheus để tự động đánh giá success rate; nếu metric tốt thì tiếp tục rollout, nếu metric xấu thì dừng hoặc abort, giúp giảm rủi ro khi deploy.

---

# Checklist hoàn thành

## Phần ArgoCD GitOps

```bash
kubectl -n argocd get pods
```

ArgoCD pod Running.

```bash
kubectl -n argocd get applications
```

Có:

```text
root
web
```

và đều Synced/Healthy.

```bash
kubectl -n demo get deploy web
```

Deployment `web` tồn tại.

Khi scale tay:

```bash
kubectl -n demo scale deploy/web --replicas=9
```

ArgoCD kéo về đúng số replica trong Git.

Khi rollback:

```bash
git revert HEAD --no-edit
git push
```

Cluster rollback theo Git.

---

## Phần Prometheus và Argo Rollouts

```bash
kubectl -n argocd get applications
```

Có:

```text
kube-prometheus-stack
argo-rollouts
api
```

Kiểm tra monitoring:

```bash
kubectl -n monitoring get pods
```

Prometheus và Grafana Running.

Kiểm tra Rollouts controller:

```bash
kubectl -n argo-rollouts get pods
```

Controller Running.

Kiểm tra app api:

```bash
kubectl -n demo get rollout,pod,svc
```

Rollout, pod và Service tồn tại.

Kiểm tra Prometheus target:

```text
Prometheus UI → Status → Targets → demo/api UP
```

Query metric:

```promql
flask_http_request_total{namespace="demo"}
```

Canary:

```bash
kubectl argo rollouts get rollout api -n demo --watch
```

Promote:

```bash
kubectl argo rollouts promote api -n demo
```

Abort:

```bash
kubectl argo rollouts abort api -n demo
```

AnalysisRun:

```bash
kubectl -n demo get analysisrun
kubectl -n demo describe analysisrun
```

---

# Kết luận

Sau toàn bộ bài lab, có thể hiểu rõ một pipeline GitOps hiện đại:

```text
GitHub PR + CI validate
        ↓
Merge vào main
        ↓
ArgoCD sync từ Git vào Kubernetes
        ↓
Argo Rollouts triển khai canary
        ↓
Prometheus đo metric
        ↓
AnalysisTemplate quyết định tiếp tục hay dừng rollout
```

Điểm quan trọng nhất là không deploy bằng tay. Mọi thay đổi hạ tầng, platform và application đều đi qua Git. Git lưu lịch sử thay đổi, ArgoCD đảm bảo cluster đúng với Git, Prometheus cung cấp dữ liệu quan sát, và Argo Rollouts giúp release an toàn hơn bằng canary.
