# Senaryo Asistanı — ekip sunucusu (Fastify + Next.js)
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN NEXT_TELEMETRY_DISABLED=1 npm run build
ENV HOST=0.0.0.0 PORT=8000 SENARYO_ASISTANI_DATA=/data
VOLUME ["/data"]
EXPOSE 8000
CMD ["npm", "start"]
