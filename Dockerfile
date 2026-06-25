# Container image for the Express API running on Lambda via the AWS Lambda
# Web Adapter (LWA). LWA is added as a Lambda extension and bridges API Gateway
# events to the Express server listening on $PORT — the server code is
# unchanged from local dev. The same image backs both AppointmentFn and
# QueueFn; the SERVICE env var (set per-function in CDK) selects which routers
# mount.
FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:22 AS build
RUN npm install -g npm@11
WORKDIR /build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --omit=optional
COPY src ./src
COPY server ./server
# Compile TS → dist/ (ESM, .js import specifiers already present in source).
RUN npx tsc -p tsconfig.json

FROM --platform=linux/arm64 public.ecr.aws/lambda/nodejs:22
RUN npm install -g npm@11
# Lambda Web Adapter extension.
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.8.4 /lambda-adapter /opt/extensions/lambda-adapter

WORKDIR /var/task
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional
COPY --from=build /build/dist ./dist

# LWA configuration: the server listens on PORT and LWA polls /healthz to know
# the app is ready before forwarding requests.
ENV PORT=8080
ENV AWS_LWA_READINESS_CHECK_PATH=/healthz
ENV AWS_LWA_PORT=8080

# Override the Lambda base image's Node handler entrypoint: run the real server.
ENTRYPOINT []
CMD ["node", "dist/server/index.js"]
