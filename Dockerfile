FROM oven/bun:1 AS deps
WORKDIR /app/server

COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1 AS runtime
WORKDIR /app/server

COPY --from=deps /app/server/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src

ENV NODE_ENV=production
ENV CALLME_PORT=3333

EXPOSE 3333

CMD ["bun", "run", "src/index.ts"]
