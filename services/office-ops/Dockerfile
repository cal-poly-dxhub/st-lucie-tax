# Container image for the Express API running on Lambda via the AWS Lambda
# Web Adapter (LWA). LWA is added as a Lambda extension and bridges API Gateway
# events to the Express server listening on $PORT — the server code is
# unchanged from local dev. The same image backs both AppointmentFn and
# QueueFn; the SERVICE env var (set per-function in CDK) selects which routers
# mount.
#
# Build context: repo root (needed for the root lockfile).
FROM --platform=linux/arm64 node:22-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
COPY services/office-ops/package.json ./services/office-ops/
COPY services/office-ops/tsconfig.json ./services/office-ops/
RUN npm ci --workspace=@st-lucie/office-ops --include-workspace-root --ignore-scripts
COPY services/office-ops/src ./services/office-ops/src
COPY services/office-ops/server ./services/office-ops/server
RUN npx tsc -p services/office-ops/tsconfig.json

FROM --platform=linux/arm64 node:22-slim AS deps
WORKDIR /deps
COPY package.json package-lock.json ./
COPY services/office-ops/package.json ./services/office-ops/
RUN npm ci --workspace=@st-lucie/office-ops --include-workspace-root --omit=dev --ignore-scripts

FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:22
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter
WORKDIR /var/task
COPY --from=deps /deps/node_modules ./node_modules
COPY --from=build /build/services/office-ops/dist ./dist

ENV PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/healthz
ENV AWS_LWA_PORT=8080

ENTRYPOINT []
CMD ["node", "dist/server/index.js"]
