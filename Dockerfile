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
# Build frontend
RUN npm run build
# Compile server TypeScript to JavaScript
RUN npx tsc --project tsconfig.json

# ================================
# Stage 2: Production
# ================================
# FROM docker.m.daocloud.io/library/node:22-alpine
FROM node:22-alpine

WORKDIR /app

# 【新增这一行】：将 Alpine 的默认软件源替换为阿里云镜像
# RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

COPY package.json package-lock.json ./

# Install production deps only (no tsx needed),
# with build tools only present during npm install
RUN apk add --no-cache --virtual .build-deps python3 make g++ && \
    npm ci --omit=dev && \
    npm cache clean --force && \
    apk del .build-deps && \
    rm -rf /root/.cache /tmp/*

# Copy compiled server JS from builder stage
COPY --from=builder /app/dist/src/server dist/src/server

# Copy built frontend from builder stage (path must match __dirname/../web/dist from compiled server)
COPY --from=builder /app/src/web/dist dist/src/web/dist

# Create data directories
RUN mkdir -p data/videos data/uploads

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/src/server/index.js"]
