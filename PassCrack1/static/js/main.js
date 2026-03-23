// State management
let state = {
    targetFile: null,
    wordlistFile: null,
    targetHash: null,
    wordlistCount: 0,
    currentJob: null,
    statusCheckInterval: null
};

// DOM Elements
const elements = {
    dependencyCheck: document.getElementById('dependencyCheck'),
    mainContent: document.getElementById('mainContent'),
    targetUpload: document.getElementById('targetUpload'),
    wordlistUpload: document.getElementById('wordlistUpload'),
    targetFile: document.getElementById('targetFile'),
    wordlistFile: document.getElementById('wordlistFile'),
    targetInfo: document.getElementById('targetInfo'),
    wordlistInfo: document.getElementById('wordlistInfo'),
    targetFilename: document.getElementById('targetFilename'),
    targetSize: document.getElementById('targetSize'),
    targetHash: document.getElementById('targetHash'),
    wordlistFilename: document.getElementById('wordlistFilename'),
    wordlistSize: document.getElementById('wordlistSize'),
    wordlistCount: document.getElementById('wordlistCount'),
    controls: document.getElementById('controls'),
    startCrack: document.getElementById('startCrack'),
    installDeps: document.getElementById('installDeps'),
    progressSection: document.getElementById('progressSection'),
    progressBar: document.getElementById('progressBar'),
    status: document.getElementById('status'),
    currentPassword: document.getElementById('currentPassword'),
    currentMethod: document.getElementById('currentMethod'),
    progressText: document.getElementById('progressText'),
    resultSection: document.getElementById('resultSection'),
    resultSuccess: document.getElementById('resultSuccess'),
    resultFailed: document.getElementById('resultFailed'),
    resultPassword: document.getElementById('resultPassword'),
    resultMethod: document.getElementById('resultMethod'),
    resultHash: document.getElementById('resultHash'),
    errorMessage: document.getElementById('errorMessage'),
    newCrack: document.getElementById('newCrack'),
    stopCrack: document.getElementById('stopCrack'),
    downloadResult: document.getElementById('downloadResult')
};

// Toast notification system
const Toast = {
    show(message, type = 'info', duration = 5000) {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'exclamation-circle';
        if (type === 'warning') icon = 'exclamation-triangle';
        
        toast.innerHTML = `
            <i class="fas fa-${icon}"></i>
            <span class="toast-message">${message}</span>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, duration);
    },
    
    success(message) {
        this.show(message, 'success');
    },
    
    error(message) {
        this.show(message, 'error');
    },
    
    warning(message) {
        this.show(message, 'warning');
    },
    
    info(message) {
        this.show(message, 'info');
    }
};

// File upload handling
function setupFileUploads() {
    // Target file upload
    elements.targetUpload.addEventListener('click', () => {
        elements.targetFile.click();
    });
    
    elements.targetFile.addEventListener('change', (e) => {
        handleFileSelect(e.target.files[0], 'target');
    });
    
    // Wordlist file upload
    elements.wordlistUpload.addEventListener('click', () => {
        elements.wordlistFile.click();
    });
    
    elements.wordlistFile.addEventListener('change', (e) => {
        handleFileSelect(e.target.files[0], 'wordlist');
    });
    
    // Drag and drop
    [elements.targetUpload, elements.wordlistUpload].forEach(uploadArea => {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            
            const file = e.dataTransfer.files[0];
            const type = uploadArea.id === 'targetUpload' ? 'target' : 'wordlist';
            handleFileSelect(file, type);
        });
    });
}

async function handleFileSelect(file, type) {
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        Toast.info(`Uploading ${file.name}...`);
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (type === 'target') {
                state.targetFile = data;
                updateTargetFileInfo(data);
                Toast.success('Protected file uploaded successfully');
            } else {
                state.wordlistFile = data;
                updateWordlistFileInfo(data);
                Toast.success('Wordlist uploaded successfully');
                
                // Get password count
                await loadWordlistPreview(data.path);
            }
            
            checkReadyToStart();
        } else {
            Toast.error(data.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Upload error:', error);
        Toast.error('Failed to upload file');
    }
}

function updateTargetFileInfo(data) {
    elements.targetFilename.textContent = data.filename;
    elements.targetSize.textContent = formatFileSize(data.size);
    elements.targetHash.textContent = data.hash;
    elements.targetInfo.style.display = 'block';
}

function updateWordlistFileInfo(data) {
    elements.wordlistFilename.textContent = data.filename;
    elements.wordlistSize.textContent = formatFileSize(data.size);
    elements.wordlistInfo.style.display = 'block';
}

async function loadWordlistPreview(filePath) {
    // This would be a separate API call to get wordlist preview
    // For now, we'll just show a placeholder
    elements.wordlistCount.textContent = 'Loading password count...';
    
    // Simulate loading
    setTimeout(() => {
        elements.wordlistCount.textContent = '10,000+ passwords loaded';
    }, 1000);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function checkReadyToStart() {
    if (state.targetFile && state.wordlistFile) {
        elements.controls.style.display = 'flex';
        elements.startCrack.disabled = false;
    }
}

// Dependency checking
async function checkDependencies() {
    try {
        const response = await fetch('/api/check-dependencies');
        const data = await response.json();
        
        const depCheck = document.getElementById('dependencyCheck');
        
        if (data.all_installed) {
            depCheck.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem; color: var(--success-color);">
                    <i class="fas fa-check-circle" style="font-size: 1.5rem;"></i>
                    <span>All dependencies are installed and ready!</span>
                </div>
            `;
            elements.mainContent.style.display = 'block';
        } else {
            const missingDeps = Object.entries(data.installed)
                .filter(([_, installed]) => !installed)
                .map(([pkg]) => pkg);
            
            depCheck.innerHTML = `
                <div style="margin-bottom: 1rem; color: var(--warning-color);">
                    <i class="fas fa-exclamation-triangle"></i>
                    Some dependencies are missing
                </div>
                <div class="dep-list">
                    ${missingDeps.map(pkg => `
                        <div class="dep-item missing">
                            <i class="fas fa-times-circle"></i>
                            ${pkg}
                        </div>
                    `).join('')}
                </div>
            `;
            
            elements.installDeps.style.display = 'inline-flex';
            elements.mainContent.style.display = 'block';
        }
    } catch (error) {
        console.error('Dependency check failed:', error);
        elements.dependencyCheck.innerHTML = `
            <div style="color: var(--danger-color);">
                <i class="fas fa-exclamation-circle"></i>
                Failed to check dependencies
            </div>
        `;
    }
}

// Install dependencies
elements.installDeps.addEventListener('click', async () => {
    elements.installDeps.disabled = true;
    elements.installDeps.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Installing...';
    
    try {
        const response = await fetch('/api/install-dependencies', {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            Toast.success('Dependencies installed successfully');
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            Toast.error('Installation failed: ' + data.message);
            elements.installDeps.disabled = false;
            elements.installDeps.innerHTML = '<i class="fas fa-download"></i> Install Dependencies';
        }
    } catch (error) {
        Toast.error('Failed to install dependencies');
        elements.installDeps.disabled = false;
        elements.installDeps.innerHTML = '<i class="fas fa-download"></i> Install Dependencies';
    }
});

// Start cracking
elements.startCrack.addEventListener('click', async () => {
    if (!state.targetFile || !state.wordlistFile) {
        Toast.warning('Please upload both files first');
        return;
    }
    
    elements.startCrack.disabled = true;
    elements.startCrack.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Starting...';
    
    try {
        const response = await fetch('/api/start-crack', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                target_path: state.targetFile.path,
                wordlist_path: state.wordlistFile.path
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            state.currentJob = data.job_id;
            showProgress();
            startStatusCheck();
            Toast.info('Cracking started...');
        } else {
            Toast.error(data.error || 'Failed to start cracking');
            elements.startCrack.disabled = false;
            elements.startCrack.innerHTML = '<i class="fas fa-play"></i> Start Cracking';
        }
    } catch (error) {
        console.error('Start crack error:', error);
        Toast.error('Failed to start cracking');
        elements.startCrack.disabled = false;
        elements.startCrack.innerHTML = '<i class="fas fa-play"></i> Start Cracking';
    }
});

function showProgress() {
    elements.controls.style.display = 'none';
    elements.progressSection.style.display = 'block';
    elements.resultSection.style.display = 'none';
}

function startStatusCheck() {
    if (state.statusCheckInterval) {
        clearInterval(state.statusCheckInterval);
    }
    
    state.statusCheckInterval = setInterval(checkJobStatus, 1000);
}

async function checkJobStatus() {
    if (!state.currentJob) return;
    
    try {
        const response = await fetch(`/api/job-status/${state.currentJob}`);
        const job = await response.json();
        
        if (response.status === 404) {
            clearInterval(state.statusCheckInterval);
            return;
        }
        
        updateProgress(job);
        
        if (job.status === 'completed') {
            clearInterval(state.statusCheckInterval);
            showResult(job.result);
        } else if (job.status === 'failed' || job.status === 'stopped') {
            clearInterval(state.statusCheckInterval);
            showError(job.error || 'Cracking failed');
        }
    } catch (error) {
        console.error('Status check error:', error);
    }
}

function updateProgress(job) {
    elements.progressBar.style.width = `${job.progress}%`;
    elements.status.textContent = job.status;
    elements.currentPassword.textContent = job.current_password || '-';
    elements.currentMethod.textContent = job.current_method || '-';
    elements.progressText.textContent = `${job.processed}/${job.total} (${Math.round(job.progress)}%)`;
}

function showResult(result) {
    elements.progressSection.style.display = 'none';
    elements.resultSection.style.display = 'block';
    elements.resultSuccess.style.display = 'block';
    elements.resultFailed.style.display = 'none';
    
    elements.resultPassword.textContent = result.password;
    elements.resultMethod.textContent = result.method;
    elements.resultHash.textContent = result.hash;
    
    Toast.success('Password found!');
}

function showError(message) {
    elements.progressSection.style.display = 'none';
    elements.resultSection.style.display = 'block';
    elements.resultSuccess.style.display = 'none';
    elements.resultFailed.style.display = 'block';
    
    elements.errorMessage.textContent = message || 'An unknown error occurred';
    
    Toast.error(message || 'Cracking failed');
}

// Stop cracking
elements.stopCrack.addEventListener('click', async () => {
    if (!state.currentJob) return;
    
    try {
        await fetch(`/api/stop-job/${state.currentJob}`, {
            method: 'POST'
        });
        
        Toast.warning('Stopping crack job...');
    } catch (error) {
        console.error('Stop job error:', error);
        Toast.error('Failed to stop job');
    }
});

// New crack
elements.newCrack.addEventListener('click', async () => {
    // Cleanup old job
    if (state.currentJob) {
        try {
            await fetch(`/api/cleanup/${state.currentJob}`, {
                method: 'POST'
            });
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }
    
    // Reset state
    state = {
        targetFile: null,
        wordlistFile: null,
        targetHash: null,
        wordlistCount: 0,
        currentJob: null,
        statusCheckInterval: null
    };
    
    // Reset UI
    elements.targetInfo.style.display = 'none';
    elements.wordlistInfo.style.display = 'none';
    elements.controls.style.display = 'none';
    elements.progressSection.style.display = 'none';
    elements.resultSection.style.display = 'none';
    elements.startCrack.disabled = true;
    elements.startCrack.innerHTML = '<i class="fas fa-play"></i> Start Cracking';
    
    // Clear file inputs
    elements.targetFile.value = '';
    elements.wordlistFile.value = '';
    
    Toast.info('Ready for new crack job');
});

// Download result (if applicable)
elements.downloadResult.addEventListener('click', () => {
    // Implement download functionality if needed
    Toast.info('Download feature coming soon');
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupFileUploads();
    checkDependencies();
});