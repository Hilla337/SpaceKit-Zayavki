FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
COPY web ./web
USER node
EXPOSE 8080
# Сначала миграции (повторяем, пока база не поднимется), потом сервер.
CMD ["sh", "-c", "until node dist/migrate.js; do echo 'жду базу…'; sleep 3; done; exec node dist/server.js"]
