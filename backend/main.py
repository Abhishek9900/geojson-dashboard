"""
GeoJSON Dashboard — FastAPI Backend Entry Point.

Sets up logging, CORS middleware, and registers the GeoJSON router.
"""

import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.config import settings
from app.routers import geojson

# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------

# Remove the default loguru sink, then add our own with structured formatting.
logger.remove()
logger.add(
    sys.stderr,
    format=(
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>"
    ),
    level="DEBUG" if settings.debug else "INFO",
)
logger.add(
    "logs/app.log",
    rotation="10 MB",
    retention="7 days",
    level="INFO",
)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    """Log startup / shutdown events for operational visibility."""
    logger.info("Starting GeoJSON Dashboard API...")
    yield
    logger.info("Shutting down GeoJSON Dashboard API...")


# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------

app = FastAPI(
    title="GeoJSON Dashboard API",
    description=(
        "Backend API for processing, validating, and managing GeoJSON farm data."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow the Next.js frontend (and any configured origin) to reach the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register feature routers under versioned prefix.
app.include_router(geojson.router, prefix="/api/geojson", tags=["GeoJSON"])


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/health", tags=["Health"])
async def health_check() -> dict:
    """Lightweight liveness probe used by Docker / load balancers."""
    return {"status": "ok", "version": "1.0.0"}
