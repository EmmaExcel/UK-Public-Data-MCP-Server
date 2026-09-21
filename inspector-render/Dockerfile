FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY proxy.mjs start.sh ./
RUN chmod +x start.sh

RUN npm install -g @modelcontextprotocol/inspector

ENV NODE_ENV=production
ENV CLIENT_PORT=6274
ENV SERVER_PORT=6277

CMD ["./start.sh"]
