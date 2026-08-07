# ============================================================
# Harness — Coding Agent Harness
# Dockerfile (multi-stage build, production-ready)
# ============================================================

# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/

# Install dependencies (no devDependencies in production)
RUN npm ci --omit=dev

# ---- Stage 2: Build ----
FROM node:22-alpine AS build
WORKDIR /app

# Copy root config
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/server/ packages/server/
COPY packages/cli/ packages/cli/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Build all packages
RUN npm run build

# ---- Stage 3: Production ----
FROM node:22-alpine AS production
WORKDIR /app

# Environment
ENV NODE_ENV=production
EXPOSE 3000

# Copy production dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./

# Copy built artifacts from build stage
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --from=build /app/packages/cli/package.json ./packages/cli/

# Health check — use Node.js fetch instead of wget (not available in alpine)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok?0:1)).catch(() => process.exit(1))"

# Start the server
WORKDIR /app/packages/server
CMD ["node", "dist/server.js"]