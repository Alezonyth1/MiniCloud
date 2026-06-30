let isLoginMode = true;
let currentUser = null;
let currentFiles = [];
let sharedFiles = [];
let fileToDelete = null;
let fileToShare = null;
let inactivityTimer;
let lastClickTime = 0;
let currentOtpMode = '';
let currentEmail = '';
let isEmailHidden = true;
let hasWarnedStorage = false;
let currentSessionToken = null;
let sessionChecker;
let eventSource = null;

const MAX_STORAGE = 2 * 1024 * 1024 * 1024;
const WARNING_STORAGE = 1.8 * 1024 * 1024 * 1024;
const INACTIVITY_LIMIT = 5 * 60 * 1000;

function isSpam(delay = 600) {
    const now = Date.now();
    if (now - lastClickTime < delay) return true;
    lastClickTime = now;
    return false;
}

document.addEventListener('contextmenu', event => event.preventDefault());
document.addEventListener('keydown', function(e) {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'C' || e.key === 'J')) || (e.ctrlKey && e.key === 'u')) {
        e.preventDefault();
        return false;
    }
});

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (currentUser) {
        inactivityTimer = setTimeout(() => {
            logout(true, 'Sesi berakhir karena tidak ada aktivitas.');
        }, INACTIVITY_LIMIT);
    }
}
window.onload = resetInactivityTimer;
document.onmousemove = resetInactivityTimer;
document.onkeypress = resetInactivityTimer;

function startSessionChecker() {
    clearInterval(sessionChecker);
    sessionChecker = setInterval(async () => {
        if (!currentUser || !currentSessionToken) return;
        try {
            const res = await fetch('/api/session-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: currentUser.username, sessionToken: currentSessionToken })
            });
            const data = await res.json();
            if (!data.valid) {
                logout(true, 'Sesi Anda telah berakhir karena login di perangkat lain.');
            }
        } catch (e) {}
    }, 3000);
}

function startRealtimeConnection() {
    if (eventSource) eventSource.close();
    if (!currentUser) return;

    console.log(`🔄 [FRONTEND] Mencoba membuka koneksi real-time untuk: ${currentUser.username}`);
    eventSource = new EventSource(`/api/stream?username=${currentUser.username}`);
    eventSource.onopen = () => console.log('🟢 [FRONTEND] Pipa real-time BERHASIL DIBUKA!');
    eventSource.onerror = (e) => console.log('🔴 [FRONTEND] Pipa real-time TERPUTUS / ERROR!');
    eventSource.onmessage = function(event) {
        if (event.data === '') {
            console.log('💓 [FRONTEND] Menerima detak jantung (ping) dari server...');
            return; 
        }

        console.log('📥 [FRONTEND] Menerima data masuk:', event.data); // Pelacak data masuk
        
        const data = JSON.parse(event.data);
        if (data.type === 'NEW_SHARE') {
            sharedFiles.push(data.file);
            showToast(`🔔 ${data.file.owner} membagikan file baru: ${data.file.name}`, 'success');
            
            const sectionDibagikan = document.getElementById('section-dibagikan');
            if (sectionDibagikan && !sectionDibagikan.classList.contains('hidden')) {
                renderSharedFiles();
            }
        }
    };
}

function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500', warning: 'bg-yellow-500' };
    toast.className = `${colors[type]} text-white px-5 py-3 rounded-lg shadow-lg transform transition-all duration-300 opacity-0 translate-y-[-20px] font-medium text-sm flex items-center gap-2`;
    toast.innerText = message;

    if (container.childElementCount >= 3) container.removeChild(container.firstChild);

    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('opacity-0', 'translate-y-[-20px]'), 10);
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-[-20px]');
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 300);
    }, 3000);
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function togglePassword(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (input.type === 'password') {
        input.type = 'text';
        icon.innerText = '🙈';
    } else {
        input.type = 'password';
        icon.innerText = '👁️';
    }
}

function showLoginForm() {
    document.getElementById('login-form').classList.remove('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.add('hidden');
    document.getElementById('otp-form').classList.add('hidden');
}

function showRegisterForm() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
    document.getElementById('forgot-form').classList.add('hidden');
    document.getElementById('otp-form').classList.add('hidden');
}

function showForgotPasswordForm() {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.remove('hidden');
    document.getElementById('otp-form').classList.add('hidden');
}

function showOtpForm(mode) {
    currentOtpMode = mode;
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('forgot-form').classList.add('hidden');
    document.getElementById('otp-form').classList.remove('hidden');

    if (mode === 'reset') {
        document.getElementById('otp-password-container').classList.remove('hidden');
        document.getElementById('otp-new-password').required = true;
    } else {
        document.getElementById('otp-password-container').classList.add('hidden');
        document.getElementById('otp-new-password').required = false;
    }
}

async function login(e) {
    e.preventDefault();
    if (isSpam()) return;

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!username || !password) return showToast('Username dan Password wajib diisi!', 'warning');

    showLoading();
    try {
        const res = await fetch('/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            hideLoading();
            if (res.status === 404) return showToast('Error 404: Rute API tidak ditemukan.', 'error');
            return showToast(`Gagal terhubung ke server (Error ${res.status})`, 'error');
        }

        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            currentSessionToken = data.sessionToken;

            document.getElementById('view-auth').classList.add('hidden');
            document.getElementById('view-dashboard').classList.remove('hidden');
            document.getElementById('view-dashboard').classList.add('flex');

            document.getElementById('info-username').innerText = currentUser.username;
            document.getElementById('info-email').innerText = currentUser.email || '-';
            document.getElementById('info-joined').innerText = new Date(currentUser.joinedAt || Date.now()).toLocaleDateString('id-ID');
            isEmailHidden = true;
            toggleEmailVisibility();

            showToast(`Selamat datang, ${currentUser.username}!`, 'success');
            resetInactivityTimer();
            startSessionChecker();
            startRealtimeConnection();
            await loadFiles();
        } else {
            showToast(data.message, 'error');
        }
    } catch (error) { showToast('Server mati atau gangguan jaringan.', 'error'); }
    hideLoading();
}

async function requestRegisterOTP(e) {
    e.preventDefault();
    if(isSpam()) return;
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    if (!username || !email) return showToast('Harap isi semua data!', 'error');

    showLoading();
    try {
        const res = await fetch('/api/request-register-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });
        const data = await res.json();
        if (data.success) {
            currentEmail = email;
            showToast('OTP terkirim. Silakan cek email Anda.', 'success');
            showOtpForm('register');
        } else { showToast(data.message, 'error'); }
    } catch (error) { showToast('Koneksi server gagal.', 'error'); }
    hideLoading();
}

async function requestResetOTP(e) {
    e.preventDefault();
    if(isSpam()) return;
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) return showToast('Harap isi alamat email!', 'error');

    showLoading();
    try {
        const res = await fetch('/api/request-reset-otp', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
            currentEmail = email;
            showToast('OTP terkirim. Silakan cek email Anda.', 'success');
            showOtpForm('reset');
        } else { showToast(data.message, 'error'); }
    } catch (error) { showToast('Koneksi server gagal.', 'error'); }
    hideLoading();
}

async function verifyOTP(e) {
    e.preventDefault();
    if(isSpam()) return;
    const otp = document.getElementById('otp-input').value.trim();
    if (!otp) return showToast('Masukkan kode OTP!', 'warning');

    showLoading();
    let endpoint = '';
    let bodyData = { email: currentEmail, otp: otp };

    if (currentOtpMode === 'register') {
        endpoint = '/api/verify-register';
        bodyData.username = document.getElementById('reg-username').value;
        bodyData.password = document.getElementById('reg-password').value;
    } else if (currentOtpMode === 'reset') {
        endpoint = '/api/reset-password';
        bodyData.newPassword = document.getElementById('otp-new-password').value;
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyData)
        });
        const data = await res.json();
        if (data.success) {
            showToast(data.message, 'success');
            document.getElementById('otp-input').value = '';
            document.getElementById('otp-new-password').value = '';
            showLoginForm();
        } else { showToast(data.message, 'error'); }
    } catch (error) { showToast('Koneksi server gagal.', 'error'); }
    hideLoading();
}

function logout(isForced = false, message = 'Berhasil keluar.') {
    currentUser = null;
    currentSessionToken = null;
    currentFiles = [];
    sharedFiles = [];
    
    clearInterval(sessionChecker);
    clearTimeout(inactivityTimer);
    
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    document.getElementById('view-auth').classList.remove('hidden');
    document.getElementById('view-dashboard').classList.add('hidden');
    document.getElementById('view-dashboard').classList.remove('flex');

    document.querySelectorAll('input').forEach(input => {
        input.value = '';
        if (input.type === 'text' && (input.id === 'login-password' || input.id === 'reg-password' || input.id === 'otp-new-password')) {
            input.type = 'password';
        }
    });
    
    const icons = ['eye-login', 'eye-reg', 'eye-otp'];
    icons.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = '👁️';
    });

    showLoginForm();
    showToast(message, isForced ? 'error' : 'success');
}

function showSection(section) {
    if (isSpam(200)) return;

    ['beranda', 'dibagikan', 'pengaturan'].forEach(s => {
        const sectionEl = document.getElementById(`section-${s}`);
        if(sectionEl) sectionEl.classList.add('hidden');

        const navBtn = document.getElementById(`nav-${s}`);
        if(navBtn) {
            navBtn.classList.remove('bg-blue-50', 'dark:bg-blue-900/30', 'text-blue-600', 'dark:text-blue-400', 'font-semibold');
            navBtn.classList.add('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-800');
        }
    });

    const targetSection = document.getElementById(`section-${section}`);
    if(targetSection) targetSection.classList.remove('hidden');

    const activeNav = document.getElementById(`nav-${section}`);
    if(activeNav) {
        activeNav.classList.remove('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-800');
        activeNav.classList.add('bg-blue-50', 'dark:bg-blue-900/30', 'text-blue-600', 'dark:text-blue-400', 'font-semibold');
    }

    if (section === 'beranda') renderFiles();
    if (section === 'dibagikan') renderSharedFiles();

    closeMobileMenu();
}

function toggleMobileMenu() {
    document.getElementById('sidebar').classList.toggle('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.toggle('hidden');
}

function closeMobileMenu() {
    document.getElementById('sidebar').classList.add('-translate-x-full');
    document.getElementById('sidebar-overlay').classList.add('hidden');
}

function toggleDarkMode() {
    if (isSpam(300)) return;
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    showToast(isDark ? 'Mode gelap diaktifkan.' : 'Mode terang diaktifkan.', 'info');
}

if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.classList.add('dark');
    const toggle = document.getElementById('dark-mode-toggle');
    if (toggle) toggle.checked = true;
}

function toggleEmailVisibility() {
    const emailEl = document.getElementById('info-email');
    if (!currentUser) return;

    isEmailHidden = !isEmailHidden;
    if (isEmailHidden) {
        const parts = currentUser.email.split('@');
        emailEl.innerText = parts[0].substring(0, 3) + '***@' + parts[1];
    } else {
        emailEl.innerText = currentUser.email;
    }
}

async function loadFiles() {
    if (!currentUser) return;
    try {
        const res = await fetch(`/api/files?username=${currentUser.username}`);
        currentFiles = await res.json();

        const resShared = await fetch(`/api/shared-files?username=${currentUser.username}`);
        sharedFiles = await resShared.json();

        updateStorageWidget();
        showSection('beranda');
    } catch (e) {
        showToast('Gagal memuat daftar file.', 'error');
    }
}

function updateStorageWidget() {
    const totalBytes = currentFiles.reduce((acc, file) => acc + file.size, 0);
    const percentage = Math.min((totalBytes / MAX_STORAGE) * 100, 100).toFixed(1);

    document.getElementById('storage-percent').innerText = `${percentage}%`;
    document.getElementById('storage-text').innerText = formatSize(totalBytes);
    document.getElementById('storage-bar').style.width = `${percentage}%`;

    const circle = document.getElementById('storage-circle');
    if(circle) {
        const circumference = 125.6;
        const offset = circumference - (percentage / 100) * circumference;
        circle.style.strokeDashoffset = offset;

        if (percentage > 90) circle.classList.replace('text-blue-500', 'text-red-500');
        else circle.classList.replace('text-red-500', 'text-blue-500');
    }

    if (totalBytes > WARNING_STORAGE && !hasWarnedStorage) {
        showToast('Penyimpanan Anda hampir penuh!', 'warning');
        hasWarnedStorage = true;
    } else if (totalBytes < WARNING_STORAGE) {
        hasWarnedStorage = false;
    }
}

function renderFiles() {
    const tbody = document.getElementById('file-table-body');
    if (!tbody) return;

    if (currentFiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-500 dark:text-gray-400">Belum ada file. Mulai unggah file pertama Anda!</td></tr>`;
        return;
    }

    tbody.innerHTML = currentFiles.map(file => `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group">
            <td class="p-4 flex items-center gap-3">
                <span class="text-xl">📄</span>
                <span class="font-medium truncate w-32 md:w-64" title="${file.name}">${file.name}</span>
            </td>
            <td class="p-4 text-gray-500 dark:text-gray-400">${new Date(file.uploadDate).toLocaleDateString('id-ID')}</td>
            <td class="p-4 text-gray-500 dark:text-gray-400">${formatSize(file.size)}</td>
            <td class="p-4 text-center space-x-2">
                <button onclick="downloadFile('${file.id}')" class="p-1.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition" title="Unduh">⬇️</button>
                <button onclick="openShareModal('${file.id}')" class="p-1.5 bg-green-100 text-green-600 rounded hover:bg-green-200 transition" title="Bagikan">🔗</button>
                <button onclick="openDeleteModal('${file.id}')" class="p-1.5 bg-red-100 text-red-600 rounded hover:bg-red-200 transition" title="Hapus">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function renderSharedFiles() {
    const tbody = document.getElementById('shared-file-table-body');
    if (!tbody) return;

    if (sharedFiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500 dark:text-gray-400">Belum ada file yang dibagikan kepada Anda.</td></tr>`;
        return;
    }

    tbody.innerHTML = sharedFiles.map(file => {
        let dateStr = new Date().toLocaleDateString('id-ID');
        if (file.sharedAt) {
            const d = new Date(file.sharedAt);
            if (!isNaN(d)) dateStr = d.toLocaleDateString('id-ID');
        } else if (file.uploadDate || file.date) {
            const d = new Date(file.uploadDate || file.date);
            if (!isNaN(d)) dateStr = d.toLocaleDateString('id-ID');
        }
        return `
        <tr class="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors group">
            <td class="p-4 flex items-center gap-3">
                <span class="text-xl">📄</span>
                <span class="font-medium truncate w-24 md:w-48" title="${file.name}">${file.name}</span>
            </td>
            <td class="p-4 text-gray-500 dark:text-gray-400">${file.owner}</td>
            <td class="p-4 text-gray-500 dark:text-gray-400">${dateStr}</td>
            <td class="p-4 text-gray-500 dark:text-gray-400">${formatSize(file.size)}</td>
            <td class="p-4 text-center">
                <button onclick="downloadSharedFile('${file.id}')" class="px-4 py-1.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200 transition font-bold text-xs">Unduh</button>
            </td>
        </tr>
        `;
    }).join('');
}

async function upload() {
    const input = document.getElementById('fileInput');
    if (!input.files.length || !currentUser) return;

    const file = input.files[0];
    const currentSize = currentFiles.reduce((acc, f) => acc + f.size, 0);
    if (currentSize + file.size > MAX_STORAGE) return showToast('Kapasitas penyimpanan penuh!', 'error');

    showLoading();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('username', currentUser.username);

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            showToast('Berhasil mengunggah file.', 'success');
            await loadFiles();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) {
        showToast('Gagal mengunggah file.', 'error');
    }
    input.value = '';
    hideLoading();
}

function downloadFile(id) {
    window.location.href = `/api/download/${id}?username=${currentUser.username}`;
    showToast('Memproses unduhan...', 'info');
}

function downloadSharedFile(id) {
    window.location.href = `/api/download-shared/${id}?username=${currentUser.username}`;
    showToast('Memproses unduhan...', 'info');
}

function openDeleteModal(id) {
    fileToDelete = id;
    document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeConfirmModal() {
    fileToDelete = null;
    document.getElementById('confirm-modal').classList.add('hidden');
}

document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    if (!fileToDelete) return;
    showLoading();
    document.getElementById('confirm-modal').classList.add('hidden');
    try {
        await fetch(`/api/files/${fileToDelete}?username=${currentUser.username}`, { method: 'DELETE' });
        showToast('File berhasil dihapus.', 'success');
        await loadFiles();
    } catch (e) { showToast('Gagal menghapus file.', 'error'); }
    hideLoading();
    fileToDelete = null;
});

function openShareModal(id) {
    fileToShare = id;
    document.getElementById('share-target-username').value = '';
    document.getElementById('share-modal').classList.remove('hidden');
}

function closeShareModal() {
    fileToShare = null;
    document.getElementById('share-modal').classList.add('hidden');
}

async function submitShare() {
    const target = document.getElementById('share-target-username').value.trim();
    if (!target) return showToast('Masukkan username tujuan.', 'warning');
    if (target === currentUser.username) return showToast('Tidak bisa membagikan ke diri sendiri.', 'error');

    showLoading();
    try {
        const res = await fetch('/api/share', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: fileToShare, ownerUsername: currentUser.username, targetUsername: target })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`File berhasil dibagikan ke ${target}!`, 'success');
            closeShareModal();
        } else {
            showToast(data.message, 'error');
        }
    } catch (e) { showToast('Gagal membagikan file.', 'error'); }
    hideLoading();
}
