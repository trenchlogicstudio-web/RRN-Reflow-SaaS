# Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=8787 DB_PATH=/app/data/local.sqlite
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "local.js"]
