# Multi-stage Dockerfile for Next.js

# Stage 1: Install dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Stage 2: Build application
FROM node:22-alpine AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Disable Next.js telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1

# Build-time settings, inlined into the app by next.config.ts.
# EMBED_DRAWIO_BASE_URL: self-hosted draw.io; empty uses embed.diagrams.net.
# AUTO_BASE_PATH: subdirectory deployment, e.g. /nextaidrawio.
ARG EMBED_DRAWIO_BASE_URL=
ENV EMBED_DRAWIO_BASE_URL=${EMBED_DRAWIO_BASE_URL}
ARG AUTO_BASE_PATH=
ENV AUTO_BASE_PATH=${AUTO_BASE_PATH}

# Build Next.js application (standalone mode)
RUN npm run build

# Stage 3: Production runtime
FROM node:22-alpine AS runner
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

