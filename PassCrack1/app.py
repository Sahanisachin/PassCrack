#!/usr/bin/env python3
"""
PassCrack Web UI
A modern web interface for dictionary-based password cracking
"""

from flask import Flask, render_template, request, jsonify, session
from flask_cors import CORS
import os
import sys
import io
import time
import hashlib
import threading
import uuid
import json
from pathlib import Path
from werkzeug.utils import secure_filename
import traceback

# ------------------ Configuration ------------------
app = Flask(__name__)
app.secret_key = os.urandom(24)
CORS(app)

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'pdf', 'zip', '7z', 'rar', 'txt', 'csv'}

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024  # 500MB max

# Global dictionary to store crack jobs
crack_jobs = {}

# ------------------ Package Import Map ------------------
PKG_IMPORT_MAP = {
    "msoffcrypto-tool": "msoffcrypto",
    "pikepdf": "pikepdf",
    "pyzipper": "pyzipper",
    "py7zr": "py7zr",
    "rarfile": "rarfile",
    "python-docx": "docx",
    "python-pptx": "pptx",
    "pandas": "pandas",
    "openpyxl": "openpyxl",
}

# ------------------ Utility Functions ------------------
def sha256_of_path(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def sha256_of_bytes(b):
    return hashlib.sha256(b).hexdigest()

def load_optional_modules():
    mods = {}
    for pkg, modname in PKG_IMPORT_MAP.items():
        try:
            mods[modname] = __import__(modname)
        except Exception:
            mods[modname] = None
    return mods

# ------------------ Wordlist Loaders ------------------
def load_txt(path):
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return [line.rstrip("\n").strip() for line in f if line.strip()]

def load_csv(path, pandas_mod):
    try:
        df = pandas_mod.read_csv(path, header=None, dtype=str, keep_default_na=False)
        vals = df.values.flatten().tolist()
        return [str(v).strip() for v in vals if str(v).strip()]
    except:
        return []

def load_excel(path, pandas_mod):
    try:
        df = pandas_mod.read_excel(path, header=None, dtype=str, keep_default_na=False)
        vals = df.values.flatten().tolist()
        return [str(v).strip() for v in vals if str(v).strip()]
    except:
        return []

def load_docx(path, docx_mod):
    try:
        doc = docx_mod.Document(path)
        lines = []
        for p in doc.paragraphs:
            if p.text and p.text.strip():
                lines.append(p.text.strip())
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text and cell.text.strip():
                        lines.append(cell.text.strip())
        return lines
    except:
        return []

def load_pptx(path, pptx_mod):
    try:
        prs = pptx_mod.Presentation(path)
        lines = []
        for slide in prs.slides:
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text and shape.text.strip():
                    lines.append(shape.text.strip())
        return lines
    except:
        return []

def load_password_candidates(path, modules):
    ext = Path(path).suffix.lower()
    try:
        if ext in ("", ".txt"):
            return load_txt(path)
        if ext == ".csv":
            if modules.get("pandas"):
                return load_csv(path, modules["pandas"])
            return load_txt(path)
        if ext in (".xls", ".xlsx", ".xlsm", ".xlsb"):
            if modules.get("pandas"):
                return load_excel(path, modules["pandas"])
            return load_txt(path)
        if ext == ".docx":
            if modules.get("docx"):
                return load_docx(path, modules["docx"])
            return load_txt(path)
        if ext == ".pptx":
            if modules.get("pptx"):
                return load_pptx(path, modules["pptx"])
            return load_txt(path)
        return load_txt(path)
    except:
        return []

# ------------------ Attempt Functions ------------------
import zipfile

def try_office_bytes(target_path, password, modules):
    m = modules.get("msoffcrypto")
    if not m:
        return None
    try:
        with open(target_path, "rb") as f:
            office = m.OfficeFile(f)
            office.load_key(password=password)
            bio = io.BytesIO()
            office.decrypt(bio)
            return bio.getvalue()
    except Exception:
        return None

def try_pdf_bytes(target_path, password, modules):
    pikepdf = modules.get("pikepdf")
    if not pikepdf:
        return None
    try:
        pdf = pikepdf.open(target_path, password=password)
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()
    except Exception:
        return None

def try_zip_bytes(target_path, password, modules):
    pyzipper = modules.get("pyzipper")
    if pyzipper:
        try:
            with pyzipper.AESZipFile(target_path) as z:
                names = z.namelist()
                if not names:
                    return None
                first = names[0]
                data = z.read(first, pwd=password.encode("utf-8", errors="ignore"))
                return data
        except Exception:
            pass
    
    try:
        z = zipfile.ZipFile(target_path)
        names = z.namelist()
        if not names:
            return None
        first = names[0]
        data = z.read(first, pwd=password.encode("utf-8", errors="ignore"))
        return data
    except Exception:
        return None

def try_7z_bytes(target_path, password, modules):
    py7zr = modules.get("py7zr")
    if not py7zr:
        return None
    try:
        with py7zr.SevenZipFile(target_path, mode="r", password=password) as z:
            names = z.getnames()
            if not names:
                return None
            first = names[0]
            out_dict = z.read([first])
            return out_dict.get(first)
    except Exception:
        return None

def try_rar_bytes(target_path, password, modules):
    rarfile_mod = modules.get("rarfile")
    if not rarfile_mod:
        return None
    try:
        rf = rarfile_mod.RarFile(target_path)
        names = rf.namelist()
        if not names:
            return None
        first = names[0]
        data = rf.read(first, pwd=password)
        return data
    except Exception:
        return None

# ------------------ Background Cracker ------------------
def crack_passwords(job_id, target_path, wordlist_path, candidates, modules):
    job = crack_jobs[job_id]
    ext = Path(target_path).suffix.lower()
    
    methods = [("Office", try_office_bytes), ("PDF", try_pdf_bytes),
               ("ZIP", try_zip_bytes), ("7z", try_7z_bytes), ("RAR", try_rar_bytes)]
    
    total = len(candidates)
    job['total'] = total * len(methods)
    job['processed'] = 0
    
    for i, pw in enumerate(candidates):
        if job['status'] == 'stopping':
            job['status'] = 'stopped'
            break
            
        for label, fn in methods:
            if job['status'] == 'stopping':
                break
                
            job['processed'] += 1
            job['current_password'] = pw
            job['current_method'] = label
            job['progress'] = (job['processed'] / job['total']) * 100
            
            try:
                dec = fn(target_path, pw, modules)
            except Exception:
                dec = None
                
            if dec:
                job['status'] = 'completed'
                job['result'] = {
                    'password': pw,
                    'method': label,
                    'hash': sha256_of_bytes(dec)
                }
                return
                
            time.sleep(0.01)  # Small delay to prevent CPU overload
    
    if job['status'] != 'stopped':
        job['status'] = 'failed'
        job['error'] = 'No password matched from the provided candidates'

# ------------------ Flask Routes ------------------
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/check-dependencies', methods=['GET'])
def check_dependencies():
    modules = load_optional_modules()
    installed = {}
    for pkg, modname in PKG_IMPORT_MAP.items():
        installed[pkg] = modules.get(modname) is not None
    return jsonify({
        'installed': installed,
        'all_installed': all(installed.values())
    })

@app.route('/api/install-dependencies', methods=['POST'])
def install_dependencies():
    missing = []
    modules = load_optional_modules()
    for pkg, modname in PKG_IMPORT_MAP.items():
        if not modules.get(modname):
            missing.append(pkg)
    
    if not missing:
        return jsonify({'success': True, 'message': 'All dependencies already installed'})
    
    try:
        import subprocess
        cmd = [sys.executable, "-m", "pip", "install", "--user"] + missing
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            return jsonify({'success': True, 'message': 'Dependencies installed successfully'})
        else:
            return jsonify({'success': False, 'message': result.stderr})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    filename = secure_filename(file.filename)
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({'error': f'File type .{ext} not allowed'}), 400
    
    file_id = str(uuid.uuid4())
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{file_id}_{filename}")
    file.save(file_path)
    
    file_hash = sha256_of_path(file_path)
    
    return jsonify({
        'success': True,
        'file_id': file_id,
        'filename': filename,
        'path': file_path,
        'hash': file_hash,
        'size': os.path.getsize(file_path)
    })

@app.route('/api/start-crack', methods=['POST'])
def start_crack():
    data = request.json
    target_path = data.get('target_path')
    wordlist_path = data.get('wordlist_path')
    
    if not os.path.exists(target_path) or not os.path.exists(wordlist_path):
        return jsonify({'error': 'File not found'}), 400
    
    modules = load_optional_modules()
    
    try:
        candidates = load_password_candidates(wordlist_path, modules)
    except Exception as e:
        return jsonify({'error': f'Failed to load wordlist: {str(e)}'}), 400
    
    if not candidates:
        return jsonify({'error': 'No passwords found in wordlist'}), 400
    
    job_id = str(uuid.uuid4())
    crack_jobs[job_id] = {
        'id': job_id,
        'status': 'running',
        'progress': 0,
        'processed': 0,
        'total': 0,
        'current_password': '',
        'current_method': '',
        'result': None,
        'error': None,
        'target_file': os.path.basename(target_path),
        'wordlist_file': os.path.basename(wordlist_path),
        'candidate_count': len(candidates)
    }
    
    thread = threading.Thread(
        target=crack_passwords,
        args=(job_id, target_path, wordlist_path, candidates, modules)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({'success': True, 'job_id': job_id})

@app.route('/api/job-status/<job_id>', methods=['GET'])
def job_status(job_id):
    job = crack_jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)

@app.route('/api/stop-job/<job_id>', methods=['POST'])
def stop_job(job_id):
    job = crack_jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    
    if job['status'] == 'running':
        job['status'] = 'stopping'
    
    return jsonify({'success': True})

@app.route('/api/cleanup/<job_id>', methods=['POST'])
def cleanup_job(job_id):
    if job_id in crack_jobs:
        del crack_jobs[job_id]
    
    # Clean up uploaded files
    upload_dir = app.config['UPLOAD_FOLDER']
    for filename in os.listdir(upload_dir):
        if job_id in filename:
            try:
                os.remove(os.path.join(upload_dir, filename))
            except:
                pass
    
    return jsonify({'success': True})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)