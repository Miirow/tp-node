FROM node:24-alpine AS development

USER node
WORKDIR /home/node
RUN mkdir -p /home/node/data

FROM node:24-alpine AS build

USER node
WORKDIR /home/node
COPY --chown=node:node . .
RUN npm install && npm run build

FROM node:24-alpine AS production

USER node
WORKDIR /home/node
RUN mkdir -p /home/node/data
COPY --chown=node:node --from=build /home/node/package.json /home/node/package.json
COPY --chown=node:node --from=build /home/node/package-lock.json /home/node/package-lock.json
COPY --chown=node:node --from=build /home/node/dist /home/node/dist
RUN npm install --omit dev

CMD ["npm", "start"]
EXPOSE 3000
