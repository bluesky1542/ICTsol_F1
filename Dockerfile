FROM node:24-bookworm-slim AS web
WORKDIR /build/mobile
COPY mobile/package.json mobile/package-lock.json ./
RUN npm ci
COPY mobile/ ./
ENV EXPO_PUBLIC_API_BASE_URL=/
ENV EXPO_PUBLIC_DEMO_MODE=0
RUN npx expo export --platform web

FROM python:3.13-slim-bookworm
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app/ ./app/
COPY --from=web /build/mobile/dist/ /app/web/
ENV WEB_DIST_PATH=/app/web \
    DATABASE_PATH=/app/data/app.sqlite3 \
    PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/api/health',timeout=4)"
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
