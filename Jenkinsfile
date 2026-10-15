// Deploy desk.wabo.ai — mirrors .github/workflows/deploy.yml.
//
// Set the job's branch trigger (webhook / polling) to fire this on push to the
// deploy branch; this file itself does not restrict which branch it runs on.
//
// Required Jenkins credentials (create these in the job/folder before first run):
//   desk-deploy-ssh-key      SSH Username with private key — the restricted key that
//                            can only run deploy/hostinger/ci-entry.sh on the server
//   desk-deploy-host         Secret text — user@host for the deploy target (e.g. root@1.2.3.4)
//   desk-deploy-known-hosts  Secret text — contents of the server's known_hosts line(s)
// Optional (web image source-map upload; build proceeds without them):
//   sentry-auth-token        Secret text
// Optional job parameters/env: SENTRY_ORG, SENTRY_PROJECT
//
// Agent must have: the Jenkins NodeJS tool "22-latest" (Manage Jenkins > Tools),
// pinned to Node >= 22.12.0 — older 22.x predates Node's default support for
// require() of ESM and vitest's unplugin-swc chain fails with ERR_REQUIRE_ESM.
// Also needs Docker with the docker-workflow plugin, and network access to pull
// aquasec/trivy:0.75.0 and to reach the Hostinger box over SSH.

pipeline {
  agent any

  tools {
    nodejs '22-latest'
  }

  options {
    timeout(time: 40, unit: 'MINUTES')
    disableConcurrentBuilds()
  }

  environment {
    CRM_DIR = 'crm-platform'
  }

  stages {
    stage('Install & unit test') {
      steps {
        dir(env.CRM_DIR) {
          sh '''#!/usr/bin/env bash
            set -euo pipefail
            corepack enable
            corepack prepare pnpm@9.15.4 --activate
            pnpm install --frozen-lockfile
            pnpm --filter @crm/tax build
            pnpm --filter @crm/contracts build
            pnpm --filter @crm/db build
            pnpm --filter @crm/api test
          '''
        }
      }
    }

    stage('Build images') {
      steps {
        dir(env.CRM_DIR) {
          script {
            env.IMAGE_TAG = sh(script: 'git rev-parse --short=8 HEAD', returnStdout: true).trim()
          }
          withCredentials([string(credentialsId: 'sentry-auth-token', variable: 'SENTRY_AUTH_TOKEN')]) {
            sh '''#!/usr/bin/env bash
              set -euo pipefail
              docker build -f apps/api/Dockerfile -t "desk-api:${IMAGE_TAG}" --build-arg GIT_SHA="${IMAGE_TAG}" .
              docker build -f apps/web/Dockerfile -t "desk-web:${IMAGE_TAG}" \
                --build-arg NEXT_PUBLIC_SENTRY_DSN=https://7a686f169d4a7b804e5eb7b6fdd9e806@o4507446172188672.ingest.us.sentry.io/4512202246324224 \
                --build-arg NEXT_PUBLIC_GIT_SHA="${IMAGE_TAG}" \
                --build-arg SENTRY_ORG="${SENTRY_ORG:-}" \
                --build-arg SENTRY_PROJECT="${SENTRY_PROJECT:-}" \
                --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN \
                .
            '''
          }
        }
      }
    }

    stage('Scan images') {
      // QA task 39 equivalent: a fixable HIGH/CRITICAL finding stops the release.
      // .trivyignore lives at the outer repo root, not under crm-platform/.
      steps {
        sh '''#!/usr/bin/env bash
          set -euo pipefail
          for image in "desk-api:${IMAGE_TAG}" "desk-web:${IMAGE_TAG}"; do
            docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/.trivyignore:/.trivyignore:ro" \
              aquasec/trivy:0.75.0 image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --ignorefile /.trivyignore "$image"
          done
        '''
      }
    }

    stage('Ship & release') {
      steps {
        dir(env.CRM_DIR) {
          withCredentials([
            sshUserPrivateKey(credentialsId: 'desk-deploy-ssh-key', keyFileVariable: 'DEPLOY_KEY', usernameVariable: 'DEPLOY_USER'),
            string(credentialsId: 'desk-deploy-host', variable: 'DEPLOY_HOST'),
            string(credentialsId: 'desk-deploy-known-hosts', variable: 'DEPLOY_KNOWN_HOSTS')
          ]) {
            sh '''#!/usr/bin/env bash
              set -euo pipefail
              install -m 700 -d "$HOME/.ssh"
              printf '%s\\n' "$DEPLOY_KNOWN_HOSTS" > "$HOME/.ssh/known_hosts_desk"

              ssh_desk() {
                ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
                    -o UserKnownHostsFile="$HOME/.ssh/known_hosts_desk" \
                    -i "$DEPLOY_KEY" "${DEPLOY_USER:-root}@${DEPLOY_HOST}" "$@"
              }

              tar -C deploy/hostinger -c docker-compose.yml init-roles.sh seed.js set-secrets.sh ci-entry.sh .env.example | ssh_desk sync
              docker save "desk-api:${IMAGE_TAG}" "desk-web:${IMAGE_TAG}" | gzip -1 | ssh_desk load
              ssh_desk "release ${IMAGE_TAG}"
            '''
          }
        }
      }
    }

    stage('Smoke test') {
      steps {
        sh '''#!/usr/bin/env bash
          set -euo pipefail
          for i in $(seq 1 12); do
            code=$(curl -s -o /dev/null -w '%{http_code}' https://desk.wabo.ai/ready || true)
            [ "$code" = 200 ] && { echo "ready"; exit 0; }
            sleep 5
          done
          echo "https://desk.wabo.ai/ready did not return 200" >&2
          exit 1
        '''
      }
    }
  }
}
