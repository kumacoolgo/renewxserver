FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY *.js ./

RUN npx playwright install chromium

CMD ["node", "bot.js"]
