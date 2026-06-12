FROM node:20-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
