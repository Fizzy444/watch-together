FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3001
ENV PORT=3001 HOST=0.0.0.0

CMD ["node", "src/index.js"]
