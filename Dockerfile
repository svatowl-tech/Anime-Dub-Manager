FROM node:20-slim

# Установка зависимостей для Prisma и FFmpeg
RUN apt-get update && apt-get install -y openssl ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Генерация Prisma-клиента
RUN npx prisma generate

# Сборка фронтенда
RUN npm run build

EXPOSE 3000

# Запуск сервера
CMD ["npm", "start"]
