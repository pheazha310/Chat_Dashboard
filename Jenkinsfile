// Chat Dashboard pipeline (multibranch). A separate Jenkins job from LOS: nothing here touches the LOS pipeline.
// `nak` deploys DEV and `staging` deploys STG, over SSH, like LOS. Other branches only run the checks.
// There is deliberately no PROD stage (out of scope). Images are built ON the target host by the deploy script
// (LOS Dev/Staging do the same), so the Mac running Jenkins needs no Docker.
//
// Jenkins credentials to create (IDs are proposals; none exist yet, secrets never live in this file):
//   chatdash-deploy-ssh   SSH private key (sshagent) of the deploy user on the shared server
//   chatdash-deploy-host  Secret text: server host name
//   chatdash-deploy-user  Secret text: SSH user
//   chatdash-test-database-url / chatdash-test-redis-url  Secret text, only for the integration-test stage
pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    timestamps()
  }

  parameters {
    booleanParam(name: 'RUN_INTEGRATION', defaultValue: false,
      description: 'Run the PostgreSQL/Redis integration tests. Needs a throwaway test DB + Redis and the two test credentials.')
  }

  environment {
    CI = 'true'
    // Prisma 7 reads DATABASE_URL even for `generate`; this placeholder never connects.
    DATABASE_URL = 'postgresql://build:build@localhost:5432/build'
    DEV_DIR = '/home/ubuntu/chatdash-dev'
    STG_DIR = '/home/ubuntu/chatdash-staging'
  }

  stages {
    stage('Install') {
      steps { sh 'corepack enable && pnpm install --frozen-lockfile' }
    }
    stage('Prisma client') {
      steps { sh 'pnpm db:generate' }
    }
    stage('Lint, types, FSD, format') {
      steps {
        sh 'pnpm lint'
        sh 'pnpm typecheck'
        sh 'pnpm check:fsd'
        sh 'pnpm format:check'
        sh 'npx prettier --check backend/src'
      }
    }
    stage('Unit tests') {
      // Integration files skip themselves when TEST_DATABASE_URL is unset.
      steps { sh 'env -u TEST_DATABASE_URL -u TEST_REDIS_URL pnpm test' }
    }
    stage('Integration tests') {
      when { expression { params.RUN_INTEGRATION } }
      steps {
        withCredentials([string(credentialsId: 'chatdash-test-database-url', variable: 'TEST_DATABASE_URL'),
                         string(credentialsId: 'chatdash-test-redis-url', variable: 'TEST_REDIS_URL')]) {
          // The throwaway DB needs the migrations first. Its name must contain "test" (the tests refuse otherwise).
          sh 'DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @chat-dashboard/backend exec prisma migrate deploy'
          sh 'pnpm --filter @chat-dashboard/backend test'
        }
      }
    }
    stage('Build') {
      steps { sh 'pnpm build' }
    }

    stage('Deploy DEV') {
      when { branch 'nak' }
      steps { deploy(env.DEV_DIR, 'nak', 'deploy-dev.sh') }
    }
    stage('Deploy STG') {
      when { branch 'staging' }
      steps { deploy(env.STG_DIR, 'staging', 'deploy-staging.sh') }
    }
    stage('Smoke test') {
      when { anyOf { branch 'nak'; branch 'staging' } }
      steps {
        // Runs on the server against the public URL from that environment's env file. Backend + web + WebSocket
        // + iframe header only. The LOS hand-off and mobile flows are manual (docs/deployment.md, section 9).
        script {
          def dir = env.BRANCH_NAME == 'nak' ? env.DEV_DIR : env.STG_DIR
          def envFile = env.BRANCH_NAME == 'nak' ? '.env.dev' : '.env.staging'
          ssh("cd ${dir} && set -a && . ./${envFile} && set +a && ./deployment/scripts/smoke-test.sh")
        }
      }
    }
  }

  post {
    // The deploy scripts already post to Telegram when the server env file has TELEGRAM_* (the LOS convention).
    success { echo "Chat Dashboard ${env.BRANCH_NAME} #${env.BUILD_NUMBER}: OK" }
    failure { echo "Chat Dashboard ${env.BRANCH_NAME} #${env.BUILD_NUMBER}: FAILED. Read the log; a failed deploy leaves the previous version serving." }
  }
}

// Fast-forward only: a diverged checkout fails instead of deploying something unreviewed.
def deploy(String dir, String branch, String script) {
  ssh("cd ${dir} && git fetch origin ${branch} && git checkout ${branch} && git merge --ff-only origin/${branch} && ./deployment/scripts/${script}")
}

def ssh(String remoteCommand) {
  withCredentials([string(credentialsId: 'chatdash-deploy-host', variable: 'DEPLOY_HOST'),
                   string(credentialsId: 'chatdash-deploy-user', variable: 'DEPLOY_USER')]) {
    sshagent(['chatdash-deploy-ssh']) {
      sh "ssh -o StrictHostKeyChecking=yes \"\$DEPLOY_USER@\$DEPLOY_HOST\" '${remoteCommand}'"
    }
  }
}
