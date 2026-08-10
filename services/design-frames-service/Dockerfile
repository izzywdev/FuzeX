# design-frames-service — no build step (vanilla JS, no bundler), so the
# image just copies source and installs the (currently empty) dependency set.
FROM node:20-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund || true
COPY . .

ENV DESIGN_FRAMES_HOST=0.0.0.0
ENV DESIGN_FRAMES_PORT=4400
ENV DESIGN_FRAMES_DATA_DIR=/data/features
RUN mkdir -p /data/features && chown -R node:node /data/features /app
VOLUME ["/data/features"]

EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.DESIGN_FRAMES_PORT||4400)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
