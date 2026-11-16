FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY packages ./packages
COPY apps/api ./apps/api
COPY tsconfig.json ./

EXPOSE 4000
CMD ["npx", "tsx", "apps/api/src/server.ts"]
