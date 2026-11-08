import os
import io
import json
import math
import time
import uuid
import re
import hashlib
from datetime import datetime, timezone
from flask import Flask, request, jsonify, send_file
from supabase import create_client, Client
from dotenv import load_dotenv
from flask_cors import CORS
from PIL import Image
import pytesseract
from pypdf import PdfReader
from google import genai
from google.genai import types

load_dotenv(override=True)

app = Flask(__name__)
CORS(app)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Warning: Could not initialize Supabase client: {e}")

# Track whether optional Supabase tables exist to avoid repetitive console errors
_SUPABASE_TABLES_STATUS = {
    "medical_documents": True,
    "chat_logs": True,
}

# Lazy singleton for PaddleOCR so deep learning weights load once per server process
_PADDLE_OCR_ENGINE = None
_PADDLE_OCR_AVAILABLE = True


def get_paddle_ocr():
    """Lazily initialize and return a cached PaddleOCR instance."""
    global _PADDLE_OCR_ENGINE, _PADDLE_OCR_AVAILABLE
    if not _PADDLE_OCR_AVAILABLE:
        return None
    if _PADDLE_OCR_ENGINE is not None:
        return _PADDLE_OCR_ENGINE

    try:
        os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        from paddleocr import PaddleOCR
        try:
            _PADDLE_OCR_ENGINE = PaddleOCR(
                ocr_version="PP-OCRv4",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                lang="en",
            )
        except TypeError:
            _PADDLE_OCR_ENGINE = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        print("PaddleOCR initialized successfully.")
        return _PADDLE_OCR_ENGINE
    except Exception as e:
        print(f"PaddleOCR initialization warning (falling back to pytesseract): {e}")
        _PADDLE_OCR_AVAILABLE = False
        return None


def run_paddle_ocr_on_image(rgb_image: Image.Image) -> str:
    """Run PaddleOCR on a PIL RGB image and return extracted text lines."""
    ocr_engine = get_paddle_ocr()
    if ocr_engine is None:
        return ""

    try:
        import numpy as np
        img_array = np.array(rgb_image)
        lines = []

        # PaddleOCR 3.x (.predict) and 2.x (.ocr) compatibility
        if hasattr(ocr_engine, "predict"):
            results = ocr_engine.predict(img_array)
            for res in results:
                if isinstance(res, dict) and "rec_texts" in res:
                    lines.extend(res["rec_texts"])
                elif hasattr(res, "get") and res.get("rec_texts"):
                    lines.extend(res.get("rec_texts"))
                elif hasattr(res, "json") and isinstance(res.json, dict):
                    rec = res.json.get("res", {}).get("rec_texts") or res.json.get("rec_texts") or []
                    lines.extend(rec)
        else:
            results = ocr_engine.ocr(img_array)
            for page in (results or []):
                for line in (page or []):
                    if isinstance(line, (list, tuple)) and len(line) >= 2:
                        txt_info = line[1]
                        if isinstance(txt_info, (list, tuple)) and txt_info:
                            lines.append(str(txt_info[0]))

        return "\n".join(line.strip() for line in lines if line and str(line).strip())
    except Exception as e:
        print(f"PaddleOCR inference warning: {e}")
        return ""

LOCAL_UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(LOCAL_UPLOADS_DIR, exist_ok=True)


# ============================================================================
# In-Memory Runtime Cache (No local_store.json on disk; Supabase is Primary DB)
# ============================================================================

_RUNTIME_STORE = {
    "patients": [],
    "medical_documents": [],
    "reference_documents": [],
    "extraction_cache": {},
}


def _load_local_store() -> dict:
    return _RUNTIME_STORE


def _save_local_store(store: dict):
    pass


def get_gemini_client():
    load_dotenv(override=True)
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip().strip("'").strip('"')
    if api_key:
        return genai.Client(api_key=api_key)
    return genai.Client()


def generate_gemini_content(contents, config=None):
    """Call Gemini with model fallback across active quotas (gemini-3.5-flash-lite, gemini-3.5-flash, gemini-3.8-flash)."""
    client = get_gemini_client()
    preferred = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
    models_to_try = []
    for m in (preferred, "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"):
        if m not in models_to_try:
            models_to_try.append(m)

    last_err = None
    for model_name in models_to_try:
        try:
            return client.models.generate_content(
                model=model_name,
                config=config,
                contents=contents,
            )
        except Exception as e:
            last_err = e
            err_str = str(e)
            # If 404/NOT_FOUND or 429/RESOURCE_EXHAUSTED or INVALID_ARGUMENT, fall through to next available model
            if any(code in err_str for code in ("404", "NOT_FOUND", "429", "RESOURCE_EXHAUSTED", "INVALID_ARGUMENT")):
                continue
            break
    raise last_err


_EMBEDDING_MEM_CACHE = {}


def compute_embedding(text: str) -> list[float]:
    """Compute a 768-dim embedding using Gemini Embedding API (with memory cache), or deterministic fallback."""
    clean_text = (text or "").strip()
    if not clean_text:
        return [0.0] * 768

    text_hash = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()
    if text_hash in _EMBEDDING_MEM_CACHE:
        return _EMBEDDING_MEM_CACHE[text_hash]

    try:
        client = get_gemini_client()
        for embed_model in ("gemini-embedding-001", "text-embedding-004"):
            try:
                res = client.models.embed_content(
                    model=embed_model,
                    contents=clean_text,
                )
                values = list(res.embeddings[0].values)
                vec = values[:768] if len(values) >= 768 else values + [0.0] * (768 - len(values))
                _EMBEDDING_MEM_CACHE[text_hash] = vec
                return vec
            except Exception:
                continue
    except Exception:
        pass

    # Deterministic hashed bag-of-words/n-grams fallback into 768 dims
    vec = [0.0] * 768
    tokens = re.findall(r"[a-z0-9]+", clean_text.lower())
    for i, tok in enumerate(tokens):
        h = hash(tok) % 768
        vec[h] += 1.0
        if i + 1 < len(tokens):
            bigram_h = hash(tok + "_" + tokens[i + 1]) % 768
            vec[bigram_h] += 0.7
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    if not v1 or not v2:
        return 0.0
    n = min(len(v1), len(v2))
    dot = sum(v1[i] * v2[i] for i in range(n))
    norm1 = math.sqrt(sum(v1[i] * v1[i] for i in range(n)))
    norm2 = math.sqrt(sum(v2[i] * v2[i] for i in range(n)))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


def chunk_text(text: str, chunk_size: int = 600, overlap: int = 100) -> list[str]:
    clean = re.sub(r"\s+", " ", (text or "")).strip()
    if not clean:
        return []
    chunks = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + chunk_size)
        chunks.append(clean[start:end])
        if end == len(clean):
            break
        start = max(0, end - overlap)
    return chunks


def extract_text_from_bytes(file_content: bytes, filename: str, content_type: str = "") -> tuple[str, bool]:
    """Extract text from PDF (pypdf) or Image (PaddleOCR primary + pytesseract fallback)."""
    lower_name = (filename or "").lower()
    is_pdf = lower_name.endswith(".pdf")
    is_txt = lower_name.endswith(".txt") or lower_name.endswith(".md")
    text = ""

    if is_pdf:
        try:
            pdf_file = io.BytesIO(file_content)
            reader = PdfReader(pdf_file)
            for page in reader.pages:
                page_text = page.extract_text() or ""
                text += page_text + "\n"
        except Exception as e:
            print(f"PDF extraction warning: {e}")
    elif is_txt:
        text = file_content.decode("utf-8", errors="ignore")
    else:
        try:
            img_data = io.BytesIO(file_content)
            image = Image.open(img_data)
            rgb_image = image.convert("RGB")

            # 1. Primary OCR: PaddleOCR (deep-learning detector + recognizer for handwriting/photos)
            print("Running PaddleOCR on image...")
            text = run_paddle_ocr_on_image(rgb_image)

            # 2. Fallback OCR: pytesseract if PaddleOCR returned empty or is not installed
            if not text.strip():
                print("Falling back to pytesseract OCR...")
                text = pytesseract.image_to_string(rgb_image)
        except Exception as e:
            print(f"Image OCR warning: {e}")

    return text.strip(), is_pdf


def normalize_image_for_gemini(file_content: bytes) -> tuple[bytes, str]:
    """Resize image to <=768x768 RGB JPEG so Gemini bills it as a single 258-token tile."""
    try:
        img = Image.open(io.BytesIO(file_content)).convert("RGB")
        img.thumbnail((768, 768))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        return file_content, "image/jpeg"


def upload_to_storage(file_content: bytes, original_filename: str, content_type: str) -> str:
    """Upload document to Supabase 'documents' bucket with unique key; fallback to local uploads dir."""
    unique_filename = f"{uuid.uuid4()}_{original_filename}"
    file_path = f"uploads/{unique_filename}"

    try:
        local_path = os.path.join(LOCAL_UPLOADS_DIR, unique_filename)
        with open(local_path, "wb") as f:
            f.write(file_content)
    except Exception as e:
        print(f"Local file save warning: {e}")

    if supabase:
        try:
            supabase.storage.from_("documents").upload(
                path=file_path,
                file=file_content,
                file_options={"content-type": content_type or "application/octet-stream"},
            )
            document_url = supabase.storage.from_("documents").get_public_url(file_path)
            return document_url
        except Exception as e:
            print(f"Supabase storage upload notice (saved locally): {e}")

    return f"http://127.0.0.1:5001/uploads/{unique_filename}"


def index_document_for_rag(filename: str, document_url: str, raw_text: str, document_id: str = None) -> int:
    """Chunk text, generate embeddings, and store in Supabase vector store + runtime store."""
    chunks = chunk_text(raw_text)
    if not chunks:
        return 0

    doc_id = document_id or str(uuid.uuid4())
    store = _load_local_store()
    created_at = datetime.now(timezone.utc).isoformat()

    for idx, chunk in enumerate(chunks):
        emb = compute_embedding(chunk)
        record = {
            "id": str(uuid.uuid4()),
            "document_id": doc_id,
            "filename": filename,
            "document_url": document_url,
            "chunk_index": idx,
            "content": chunk,
            "embedding": emb,
            "created_at": created_at,
        }
        store["medical_documents"].append(record)

        if supabase and _SUPABASE_TABLES_STATUS.get("medical_documents", True):
            try:
                supabase.table("medical_documents").insert({
                    "document_id": doc_id,
                    "filename": filename,
                    "document_url": document_url,
                    "chunk_index": idx,
                    "content": chunk,
                    "embedding": emb,
                }).execute()
            except Exception as e:
                if "PGRST205" in str(e) or "Could not find the table" in str(e):
                    _SUPABASE_TABLES_STATUS["medical_documents"] = False
                    print("Info: Supabase 'medical_documents' table not created yet; using runtime vector store.")

    _save_local_store(store)
    return len(chunks)


def retrieve_rag_context(query: str, patient_name: str = None, top_k: int = 4) -> list[dict]:
    """Retrieve top-k relevant document chunks using vector similarity + keyword boost across all reference docs."""
    query_emb = compute_embedding(query)
    results = []

    if supabase and _SUPABASE_TABLES_STATUS.get("medical_documents", True):
        # Try without filter_patient_name first
        try:
            rpc_res = supabase.rpc(
                "match_medical_documents",
                {
                    "query_embedding": query_emb,
                    "match_threshold": 0.15,
                    "match_count": top_k,
                },
            ).execute()
            if rpc_res.data:
                for row in rpc_res.data:
                    results.append({
                        "document_id": row.get("document_id", ""),
                        "filename": row.get("filename", "Medical Document"),
                        "content": row.get("content", ""),
                        "similarity": round(float(row.get("similarity", 0.0)), 3),
                    })
        except Exception:
            # Fallback for older function signature if still present
            try:
                rpc_res = supabase.rpc(
                    "match_medical_documents",
                    {
                        "query_embedding": query_emb,
                        "match_threshold": 0.15,
                        "match_count": top_k,
                        "filter_patient_name": None,
                    },
                ).execute()
                if rpc_res.data:
                    for row in rpc_res.data:
                        results.append({
                            "document_id": row.get("document_id", ""),
                            "filename": row.get("filename", "Medical Document"),
                            "content": row.get("content", ""),
                            "similarity": round(float(row.get("similarity", 0.0)), 3),
                        })
            except Exception:
                pass

    store = _load_local_store()
    query_terms = set(re.findall(r"[a-z0-9]+", (query or "").lower()))
    scored_local = []

    for doc in store.get("medical_documents", []):
        sim = cosine_similarity(query_emb, doc.get("embedding", []))
        content_terms = set(re.findall(r"[a-z0-9]+", (doc.get("content") or "").lower()))
        overlap = len(query_terms & content_terms) / max(1, len(query_terms))
        combined_score = (0.7 * sim) + (0.3 * overlap)
        scored_local.append({
            "document_id": doc.get("document_id", ""),
            "filename": doc.get("filename", "Medical Document"),
            "content": doc.get("content", ""),
            "similarity": round(combined_score, 3),
        })

    scored_local.sort(key=lambda x: x["similarity"], reverse=True)

    seen_contents = {r["content"] for r in results}
    for item in scored_local:
        if item["content"] not in seen_contents and len(results) < top_k:
            results.append(item)
            seen_contents.add(item["content"])

    return results[:top_k]


def sanitize_contact_digits(raw_contact: str) -> str:
    """Convert common OCR digit lookalikes in phone numbers and strip any remaining non-digits."""
    if not raw_contact:
        return ""
    cleaned = (
        str(raw_contact)
        .replace("!", "1")
        .replace("|", "1")
        .replace("l", "1")
        .replace("I", "1")
        .replace("O", "0")
        .replace("o", "0")
    )
    return re.sub(r"\D", "", cleaned)


# ============================================================================
# Routes
# ============================================================================

@app.route("/extract", methods=["POST"])
def extract():
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "No file provided"}), 400

        filename = file.filename or "document"
        file.seek(0)
        file_content = file.read()
        content_type = file.content_type or "application/octet-stream"

        # 1. Upload to Supabase Storage ('documents' bucket) with unique UUID filename
        document_url = upload_to_storage(file_content, filename, content_type)
        print(f"Document stored at: {document_url}")

        # 2. Extract raw text using PdfReader (PDF) or PaddleOCR (Image)
        extracted_text, is_pdf = extract_text_from_bytes(file_content, filename, content_type)
        print("--- Extracted OCR/PDF Text ---")
        print(extracted_text[:500] if extracted_text else "(No OCR text detected)")

        # Check SHA-256 extraction cache first (keyed to text-only mode) so repeated testing uses 0 Gemini tokens
        file_hash = f"text_only:{hashlib.sha256(file_content).hexdigest()}"
        store = _load_local_store()
        extraction_cache = store.setdefault("extraction_cache", {})
        if file_hash in extraction_cache:
            cached_result = extraction_cache[file_hash]
            print(f"--- Using Cached Text-Only Extraction (0 Gemini tokens used) for {filename} ---")
            return jsonify(cached_result)

        # 3. Use Gemini Flash (Text-Only: receives ONLY extracted OCR/PDF text, never the image) to extract JSON
        extraction_prompt = (
            "Extract the patient registration details from this OCR/extracted text and return ONLY a valid JSON object "
            "with these exact keys: "
            "\"full_name\" (string), "
            "\"dob\" (string formatted as YYYY-MM-DD if possible), "
            "\"contact\" (string containing digits only), "
            "\"policy_number\" (string), "
            "\"complaint\" (string). "
            "Do NOT guess or hallucinate missing fields; if any field is missing or illegible in the text below, set its value to an empty string \"\". "
            f"\n\nOCR/Extracted text:\n{extracted_text}"
        )

        contents_payload = [extraction_prompt]

        parsed_json = None
        try:
            response = generate_gemini_content(
                contents=contents_payload,
                config={"response_mime_type": "application/json"},
            )
            print("--- Gemini Response ---")
            print(response.text)
            parsed_json = json.loads(response.text)
            if isinstance(parsed_json, list) and parsed_json:
                parsed_json = parsed_json[0]
        except Exception as gemini_err:
            print(f"Gemini extraction fallback to regex parser: {gemini_err}")

        # Regex fallback parser if offline or API error
        if not isinstance(parsed_json, dict):
            def _match(pattern, flags=re.IGNORECASE):
                m = re.search(pattern, extracted_text, flags)
                return re.sub(r"\s+", " ", m.group(1)).strip() if m else ""

            raw_dob = _match(r"Date\s*of\s*Birth\s*[:\-]?\s*([^\n\r]+)")
            raw_dob = (
                raw_dob.replace("|", "1")
                .replace("l", "1")
                .replace("I", "1")
                .replace("+", "7")
                .replace("O", "0")
            )
            if re.match(r"^1[14]\d{2}-", raw_dob):
                raw_dob = "19" + raw_dob[2:]
            if re.match(r"^\d{2}/\d{2}/\d{4}$", raw_dob):
                parts = raw_dob.split("/")
                raw_dob = f"{parts[2]}-{parts[1]}-{parts[0]}"

            raw_contact = _match(r"Contact[^:\n]*[:\-]?\s*([^\n\r]+)")
            raw_complaint = _match(
                r"(?:Complaint|Reason\s*for\s*Visit)[^\n:]*[:\-]\s*(.+)$",
                flags=re.IGNORECASE | re.DOTALL,
            )
            if not raw_complaint:
                raw_complaint = _match(
                    r"Reason\s*for\s*Visit\s+(.+)$",
                    flags=re.IGNORECASE | re.DOTALL,
                )

            parsed_json = {
                "full_name": _match(r"Full\s*Name\s*[:\-]?\s*([^\n\r]+)").rstrip("."),
                "dob": raw_dob,
                "contact": sanitize_contact_digits(raw_contact),
                "policy_number": _match(r"(?:Insurance|Policy|Falicy|Palicy|Polrcy)[^:\n]*Number\s*[:\-]?\s*([^\n\r]+)"),
                "complaint": raw_complaint.rstrip("’'\""),
            }

        # Normalize date format & ensure contact contains only digits
        dob_val = str(parsed_json.get("dob", "")).strip()
        if re.match(r"^\d{2}/\d{2}/\d{4}$", dob_val):
            d, m, y = dob_val.split("/")
            parsed_json["dob"] = f"{y}-{m}-{d}"

        parsed_json["contact"] = sanitize_contact_digits(parsed_json.get("contact", ""))

        # Identify any empty required fields for frontend validation feedback
        required_fields = ["full_name", "dob", "contact", "policy_number", "complaint"]
        missing_fields = [f for f in required_fields if not str(parsed_json.get(f, "")).strip()]
        parsed_json["missing_fields"] = missing_fields

        # Cache successful extractions (where all fields were found) to save Free Tier tokens during repeated testing
        if not missing_fields:
            store = _load_local_store()
            store.setdefault("extraction_cache", {})[file_hash] = parsed_json
            _save_local_store(store)

        return jsonify(parsed_json)
    except Exception as e:
        print(f"Error in /extract: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/register", methods=["POST"])
def register():
    try:
        data = request.get_json() or {}
        now_iso = datetime.now().astimezone().isoformat()
        created_at = str(data.get("created_at") or data.get("visit_time") or now_iso).strip()

        patient_record = {
            "full_name": str(data.get("full_name", "")).strip(),
            "dob": str(data.get("dob", "")).strip(),
            "contact": re.sub(r"\D", "", str(data.get("contact", ""))),
            "policy_number": str(data.get("policy_number", "")).strip(),
            "complaint": str(data.get("complaint", "")).strip(),
            "status": "Registered",
            "created_at": created_at,
        }

        # Server-side validation for empty fields and numeric contact
        missing = [k for k in ("full_name", "dob", "contact", "policy_number", "complaint") if not patient_record[k]]
        if missing:
            return jsonify({"error": f"Missing required fields: {', '.join(missing)}"}), 400

        saved_rows = []
        if supabase:
            try:
                response = supabase.table("patients").insert({
                    **patient_record,
                    "visit_time": created_at,
                }).execute()
                saved_rows = response.data or []
            except Exception as supa_err:
                try:
                    response = supabase.table("patients").insert(patient_record).execute()
                    saved_rows = response.data or []
                except Exception as inner_err:
                    print(f"Supabase /register notice (saved locally): {supa_err} / {inner_err}")

        db_created_at = saved_rows[0].get("created_at") if saved_rows and saved_rows[0].get("created_at") else created_at

        store = _load_local_store()
        local_patient = {
            **patient_record,
            "created_at": db_created_at,
            "visit_time": db_created_at,
            "consultation_time": "",
            "diagnosis": "",
            "prescription": [],
            "medical_docs": [],
        }
        store["patients"].append(local_patient)
        _save_local_store(store)

        if saved_rows:
            saved_rows[0]["created_at"] = db_created_at
            saved_rows[0]["visit_time"] = saved_rows[0].get("visit_time") or db_created_at
            saved_rows[0]["consultation_time"] = saved_rows[0].get("consultation_time") or ""

        return jsonify(saved_rows if saved_rows else [local_patient])
    except Exception as e:
        print(f"Error in /register: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/patients", methods=["GET"])
def get_patients():
    store = _load_local_store()
    local_patients = store.get("patients", [])
    local_by_key = {
        (p.get("full_name"), p.get("created_at")): p
        for p in local_patients
        if p.get("full_name") and p.get("created_at")
    }
    local_by_id = {
        p.get("id"): p
        for p in local_patients
        if p.get("id") is not None
    }

    if supabase:
        try:
            response = supabase.table("patients").select("*").order("created_at", desc=True).execute()
            supa_patients = response.data or []
            merged = []
            for sp in supa_patients:
                name = sp.get("full_name")
                c_at = sp.get("created_at") or sp.get("visit_time") or ""
                lp = (
                    local_by_key.get((name, c_at))
                    or (local_by_id.get(sp.get("id")) if sp.get("id") is not None else None)
                    or {}
                )
                raw_rx = sp.get("prescription") or lp.get("prescription") or []
                normalized_rx = []
                if isinstance(raw_rx, list):
                    for item in raw_rx:
                        if isinstance(item, str):
                            try:
                                normalized_rx.append(json.loads(item))
                            except Exception:
                                normalized_rx.append({"medicine": item})
                        elif isinstance(item, dict):
                            normalized_rx.append(item)
                elif isinstance(raw_rx, str):
                    try:
                        parsed = json.loads(raw_rx)
                        if isinstance(parsed, list):
                            normalized_rx = parsed
                    except Exception:
                        pass

                merged.append({
                    **lp,
                    **sp,
                    "created_at": c_at,
                    "diagnosis": sp.get("diagnosis") or lp.get("diagnosis") or "",
                    "prescription": normalized_rx,
                    "medical_docs": sp.get("medical_docs") or lp.get("medical_docs") or [],
                    "status": sp.get("status") or lp.get("status") or "Registered",
                    "visit_time": sp.get("visit_time") or c_at or lp.get("visit_time") or "",
                    "consultation_time": sp.get("consulted_at") or sp.get("consultation_time") or lp.get("consultation_time") or "",
                    "consulted_at": sp.get("consulted_at") or sp.get("consultation_time") or lp.get("consultation_time") or "",
                })
            # Keep local cache synchronized with Supabase rows so duplicates never accumulate
            store["patients"] = merged
            _save_local_store(store)
            return jsonify(merged)
        except Exception as e:
            print(f"Supabase /patients notice (using local store): {e}")

    return jsonify([
        {
            **lp,
            "visit_time": lp.get("visit_time") or lp.get("created_at") or "",
            "consultation_time": lp.get("consultation_time") or "",
        }
        for lp in local_patients
    ])


@app.route("/consultation", methods=["POST"])
def consultation():
    try:
        data = request.get_json() or {}
        patient_name = data.get("name", "")
        created_at = data.get("created_at", "")
        diagnosis = data.get("diagnosis", "")
        raw_prescriptions = data.get("prescription", [])
        status = data.get("status", "Consulted")
        consultation_time = (
            str(data.get("consultation_time") or datetime.now().astimezone().isoformat()).strip()
            if status == "Consulted"
            else ""
        )

        # Editable patient details from the doctor interface
        dob = str(data.get("dob") or "").strip()
        contact = re.sub(r"\D", "", str(data.get("contact") or ""))
        policy_number = str(data.get("policy_number") or "").strip()
        new_complaint = str(data.get("complaint") or "").strip()

        store = _load_local_store()
        complaint = new_complaint
        target_patient = None
        for p in reversed(store.get("patients", [])):
            if p.get("full_name") == patient_name and (not created_at or p.get("created_at") == created_at):
                target_patient = p
                if not complaint:
                    complaint = p.get("complaint", "")
                break

        if not target_patient:
            for p in reversed(store.get("patients", [])):
                if p.get("full_name") == patient_name:
                    target_patient = p
                    if not complaint:
                        complaint = p.get("complaint", "")
                    break

        # Use doctor's prescriptions directly without AI enrichment
        clean_prescriptions = []
        for idx, p in enumerate(raw_prescriptions):
            clean_prescriptions.append({
                "id": p.get("id") or (idx + 1),
                "medicine": (p.get("medicine") or "").strip(),
                "dosage": (p.get("dosage") or "").strip(),
                "frequency": (p.get("frequency") or "").strip(),
                "purpose": (p.get("purpose") or "").strip(),
                "instructions": (p.get("instructions") or "").strip(),
                "unit_price": float(p.get("unit_price") or (15.0 + idx * 7.5)),
            })

        if target_patient:
            target_patient["diagnosis"] = diagnosis
            target_patient["prescription"] = clean_prescriptions
            target_patient["status"] = status
            if dob:
                target_patient["dob"] = dob
            if contact:
                target_patient["contact"] = contact
            if policy_number:
                target_patient["policy_number"] = policy_number
            if new_complaint:
                target_patient["complaint"] = new_complaint
            if consultation_time:
                target_patient["consultation_time"] = consultation_time
            updated_patient = target_patient
        else:
            now_iso = created_at or datetime.now().astimezone().isoformat()
            updated_patient = {
                "full_name": patient_name,
                "created_at": now_iso,
                "visit_time": now_iso,
                "dob": dob,
                "contact": contact,
                "policy_number": policy_number,
                "complaint": new_complaint or complaint,
                "diagnosis": diagnosis,
                "prescription": clean_prescriptions,
                "status": status,
                "consultation_time": consultation_time,
                "medical_docs": [],
            }
            store["patients"].append(updated_patient)

        _save_local_store(store)

        supa_data = None
        if supabase:
            update_payload = {
                "prescription": clean_prescriptions,
                "diagnosis": diagnosis,
                "status": status,
            }
            if dob:
                update_payload["dob"] = dob
            if contact:
                update_payload["contact"] = contact
            if policy_number:
                update_payload["policy_number"] = policy_number
            if new_complaint:
                update_payload["complaint"] = new_complaint
            for col_name in ("consulted_at", "consultation_time", None):
                try:
                    payload = (
                        {**update_payload, col_name: consultation_time}
                        if (col_name and consultation_time)
                        else update_payload
                    )
                    q = supabase.table("patients").update(payload).eq("full_name", patient_name)
                    if created_at:
                        q = q.eq("created_at", created_at)
                    response = q.execute()
                    supa_data = response.data
                    break
                except Exception as supa_err:
                    if col_name is None:
                        print(f"Supabase /consultation update notice: {supa_err}")

        return jsonify({
            "patient": updated_patient,
            "supabase": supa_data,
            "prescription": clean_prescriptions,
            "consultation_time": consultation_time,
        })
    except Exception as e:
        print(f"Error in /consultation: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/medical-docs", methods=["GET"])
def get_medical_docs():
    """Return uploaded clinical reference documents fetched directly from Supabase with runtime fallback."""
    docs = []
    seen_doc_ids = set()

    # 1. Primary Source: Fetch distinct documents from Supabase medical_documents table
    if supabase and _SUPABASE_TABLES_STATUS.get("medical_documents", True):
        try:
            res = (
                supabase.table("medical_documents")
                .select("document_id, filename, document_url, created_at, chunk_index")
                .order("created_at", desc=True)
                .execute()
            )
            rows = res.data or []
            doc_chunk_counts = {}
            doc_first_row = {}
            for r in rows:
                doc_key = r.get("document_id") or r.get("filename")
                if not doc_key:
                    continue
                doc_chunk_counts[doc_key] = doc_chunk_counts.get(doc_key, 0) + 1
                if doc_key not in doc_first_row:
                    doc_first_row[doc_key] = r

            for doc_key, r in doc_first_row.items():
                docs.append({
                    "id": r.get("document_id") or doc_key,
                    "document_id": r.get("document_id") or doc_key,
                    "filename": r.get("filename", "Medical Document"),
                    "document_url": r.get("document_url") or "",
                    "chunks_indexed": doc_chunk_counts.get(doc_key, 1),
                    "uploaded_at": r.get("created_at") or "",
                })
                seen_doc_ids.add(r.get("document_id") or doc_key)
                seen_doc_ids.add(r.get("filename"))
        except Exception as e:
            print(f"Supabase /medical-docs fetch notice (using runtime store): {e}")

    # 2. Also check runtime store in case documents were added during this session
    store = _load_local_store()
    for d in store.get("reference_documents", []):
        d_id = d.get("document_id") or d.get("id") or d.get("filename")
        if d_id not in seen_doc_ids and d.get("filename") not in seen_doc_ids:
            docs.append(d)
            seen_doc_ids.add(d_id)

    docs.sort(key=lambda x: x.get("uploaded_at", ""), reverse=True)
    return jsonify(docs)


@app.route("/medical-docs/<path:doc_identifier>", methods=["DELETE"])
def delete_medical_doc(doc_identifier):
    """Delete all chunks for a reference document from Supabase and runtime storage."""
    try:
        deleted_count = 0
        doc_url_to_delete = None

        if supabase and _SUPABASE_TABLES_STATUS.get("medical_documents", True):
            try:
                # 1. Fetch document_url to clean up Supabase storage file if present
                res = (
                    supabase.table("medical_documents")
                    .select("document_id, filename, document_url")
                    .or_(f"document_id.eq.{doc_identifier},filename.eq.{doc_identifier}")
                    .limit(1)
                    .execute()
                )
                if res.data:
                    doc_url_to_delete = res.data[0].get("document_url")

                # 2. Delete all chunk rows matching document_id or filename
                del_res = (
                    supabase.table("medical_documents")
                    .delete()
                    .or_(f"document_id.eq.{doc_identifier},filename.eq.{doc_identifier}")
                    .execute()
                )
                deleted_count = len(del_res.data or [])

                # 3. Clean up storage file if it exists
                if doc_url_to_delete and "documents/" in doc_url_to_delete:
                    storage_path = doc_url_to_delete.split("documents/")[-1]
                    try:
                        supabase.storage.from_("documents").remove([storage_path])
                    except Exception:
                        pass
            except Exception as supa_err:
                print(f"Supabase delete notice: {supa_err}")

        # Remove from runtime in-memory store
        store = _load_local_store()
        store["medical_documents"] = [
            d for d in store.get("medical_documents", [])
            if d.get("document_id") != doc_identifier and d.get("filename") != doc_identifier
        ]
        store["reference_documents"] = [
            d for d in store.get("reference_documents", [])
            if d.get("document_id") != doc_identifier and d.get("id") != doc_identifier and d.get("filename") != doc_identifier
        ]
        _save_local_store(store)

        return jsonify({
            "message": f"Document '{doc_identifier}' deleted successfully",
            "chunks_removed": deleted_count,
        })
    except Exception as e:
        print(f"Error in DELETE /medical-docs: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/upload-medical-doc", methods=["POST"])
def upload_medical_doc():
    """Upload clinic-wide clinical reference documents / medication guides / protocols."""
    try:
        file = request.files.get("file")
        if not file:
            return jsonify({"error": "No file provided"}), 400

        filename = file.filename or "medical_document.pdf"
        file.seek(0)
        file_content = file.read()
        content_type = file.content_type or "application/octet-stream"

        document_url = upload_to_storage(file_content, filename, content_type)
        extracted_text, _ = extract_text_from_bytes(file_content, filename, content_type)

        if not extracted_text:
            extracted_text = f"Uploaded medical reference document: {filename}."

        doc_id = str(uuid.uuid4())
        chunks_indexed = index_document_for_rag(
            filename=filename,
            document_url=document_url,
            raw_text=extracted_text,
            document_id=doc_id,
        )

        store = _load_local_store()
        doc_meta = {
            "id": doc_id,
            "document_id": doc_id,
            "filename": filename,
            "document_url": document_url,
            "chunks_indexed": chunks_indexed,
            "uploaded_at": datetime.now().astimezone().isoformat(),
        }
        store.setdefault("reference_documents", []).insert(0, doc_meta)
        _save_local_store(store)

        return jsonify({
            "message": "Document uploaded and indexed clinic-wide",
            "document": doc_meta,
            "preview": extracted_text[:300],
        })
    except Exception as e:
        print(f"Error in /upload-medical-doc: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/chat", methods=["POST"])
def chat():
    """RAG-based post-consultation patient chatbot with analytics logging."""
    start_time = time.time()
    try:
        data = request.get_json() or {}
        patient_name = data.get("patient_name", "")
        question = (data.get("question") or "").strip()
        history = data.get("history", [])

        if not question:
            return jsonify({"error": "Question is required"}), 400

        store = _load_local_store()
        patient_record = None
        for p in store.get("patients", []):
            if p.get("full_name") == patient_name:
                patient_record = p
                break

        if not patient_record and supabase and patient_name:
            try:
                res = supabase.table("patients").select("*").eq("full_name", patient_name).execute()
                if res.data:
                    patient_record = res.data[0]
            except Exception:
                pass

        retrieved_chunks = retrieve_rag_context(question, patient_name=patient_name, top_k=4)
        sources_used = list({c["filename"] for c in retrieved_chunks if c.get("filename")})

        patient_context_str = "No specific patient record selected."
        if patient_record:
            patient_context_str = (
                f"Patient Name: {patient_record.get('full_name')}\n"
                f"Primary Complaint: {patient_record.get('complaint', 'N/A')}\n"
                f"Doctor's Diagnosis: {patient_record.get('diagnosis', 'Pending consultation')}\n"
                f"Prescriptions: {json.dumps(patient_record.get('prescription', []), indent=2)}"
            )
            if not sources_used and (patient_record.get("diagnosis") or patient_record.get("prescription")):
                sources_used.append("Clinical_Consultation_Record")

        rag_passages_str = "\n\n".join(
            f"[Source: {c['filename']} | Relevance: {c['similarity']}]\n{c['content']}"
            for c in retrieved_chunks
        ) or "No additional uploaded documents found."

        history_str = "\n".join(
            f"{msg.get('role', 'user').upper()}: {msg.get('text', '')}"
            for msg in history[-6:]
        )

        system_prompt = f"""You are PulseAI Medical Assistant, a professional, clear, and helpful clinic care assistant.

TONE & STYLE:
- Be polite, natural, and concise. Avoid being overly emotional, dramatic, or overcaring.
- Speak normally and clearly, like a helpful clinic nurse or pharmacist.
- If the patient says "hi" or "hello", greet them simply and let them know you can help answer questions about their consultation, diagnosis, or prescribed medicines.

SCOPE & ACCURACY:
1. Base all medical answers strictly on the PATIENT CONSULTATION RECORD and RETRIEVED RAG MEDICAL DOCUMENT PASSAGES below.
2. If the patient asks about an unprescribed medicine or a condition not in their record or reference docs, state simply and clearly that it isn't in their clinic records and recommend speaking with their doctor.
3. If the question is completely non-medical (e.g. coding, math, trivia, general chat), politely state that you can only assist with their clinic consultation and medications.

=== PATIENT CONSULTATION RECORD ===
{patient_context_str}

=== RETRIEVED RAG MEDICAL DOCUMENT PASSAGES ===
{rag_passages_str}

=== RECENT CONVERSATION HISTORY ===
{history_str}

=== PATIENT QUESTION ===
{question}

Return a JSON object with:
- "answer": Your direct, helpful response in clear English (markdown bolding for instructions).
- "topic": One category from ["General Care", "Diagnosis Clarification", "Medication Purpose", "Dosage & Schedule", "Side Effects & Safety", "Insurance & Quotation", "Off-Topic / Out of Scope"].
"""

        answer_text = ""
        topic = "General Care"
        try:
            res = generate_gemini_content(
                contents=system_prompt,
                config={"response_mime_type": "application/json"},
            )
            parsed = json.loads(res.text)
            answer_text = parsed.get("answer", "")
            topic = parsed.get("topic", "General Care")
        except Exception as gemini_err:
            print(f"Gemini chat error: {gemini_err}")
            answer_text = "I am currently unable to generate a response. Please consult your physician directly regarding your medication and treatment."
            topic = "General Care"

        elapsed_ms = int((time.time() - start_time) * 1000)

        return jsonify({
            "answer": answer_text,
            "topic": topic,
            "sources": sources_used,
            "retrieved_chunks": retrieved_chunks,
            "response_time_ms": elapsed_ms,
        })
    except Exception as e:
        print(f"Error in /chat: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/analytics", methods=["GET"])
def get_analytics():
    """Return Chatbot usage analytics & metrics fetched directly from Supabase chat_logs table."""
    logs = []
    if supabase:
        try:
            res = supabase.table("chat_logs").select("*").order("created_at", desc=True).limit(200).execute()
            logs = res.data or []
        except Exception as e:
            print(f"Supabase /analytics fetch error: {e}")

    total_queries = len(logs)
    unique_patients = len({l.get("patient_name") for l in logs if l.get("patient_name")})
    avg_latency = (
        int(sum(int(l.get("response_time_ms") or 0) for l in logs) / total_queries)
        if total_queries > 0
        else 0
    )
    rag_grounded_count = sum(1 for l in logs if l.get("sources") and len(l.get("sources")) > 0)
    rag_hit_rate = round((rag_grounded_count / total_queries) * 100, 1) if total_queries > 0 else 100.0

    topic_counts = {}
    for l in logs:
        t = l.get("topic") or "General Care"
        topic_counts[t] = topic_counts.get(t, 0) + 1

    total_docs_indexed = len(store.get("medical_documents", []))

    return jsonify({
        "summary": {
            "total_queries": total_queries,
            "unique_patients": unique_patients,
            "avg_response_time_ms": avg_latency,
            "rag_hit_rate_percent": rag_hit_rate,
            "total_rag_chunks": total_docs_indexed,
        },
        "topics": [
            {"topic": k, "count": v}
            for k, v in sorted(topic_counts.items(), key=lambda item: item[1], reverse=True)
        ],
        "recent_logs": logs[:25],
    })


def _escape_pdf(s: str) -> str:
    clean = str(s or "").encode("latin-1", errors="replace").decode("latin-1")
    return clean.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


@app.route("/quotation-pdf", methods=["POST"])
def generate_quotation_pdf():
    """Generate a downloadable PDF quotation for a consulted patient."""
    try:
        data = request.get_json() or {}
        patient_name = data.get("full_name") or data.get("name") or "Patient"
        dob = data.get("dob") or "N/A"
        contact = data.get("contact") or "N/A"
        policy_number = data.get("policy_number") or "N/A"
        diagnosis = data.get("diagnosis") or "General Consultation"
        prescriptions = data.get("prescription") or []

        consultation_fee = 65.00
        line_items = [
            ("Specialist Clinical Consultation & Assessment", "1 Visit", consultation_fee)
        ]
        for p in prescriptions:
            med_name = p.get("medicine") or "Prescribed Medication"
            dosage_freq = f"{p.get('dosage', '')} ({p.get('frequency', '')})".strip(" ()")
            price = float(p.get("unit_price") or 18.50)
            line_items.append((f"{med_name} - {dosage_freq}", "1 Course", price))

        subtotal = sum(item[2] for item in line_items)
        gst = round(subtotal * 0.09, 2)
        gross_total = round(subtotal + gst, 2)
        insurance_subsidy = round(gross_total * 0.70, 2) if policy_number and policy_number != "N/A" else 0.0
        net_payable = round(gross_total - insurance_subsidy, 2)

        quote_ref = f"QT-{datetime.now().strftime('%Y%m%d')}-{abs(hash(patient_name)) % 9000 + 1000}"
        date_str = datetime.now().strftime("%Y-%m-%d %H:%M")

        cmds = [
            "0.145 0.388 0.922 rg",
            "0 715 612 77 re f",
            "1 1 1 RG 1 1 1 rg",
            "BT /F2 20 Tf 50 752 Td (PulseAI Medical Center) Tj ET",
            "BT /F1 11 Tf 50 732 Td (Official Post-Consultation Quotation & Medication Summary) Tj ET",
            f"BT /F2 11 Tf 420 752 Td (Ref: {_escape_pdf(quote_ref)}) Tj ET",
            f"BT /F1 10 Tf 420 732 Td (Date: {_escape_pdf(date_str)}) Tj ET",
            "0.06 0.09 0.16 rg",
            "BT /F2 12 Tf 50 680 Td (PATIENT & INSURANCE DETAILS) Tj ET",
            "0.88 0.91 0.94 RG 1 w 50 672 m 562 672 l S",
            f"BT /F2 10 Tf 50 654 Td (Patient Name:) Tj /F1 10 Tf 135 654 Td ({_escape_pdf(patient_name)}) Tj ET",
            f"BT /F2 10 Tf 320 654 Td (Date of Birth:) Tj /F1 10 Tf 405 654 Td ({_escape_pdf(dob)}) Tj ET",
            f"BT /F2 10 Tf 50 636 Td (Contact:) Tj /F1 10 Tf 135 636 Td ({_escape_pdf(contact)}) Tj ET",
            f"BT /F2 10 Tf 320 636 Td (Policy Number:) Tj /F1 10 Tf 405 636 Td ({_escape_pdf(policy_number)}) Tj ET",
            f"BT /F2 10 Tf 50 612 Td (Diagnosis:) Tj /F1 10 Tf 135 612 Td ({_escape_pdf(diagnosis[:75])}) Tj ET",
            "0.95 0.96 0.98 rg 50 565 512 24 re f",
            "0.06 0.09 0.16 rg",
            "BT /F2 10 Tf 60 573 Td (DESCRIPTION / MEDICATION) Tj ET",
            "BT /F2 10 Tf 370 573 Td (QTY / COURSE) Tj ET",
            "BT /F2 10 Tf 485 573 Td (AMOUNT (USD)) Tj ET",
        ]

        y = 542
        for desc, qty, amt in line_items:
            cmds.extend([
                f"BT /F1 10 Tf 60 {y} Td ({_escape_pdf(desc[:55])}) Tj ET",
                f"BT /F1 10 Tf 370 {y} Td ({_escape_pdf(qty)}) Tj ET",
                f"BT /F2 10 Tf 495 {y} Td (${amt:0.2f}) Tj ET",
                f"0.91 0.93 0.96 RG 0.5 w 50 {y - 8} m 562 {y - 8} l S",
            ])
            y -= 26

        if prescriptions:
            y -= 10
            cmds.append(f"BT /F2 11 Tf 50 {y} Td (MEDICATION GUIDE (WHAT EACH MEDICINE TARGETS)) Tj ET")
            y -= 18
            for p in prescriptions[:6]:
                med = p.get("medicine", "Medicine")
                purpose = p.get("purpose", "Symptomatic relief")
                cmds.append(
                    f"BT /F2 9 Tf 60 {y} Td ({_escape_pdf(med)}: ) Tj /F1 9 Tf ({_escape_pdf(purpose[:80])}) Tj ET"
                )
                y -= 15

        y = min(y - 15, 250)
        cmds.extend([
            f"0.82 0.85 0.90 RG 1 w 340 {y + 18} m 562 {y + 18} l S",
            f"BT /F1 10 Tf 350 {y} Td (Subtotal:) Tj /F1 10 Tf 495 {y} Td (${subtotal:0.2f}) Tj ET",
            f"BT /F1 10 Tf 350 {y - 18} Td (GST (9%):) Tj /F1 10 Tf 495 {y - 18} Td (${gst:0.2f}) Tj ET",
            f"BT /F1 10 Tf 350 {y - 36} Td (Gross Total:) Tj /F2 10 Tf 495 {y - 36} Td (${gross_total:0.2f}) Tj ET",
            f"0.02 0.59 0.41 rg BT /F1 10 Tf 350 {y - 54} Td (Insurance Coverage (70%):) Tj /F2 10 Tf 490 {y - 54} Td (-${insurance_subsidy:0.2f}) Tj ET",
            f"0.06 0.09 0.16 rg BT /F2 12 Tf 350 {y - 78} Td (Net Payable:) Tj /F2 12 Tf 490 {y - 78} Td (${net_payable:0.2f}) Tj ET",
            "0.40 0.45 0.55 rg BT /F1 9 Tf 50 60 Td (Generated by PulseAI Clinical Platform. For billing or medical inquiries, use the Patient Portal Chatbot.) Tj ET",
        ])

        content_stream = "\n".join(cmds).encode("latin-1")
        objects = [
            b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
            b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
            b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n",
            b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
            b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n",
            f"6 0 obj\n<< /Length {len(content_stream)} >>\nstream\n".encode("latin-1") + content_stream + b"\nendstream\nendobj\n",
        ]

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = []
        for obj in objects:
            offsets.append(len(out))
            out.extend(obj)
        xref_pos = len(out)
        out.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("latin-1"))
        for off in offsets:
            out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
        out.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1"))

        safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", patient_name)
        return send_file(
            io.BytesIO(bytes(out)),
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"PulseAI_Quotation_{safe_name}.pdf",
        )
    except Exception as e:
        print(f"Error generating quotation PDF: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_upload(filename):
    """Serve locally stored uploads (e.g. PDFs and images) for preview in the frontend."""
    from flask import send_from_directory
    return send_from_directory(LOCAL_UPLOADS_DIR, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(debug=True, port=port)
