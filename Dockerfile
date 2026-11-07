FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server.mjs package.json ./
COPY --chown=node:node server/ server/
COPY --chown=node:node web/ web/
ENV HOST=0.0.0.0 PORT=8787 NODE_ENV=production
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
