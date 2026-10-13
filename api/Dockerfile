# Portable image for Render free / a VM / local use. Build from the repo root:
#   docker build -f api/Dockerfile -t materialsgraph-api .
FROM python:3.11-slim
WORKDIR /app
COPY api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt uvicorn
COPY api/mg_api /app/mg_api
COPY src/materialsgraph /app/materialsgraph
# TRUST_PROXY=0: rate limits key on the socket peer. Set TRUST_PROXY=1 only behind a reverse proxy that
# appends the client address to X-Forwarded-For (e.g. Render), never when exposed directly.
ENV PYTHONPATH=/app PUBLIC_MODE=1 EMBEDDING_BACKEND=none TRUST_PROXY=0
EXPOSE 7860
CMD ["sh", "-c", "uvicorn mg_api.asgi:app --host 0.0.0.0 --port ${PORT:-7860}"]
