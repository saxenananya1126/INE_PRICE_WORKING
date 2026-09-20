# Runs the API + the Playwright scraper on Render.
FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    HEADLESS=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 1. dependencies (cached unless package.json / package-lock.json change)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 2. Chromium plus the system libraries it needs; installs the build that matches the
#    Playwright version in package-lock.json, so versions can never drift apart
RUN npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# 3. the app
COPY . .

# Render sets PORT itself; src/config.js reads it
CMD ["node", "src/server.js"]