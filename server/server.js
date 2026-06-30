require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const axios = require('axios');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

let clients = [];
app.get('/api/stream', (req, res) => {
    const username = req.query.username;
    if (!username) return res.status(400).end();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform'); 
    res.setHeader('X-Accel-Buffering', 'no'); 
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); 

    const newClient = { id: Date.now(), username: username, res: res };
    clients.push(newClient);

    const heartbeat = setInterval(() => res.write(':\n\n'), 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        clients = clients.filter(c => c.id !== newClient.id);
    });
});

let otpStorage = {};
const DB_FILE = path.join(__dirname, '../db.json');

const readDB = () => {
    if (!fs.existsSync(DB_FILE)) return { users: [], files: [], shares: [] };
    const db = JSON.parse(fs.readFileSync(DB_FILE));
    if(!db.shares) db.shares = [];
    return db;
};

const writeDB = (db) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
};

const ENCRYPTION_KEY = crypto.scryptSync('MiniCloudSuperSecretKey!', 'salt', 32);
const IV_LENGTH = 16;
const MAX_STORAGE_BYTES = 2 * 1024 * 1024 * 1024;

async function sendBrevoEmail(emailTujuan, kodeOtp, subject) {
    const url = 'https://api.brevo.com/v3/smtp/email';
    const payload = {
        sender: { name: "MiniCloud Admin", email: "mini.cloud.arc@gmail.com" },
        to: [{ email: emailTujuan }],
        subject: subject,
        htmlContent: `<h2>Verifikasi Akun</h2><p>Kode OTP Anda adalah: <strong>${kodeOtp}</strong></p>`
    };

    try {
        await axios.post(url, payload, {
            family: 4,
            headers: {
                'api-key': process.env.BREVO_API_KEY,
                'Content-Type': 'application/json'
            }
        });
        console.log("SUKSES: Email terkirim via Axios!");
    } catch (error) {
        console.error("--- DEBUG BREVO ERROR ---");
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Respon Data:", JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error("Tidak ada respon dari server Brevo:", error.request);
        } else {
            console.error("Error Message:", error.message);
        }
        console.error("-------------------------");
        throw error;
    }
}

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let db = readDB();
        const user = db.users.find(u => u.username === username);
        if (!user) return res.status(400).json({ success: false, message: 'Username tidak ditemukan.' });
        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) return res.status(400).json({ success: false, message: 'Password salah.' });
        const sessionToken = crypto.randomBytes(16).toString('hex');
        user.sessionToken = sessionToken;
        writeDB(db);
        res.json({ success: true, user: { username: user.username, email: user.email }, sessionToken: sessionToken });
    } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
});

app.post('/api/session-check', (req, res) => {
    const { username, sessionToken } = req.body;
    let db = readDB();
    const user = db.users.find(u => u.username === username);
    if (user && user.sessionToken === sessionToken) res.json({ valid: true });
    else res.json({ valid: false });
});

app.post('/api/request-register-otp', async (req, res) => {
    const { username, email } = req.body;
    let db = readDB();
    if (db.users.find(u => u.username === username)) return res.status(400).json({ success: false, message: 'Username sudah digunakan.' });
    if (db.users.find(u => u.email === email)) return res.status(400).json({ success: false, message: 'Email sudah terdaftar.' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStorage[email] = { otp, type: 'register', expires: Date.now() + 5 * 60000 };
    
    try {
        await sendBrevoEmail(email, otp, 'Kode OTP Registrasi MiniCloud');
        res.json({ success: true });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Gagal mengirim email OTP.' }); 
    }
});

app.post('/api/verify-register', async (req, res) => {
    const { email, otp, username, password } = req.body;
    const storedData = otpStorage[email];
    if (!storedData || storedData.otp !== otp || storedData.type !== 'register' || Date.now() > storedData.expires) return res.status(400).json({ success: false, message: 'OTP tidak valid atau kadaluarsa.' });
    const hashedPassword = await bcrypt.hash(password, 10);
    let db = readDB();
    db.users.push({ username, email, password: hashedPassword, joinedAt: new Date().toISOString() });
    writeDB(db);
    delete otpStorage[email];
    res.json({ success: true, message: 'Pendaftaran berhasil. Silakan login.' });
});

app.post('/api/request-reset-otp', async (req, res) => {
    const { email } = req.body;
    let db = readDB();
    if (!db.users.find(u => u.email === email)) return res.status(400).json({ success: false, message: 'Email tidak ditemukan.' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStorage[email] = { otp, type: 'reset', expires: Date.now() + 5 * 60000 };
    
    try {
        await sendBrevoEmail(email, otp, 'Kode OTP Reset Password MiniCloud');
        res.json({ success: true });
    } catch (error) { 
        res.status(500).json({ success: false, message: 'Gagal mengirim email OTP.' }); 
    }
});

app.post('/api/reset-password', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const storedData = otpStorage[email];
    if (!storedData || storedData.otp !== otp || storedData.type !== 'reset' || Date.now() > storedData.expires) return res.status(400).json({ success: false, message: 'OTP tidak valid atau kadaluarsa.' });
    let db = readDB();
    const userIndex = db.users.findIndex(u => u.email === email);
    db.users[userIndex].password = await bcrypt.hash(newPassword, 10);
    writeDB(db);
    delete otpStorage[email];
    res.json({ success: true, message: 'Password berhasil diubah. Silakan login.' });
});

app.get('/api/files', (req, res) => {
    const username = req.query.username;
    let db = readDB();
    const userFiles = db.files.filter(f => f.owner === username);
    res.json(userFiles);
});

app.get('/api/shared-files', (req, res) => {
    const username = req.query.username;
    let db = readDB();
    const userShared = db.shares.filter(s => s.target === username);
    res.json(userShared);
});

app.post('/api/upload', upload.single('file'), (req, res) => {
    const username = req.body.username;
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, message: 'Tidak ada file.' });

    let db = readDB();
    const currentSize = db.files.filter(f => f.owner === username).reduce((acc, f) => acc + f.size, 0);
    if (currentSize + file.size > MAX_STORAGE_BYTES) return res.status(400).json({ success: false, message: 'Penyimpanan penuh!' });

    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        const encryptedData = Buffer.concat([cipher.update(file.buffer), cipher.final()]);
        const finalBuffer = Buffer.concat([iv, encryptedData]);

        const fileId = crypto.randomBytes(8).toString('hex');
        const filePath = path.join(UPLOADS_DIR, fileId + '.enc');
        fs.writeFileSync(filePath, finalBuffer);

        const newFile = {
            id: fileId,
            name: file.originalname,
            owner: username,
            size: file.size,
            path: filePath,
            uploadDate: new Date().toISOString()
        };

        db.files.push(newFile);
        writeDB(db);
        res.json({ success: true, file: newFile });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Gagal mengunggah file.' });
    }
});

app.delete('/api/files/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.query;
    let db = readDB();
    const fileIndex = db.files.findIndex(f => f.id === id && f.owner === username);
    
    if (fileIndex > -1) {
        const file = db.files[fileIndex];
        if (file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        
        db.files.splice(fileIndex, 1);
        db.shares = db.shares.filter(s => s.fileId !== id);
        writeDB(db);
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, message: 'File tidak ditemukan.' });
    }
});

app.get('/api/download/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.query;
    let db = readDB();
    const file = db.files.find(f => f.id === id && f.owner === username);
    if (!file || !fs.existsSync(file.path)) return res.status(404).send('File tidak ditemukan.');

    try {
        const fileBuffer = fs.readFileSync(file.path);
        const iv = fileBuffer.subarray(0, IV_LENGTH);
        const encryptedData = fileBuffer.subarray(IV_LENGTH);
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.send(decrypted);
    } catch (error) { res.status(500).send('Gagal mendekripsi atau mengunduh.'); }
});

app.get('/api/download-shared/:id', (req, res) => {
    const { id } = req.params;
    const { username } = req.query;
    let db = readDB();
    const shared = db.shares.find(s => s.id === id && s.target === username);
    if (!shared) return res.status(404).send('File share tidak ditemukan.');
    const file = db.files.find(f => f.id === shared.fileId);
    if (!file || !fs.existsSync(file.path)) return res.status(404).send('File asli tidak ditemukan.');

    try {
        const fileBuffer = fs.readFileSync(file.path);
        const iv = fileBuffer.subarray(0, IV_LENGTH);
        const encryptedData = fileBuffer.subarray(IV_LENGTH);
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
        res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
        res.send(decrypted);
    } catch (error) { res.status(500).send('Gagal mendekripsi atau mengunduh.'); }
});

app.post('/api/share', (req, res) => {
    const { fileId, ownerUsername, targetUsername } = req.body;
    let db = readDB();
    const file = db.files.find(f => f.id === fileId && f.owner === ownerUsername);
    const targetUser = db.users.find(u => u.username === targetUsername);
    if (!file) return res.status(400).json({ success: false, message: 'File tidak ditemukan.' });
    if (!targetUser) return res.status(400).json({ success: false, message: 'Username tujuan tidak ditemukan.' });
    const alreadyShared = db.shares.find(s => s.fileId === fileId && s.target === targetUsername);
    if (alreadyShared) return res.status(400).json({ success: false, message: 'File sudah dibagikan.' });
    const newShare = { id: crypto.randomBytes(8).toString('hex'), fileId: file.id, name: file.name, owner: ownerUsername, target: targetUsername, size: file.size, sharedAt: new Date().toISOString() };
    db.shares.push(newShare);
    writeDB(db);

    const targetClients = clients.filter(c => c.username === targetUsername);
    if (targetClients.length > 0) {
        targetClients.forEach(client => client.res.write(`data: ${JSON.stringify({ type: 'NEW_SHARE', file: newShare })}\n\n`));
    }
    res.json({ success: true });
});

app.listen(3000, () => console.log('Server berjalan di port 3000'));
