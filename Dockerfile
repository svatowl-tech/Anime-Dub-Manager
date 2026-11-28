# ==============================================================================
# Stage 1: Build Portable Python AI Environment (x86_64 & ARM64)
# ==============================================================================
FROM python:3.10-slim-bookworm AS ai_env_builder

ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    PYTHONUTF8=1 \
    AENEAS_WITH_CEW=False

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak \
    espeak-ng \
    libsndfile1 \
    libgomp1 \
    git \
    curl \
    build-essential \
    pkg-config \
    rustc \
    cargo \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY scripts/build-ai-env.py ./scripts/build-ai-env.py
COPY requirements-ai.txt ./requirements-ai.txt
COPY electron/sidecars/audio_ai_processor.py ./electron/sidecars/audio_ai_processor.py

RUN python3 scripts/build-ai-env.py --install-dir /opt/ai_env --skip-zip --skip-system-deps

# ==============================================================================
# Stage 2: Build Web Frontend (Vite) & Prune Production Node Modules
# ==============================================================================
FROM node:22-bookworm-slim AS node_builder

WORKDIR /app
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev

# ==============================================================================
# Stage 3: Production Umbrel OS / Home Server Runtime
# ==============================================================================
FROM node:22-bookworm-slim AS runtime

ARG TARGETARCH
ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PORT=3000 \
    ADM_SERVER_MODE=true \
    ADM_DATA_DIR=/data \
    ADM_AI_ENV_DIR=/opt/ai_env \
    TORCH_HOME=/data/models/torch \
    HF_HOME=/data/models/huggingface \
    DEEPFILTERNET_CACHE=/data/models/deepfilternet \
    LD_LIBRARY_PATH=/opt/ai_env/python_env/lib \
    YOUTUBE_DL_SKIP_DOWNLOAD=true

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    espeak \
    espeak-ng \
    libsndfile1 \
    libgomp1 \
    ca-certificates \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Install matching architecture yt-dlp standalone binary
RUN set -eux; \
    YTDLP_BIN="yt-dlp_linux"; \
    if [ "${TARGETARCH:-amd64}" = "arm64" ]; then YTDLP_BIN="yt-dlp_linux_aarch64"; fi; \
    curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_BIN}" -o /usr/local/bin/yt-dlp; \
    chmod +x /usr/local/bin/yt-dlp

# Install tsx globally so server, CLI, and MCP stdio work cleanly without devDependencies
RUN npm install -g tsx@4.21.0

WORKDIR /app

COPY --from=ai_env_builder /opt/ai_env /opt/ai_env
COPY --from=node_builder /app/node_modules ./node_modules
COPY --from=node_builder /app/dist ./dist
COPY --from=node_builder /app/package.json ./package.json
COPY --from=node_builder /app/package-lock.json ./package-lock.json
COPY --from=node_builder /app/tsconfig.json ./tsconfig.json
COPY --from=node_builder /app/server.ts ./server.ts
COPY --from=node_builder /app/server ./server
COPY --from=node_builder /app/electron ./electron
COPY --from=node_builder /app/docs ./docs
COPY --from=node_builder /app/src/build-metadata.json ./src/build-metadata.json
COPY --from=node_builder /app/scripts/bootstrap.mjs ./scripts/bootstrap.mjs
COPY --from=node_builder /app/scripts/compute-ai-env-hash.cjs ./scripts/compute-ai-env-hash.cjs
COPY --from=node_builder /app/scripts/generate-metadata.js ./scripts/generate-metadata.js

RUN mkdir -p /data /app/assets/bin \
    && ln -sf /usr/local/bin/yt-dlp /app/assets/bin/yt-dlp

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/bootstrap.mjs", "--server", "--prod"]
