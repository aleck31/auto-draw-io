# Multi-stage Dockerfile for Next.js

# Base image for every stage; CodeBuild passes a public ECR mirror to avoid Docker Hub rate limits
ARG NODE_IMAGE=node:26-alpine

# Stage 1: Install dependencies
FROM ${NODE_IMAGE} AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Stage 2: draw.io, in its own stage so source changes don't re-download it.
# DRAWIO_WAR_PATH points at a draw.war in the build context for air-gapped builds.
FROM ${NODE_IMAGE} AS drawio
WORKDIR /app
ARG DRAWIO_WAR_PATH=
COPY scripts/drawio-version.json scripts/drawio-zip.mjs scripts/fetch-drawio.mjs ./scripts/
COPY ${DRAWIO_WAR_PATH:-scripts/drawio-version.json} /tmp/drawio-input
RUN mkdir -p public/drawio && \
    if [ -n "$DRAWIO_WAR_PATH" ]; then export DRAWIO_WAR_PATH=/tmp/drawio-input; fi && \
    node scripts/fetch-drawio.mjs

# Stage 3: Build application
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=drawio /app/public/drawio ./public/drawio

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time setting, inlined into the app by next.config.ts: subdirectory deployment, e.g. /nextaidrawio.
ARG AUTO_BASE_PATH=
ENV AUTO_BASE_PATH=${AUTO_BASE_PATH}

# Build Next.js application (standalone mode)
RUN npm run build

# Stage 4: Production runtime
FROM ${NODE_IMAGE} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Start the application
CMD ["node", "server.js"]

