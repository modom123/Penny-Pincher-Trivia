# Persistent worker (not an HTTP server) - suitable for any long-running-process
# host: Fly.io, Railway, Render (Background Worker), ECS/Fargate, a bare VM, etc.
# Provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example) as
# platform secrets/env vars - do not bake them into the image.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.js ./

# Game Director mode: polls for runnable games, drives them, and keeps the
# lobby stocked via the auto-scheduler. See README.md.
CMD ["node", "index.js", "--watch"]
