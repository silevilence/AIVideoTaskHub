# ================================
# Stage 1: Build frontend assets
# ================================
# FROM docker.m.daocloud.io/library/node:22-alpine AS builder
FROM node:22-alpine AS builder

WORKDIR /app

# 【新增这一行】：将 Alpine 的默认软件源替换为阿里云镜像
# RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# Install build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ================================
# Stage 2: Production
# ================================
# FROM docker.m.daocloud.io/library/node:22-alpine
FROM node:22-alpine

WORKDIR /app

# 【新增这一行】：将 Alpine 的默认软件源替换为阿里云镜像
# RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

COPY package.json package-lock.json ./

# Install production deps + tsx (TypeScript runner) in one layer,
# with build tools only present during npm install
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev && \
    npm install tsx && \
    npm cache clean --force && \
    apk del .build-deps && \
    rm -rf /root/.cache /tmp/*

# Copy server source and TypeScript config
COPY src/server/ src/server/
COPY tsconfig.json ./

# Copy built frontend from builder stage
COPY --from=builder /app/src/web/dist src/web/dist

# Create data directories
RUN mkdir -p data/videos data/uploads

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npx", "tsx", "src/server/index.ts"]
