FROM node:20-alpine

WORKDIR /app

# Copiar archivos de configuración primero (mejor para caché de Docker)
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código de la aplicación
# Esto copiará TODO: index.js, la carpeta frontend, etc.
COPY . .

# Opcional: Si quieres asegurarte de que los archivos JS estén presentes
# COPY *.js ./
# COPY frontend/ ./frontend/

EXPOSE 3000

CMD ["node", "index.js"]
