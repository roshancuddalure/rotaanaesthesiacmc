FROM node:22-slim

WORKDIR /app

COPY package.json tsconfig.json index.html ./
COPY src ./src

RUN npm install

EXPOSE 5173

CMD ["npm", "run", "dev"]

