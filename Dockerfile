FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

# Copiar todos los archivos JS de la raíz
COPY *.js ./

EXPOSE 3001

CMD ["node", "index.js"]
