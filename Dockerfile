# OpenLossless BitChord addon — production image
FROM node:22-alpine AS base
ENV NODE_ENV=production
WORKDIR /app

COPY package.json server.js ./
COPY src ./src

# No dependencies to install (zero-dep project); drop to an unprivileged user.
USER node
EXPOSE 8787
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=2 \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null || exit 1

CMD ["node", "server.js"]
