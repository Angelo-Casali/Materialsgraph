"""ASGI entrypoint: `uvicorn mg_api.asgi:app`."""

from mg_api.app import create_app

app = create_app()
