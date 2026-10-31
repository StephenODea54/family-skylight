FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MCP_DATA_DIR=/data
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "dist/index.js"]
