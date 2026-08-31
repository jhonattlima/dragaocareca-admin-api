FROM node:22-bookworm AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/requirements-vps.txt ./requirements-vps.txt
COPY --from=build /app/requirements-faster-whisper.txt ./requirements-faster-whisper.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements-vps.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements-faster-whisper.txt
COPY --from=build /app/scripts/faster_whisper_transcribe.py ./scripts/faster_whisper_transcribe.py
COPY --from=build /app/src/scripts/spotify-metrics.py ./src/scripts/spotify-metrics.py
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
