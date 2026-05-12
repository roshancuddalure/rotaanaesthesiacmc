FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json tsconfig.json vite.config.ts index.html ./
COPY src ./src

RUN npm ci
RUN npm run build

EXPOSE 4173

CMD ["sh", "-c", "npm run preview -- --host 0.0.0.0 --port ${PORT:-4173}"]
