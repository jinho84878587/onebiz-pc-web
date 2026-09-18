FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node . .
USER node
EXPOSE 10000
CMD ["node","server.js"]
