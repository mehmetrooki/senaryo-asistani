# Senaryo Asistanı — ekip sunucusu
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    SENARYO_ASISTANI_DATA=/data \
    PORT=8000

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# /data kalıcı disk olmalı (Bellek, kurallar, senaryolar burada tutulur)
VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "sunucu.py"]
