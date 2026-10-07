# Portable image for Render free / a VM / local use. Build from the repo root:
#   docker build -f api/Dockerfile -t materialsgraph-api .
FROM python:3.11-slim
WORKDIR /app
COPY api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt uvicorn
COPY api/mg_api /app/mg_api
COPY src/materialsgraph /app/materialsgraph
ENV PYTHONPATH=/app PUBLIC_MODE=1 EMBEDDING_BACKEND=none
EXPOSE 7860
CMD ["sh", "-c", "uvicorn mg_api.asgi:app --host 0.0.0.0 --port ${PORT:-7860}"]
