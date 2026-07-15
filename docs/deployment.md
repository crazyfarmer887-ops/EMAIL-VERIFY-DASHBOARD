# 재현 가능한 배포

이 문서는 Git 커밋을 불변 release 디렉터리로 빌드한 뒤 `current` 심볼릭 링크를 원자적으로 교체하는 배포 절차를 설명한다. 운영 저장소에서 직접 `npm run build`를 실행하지 않는다. `dist/`가 부분 갱신된 상태로 서비스될 수 있기 때문이다.

## 고정된 도구 체인과 디렉터리

- Node.js 버전: `.node-version`
- npm 버전: `package.json`의 `packageManager`
- 의존성 설치: 항상 `npm ci`
- 예시 앱 루트: `/srv/graytag-email-dashboard`

```text
/srv/graytag-email-dashboard/
├── current -> releases/<git-sha>
├── releases/<git-sha>/
└── shared/
    ├── data/
    ├── gmail-token.json
    └── gmail-history-id.txt
```

`data/`, Gmail OAuth 토큰, Gmail history ID는 release에 복사하지 않는다. 현재 앱은 별도 상태 디렉터리 환경 변수를 지원하지 않고 `process.cwd()` 기준의 `data/`, `gmail-token.json`, `gmail-history-id.txt`를 직접 사용한다. 따라서 각 release의 **바로 아래**에 `shared/`를 가리키는 심볼릭 링크를 반드시 만든다. 아래 링크 생성 절차를 생략하면 새 release가 빈 상태로 시작하거나 토큰을 찾지 못한다. `/etc/graytag-email-dashboard/environment`는 저장소 밖에서 관리하고 Git에 추가하지 않는다.

## 최초 준비

아래 예시는 전용 계정과 표준 경로를 사용한다. 조직의 계정/경로가 다르면 systemd 템플릿을 렌더링할 때 같은 값을 사용한다.

```bash
sudo useradd --system --home /srv/graytag-email-dashboard --shell /usr/sbin/nologin graytag-email
sudo install -d -o graytag-email -g graytag-email -m 0750 \
  /srv/graytag-email-dashboard/releases \
  /srv/graytag-email-dashboard/shared/data \
  /etc/graytag-email-dashboard
sudo install -o root -g graytag-email -m 0640 /dev/null \
  /etc/graytag-email-dashboard/environment
```

Gmail 연동을 사용한다면 OAuth 클라이언트 비밀 파일을 서비스 전용 경로에 설치한다. `<downloaded-client-secret.json>`은 Google Cloud Console에서 안전하게 내려받은 로컬 파일 경로로 바꾸며, 파일 내용을 터미널이나 로그에 출력하지 않는다.

```bash
sudo install -o root -g graytag-email -m 0640 \
  <downloaded-client-secret.json> \
  /etc/graytag-email-dashboard/gmail-client-secret.json
sudo -u graytag-email test -r \
  /etc/graytag-email-dashboard/gmail-client-secret.json
sudo test "$(stat -c '%a %U %G' /etc/graytag-email-dashboard/gmail-client-secret.json)" \
  = "640 root graytag-email"
```

서비스 사용자의 read check가 실패하면 서비스를 시작하지 말고 소유 그룹과 권한을 먼저 바로잡는다. 애플리케이션 오류는 설정 변수 이름과 권한 확인 방법만 안내하며 민감할 수 있는 실제 경로는 로그에 반복 출력하지 않는다.

환경 파일에는 최소한 다음 값을 설정한다. 값은 셸에서 `source`할 파일이 아니라 systemd의 `EnvironmentFile` 문법으로 기록한다.

```text
ADMIN_PASSWORD=<strong-secret>
ADMIN_SESSION_SECRET=<at-least-32-random-bytes>
UNLOCK_TOKEN_SECRET=<at-least-32-random-bytes>
SIMPLELOGIN_API_KEY=<api-key>
GMAIL_CLIENT_SECRET_PATH=/etc/graytag-email-dashboard/gmail-client-secret.json
```

선택 기능을 사용하면 Gmail/IMAP 및 Telegram 알림 관련 환경 변수도 같은 파일에 추가한다. 실제 값은 문서, 셸 기록, Git diff에 출력하지 않는다. `GMAIL_CLIENT_SECRET_PATH`를 생략하면 하위 호환을 위해 기존 `/home/ubuntu/.config/gws/client_secret.json` 경로를 사용하지만, 운영에서는 위 서비스 전용 경로를 명시해야 한다. systemd 템플릿에도 같은 운영 기본값이 선언되어 있다.

## release 빌드 및 설치

빌드는 운영 `current` 밖의 임시 checkout에서 수행한다. 다음 명령의 `REPOSITORY_URL`과 `REVISION`을 실제 값으로 바꾼다.

```bash
set -euo pipefail
APP_ROOT=/srv/graytag-email-dashboard
REPOSITORY_URL=<git-url>
REVISION=<full-commit-sha>
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

git clone --no-checkout "$REPOSITORY_URL" "$BUILD_DIR/source"
git -C "$BUILD_DIR/source" checkout --detach "$REVISION"
cd "$BUILD_DIR/source"

test "$(node --version)" = "v$(cat .node-version)"
test "$(npm --version)" = "$(node -p 'require("./package.json").packageManager.split("@").pop()')"
npm ci
npm test
npm run check
if compgen -G 'eslint.config.*' >/dev/null; then npm run lint; fi
npm run build

RELEASE="$APP_ROOT/releases/$REVISION"
sudo install -d -o graytag-email -g graytag-email -m 0750 "$RELEASE"
sudo cp -a dist package.json package-lock.json "$RELEASE/"
sudo chown -R graytag-email:graytag-email "$RELEASE"
sudo -u graytag-email npm ci --omit=dev --ignore-scripts --prefix "$RELEASE"

sudo -u graytag-email ln -s ../../shared/data "$RELEASE/data"
sudo -u graytag-email ln -s ../../shared/gmail-token.json "$RELEASE/gmail-token.json"
sudo -u graytag-email ln -s ../../shared/gmail-history-id.txt "$RELEASE/gmail-history-id.txt"

test "$(readlink -f "$RELEASE/data")" = "$APP_ROOT/shared/data"
test "$(readlink -f "$RELEASE/gmail-token.json")" = "$APP_ROOT/shared/gmail-token.json"
test "$(readlink -f "$RELEASE/gmail-history-id.txt")" = "$APP_ROOT/shared/gmail-history-id.txt"
```

토큰/history 파일이 아직 없으면 서비스 계정 소유, `0600` 권한으로 먼저 만든다. OAuth 토큰의 유효한 내용은 인증 절차가 생성해야 하며 빈 JSON을 임의로 작성하지 않는다.

## systemd 템플릿 설치

저장소의 템플릿은 의도적으로 실제 계정과 경로를 포함하지 않는다. 임시 파일에서 플레이스홀더를 치환하고 검증한 뒤 `/etc`에 설치한다.

```bash
sed \
  -e 's|@@SERVICE_USER@@|graytag-email|g' \
  -e 's|@@SERVICE_GROUP@@|graytag-email|g' \
  -e 's|@@APP_ROOT@@|/srv/graytag-email-dashboard|g' \
  deploy/systemd/graytag-email-dashboard.service.template \
  > /tmp/graytag-email-dashboard.service

systemd-analyze verify /tmp/graytag-email-dashboard.service
sudo -u graytag-email test -r \
  /etc/graytag-email-dashboard/gmail-client-secret.json
sudo install -o root -g root -m 0644 /tmp/graytag-email-dashboard.service \
  /etc/systemd/system/graytag-email-dashboard.service
rm -f /tmp/graytag-email-dashboard.service
sudo systemctl daemon-reload
sudo systemctl enable graytag-email-dashboard.service
```

## 전환, 확인, 롤백

release 설치가 끝난 뒤에만 `current`를 교체한다. 실패하면 이전 링크 대상으로 즉시 되돌린다.

```bash
APP_ROOT=/srv/graytag-email-dashboard
REVISION=<full-commit-sha>
PREVIOUS="$(readlink -f "$APP_ROOT/current" || true)"

sudo ln -sfn "$APP_ROOT/releases/$REVISION" "$APP_ROOT/current.next"
sudo mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
sudo systemctl restart graytag-email-dashboard.service

curl --fail --silent --show-error http://127.0.0.1:3001/email/ >/dev/null
sudo systemctl is-active --quiet graytag-email-dashboard.service
```

확인에 실패하면:

```bash
test -n "$PREVIOUS"
sudo ln -sfn "$PREVIOUS" "$APP_ROOT/current.next"
sudo mv -Tf "$APP_ROOT/current.next" "$APP_ROOT/current"
sudo systemctl restart graytag-email-dashboard.service
```

로그는 비밀 값이 포함될 수 있으므로 공유 전에 반드시 마스킹한다. 점검은 `systemctl status graytag-email-dashboard.service`와 `journalctl -u graytag-email-dashboard.service`를 사용하되 원문을 이슈나 CI 로그에 붙이지 않는다. 정상 배포 후에도 직전 release는 롤백용으로 보존하고, 사용 중이 아닌 오래된 release만 별도 정책으로 정리한다.