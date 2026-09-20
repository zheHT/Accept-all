# ============================================================
# AI Shipping Document Checker
# Backend dependencies
# ============================================================

# REST API used by the frontend / Telegram integration.
fastapi

# ASGI server.
# Cloud Run will provide the PORT environment variable.
uvicorn[standard]

# Required by FastAPI for multipart file uploads.
python-multipart

# Official Google Gen AI SDK.
# Supports Gemini and Google Cloud Vertex AI.
google-genai

# Structured schemas and validation for extracted document data.
pydantic>=2,<3

# Local environment variable loading during development.
python-dotenv

# Normalize PDF, DOCX, and XLSX documents into Markdown.
# Installing only the document formats required by this project
# avoids unnecessary dependencies.
markitdown[pdf,docx,xlsx]

# Automated testing.
pytest