FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    make \
    g++ \
    python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --production

COPY . .

ENV NODE_ENV=production
CMD ["node", "bot.js"]
