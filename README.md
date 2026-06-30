# MiniCloud ☁️

MiniCloud is a personal cloud storage and file sharing system built with a focus on security, performance, and reliability. This system is designed to run in a Linux VPS environment with stable process management.

**Recommended VPS Specifications:**
* RAM: 4GB
* CPU: 2/4 vCPU
* Storage: 100/500 GB

## 🛠️ Tech Stack

* **Backend:** Node.js with Express.js framework.
* **Security:** * `bcryptjs`: For password hashing.
    * `crypto`: For generating secure, unique file IDs.
* **Storage & Handling:** `multer` (for multipart file upload) and Node.js built-in Filesystem (FS) module.
* **Real-time Communication:** Server-Sent Events (SSE) for real-time file sharing notifications.
* **DevOps:** PM2 as a Process Manager to ensure 24/7 uptime.
* **Connectivity:** Axios with IPv4 optimization for API connection stability.

---

## 🎨 Design & UI/UX Guidelines

This system features a **Modern Minimalist Dashboard** theme, focusing on clean navigation and high functionality.

### 1. Color Palette
* **Primary (Trust Blue):** `#2563eb` (Used for primary buttons: Upload, Login, Share for a professional cloud-app look).
* **Background:** `#f9fafb` (Off-white for eye comfort).
* **Text:** `#1e293b` (Dark Slate).

### 2. Layout & UX
* **Structure:** Sidebar (Navigation) on the left, Main Area (File Table) on the right.
* **UX Features:**
    * **Drag & Drop:** Intuitive file uploads.
    * **Toast Notification:** Replaces standard browser `alert()` for professional feedback.
    * **Real-time Update:** The file list dashboard automatically updates via SSE when changes occur (no refresh needed).
    * **Loading State:** Buttons change to `disabled` with "Uploading..." text to prevent double-submissions.
* **Visual:** Icons (Lucide/FontAwesome) for file type identification and responsive design (tables convert to cards on mobile).

---

## ⚙️ Installation Guide

Ensure you have SSH access to your VPS before starting.

### 1. Initial Setup
Navigate to your project directory and install the required libraries:

```bash
cd ~/MiniCloud
npm install

```

### 2. Server Configuration

Open `server.js`, locate line 61, and adjust the `sender` data for Brevo email integration:

```javascript
const payload = {
    sender: { name: "Your Name", email: "your-verified-email@brevo.com" },
    // ... other configurations
}

```

Create or edit the `.env` file in the project directory:

```bash
nano .env

```

Add your API Key:

```text
BREVO_API_KEY=xkeysib-xxxx-xxxx

```

*(Save with Ctrl + O, Enter, then Ctrl + X)*

### 3. Deployment (PM2)

Start the application in the background:

```bash
# Start application
pm2 start server/server.js --name minicloud

# Save configuration to ensure auto-restart on reboot
pm2 save

# Check logs in SSH
pm2 logs minicloud --lines 20

```

---

## 📧 Brevo Integration Configuration

To ensure OTP emails are sent successfully, follow these steps:

1. **Whitelisting IP:**
* Retrieve your server's public IP using: `curl ifconfig.me`
* Login to your [Brevo Dashboard](https://app.brevo.com/security/authorised_ips).
* Add your server's IP to the *Authorised IPs* list.


2. **Connection Optimization:**
Ensure the email sending function in `server.js` includes `family: 4` to force connection via IPv4, which is more stable on VPS:

```javascript
await axios.post(url, payload, {
    family: 4, 
    headers: {
        'api-key': process.env.BREVO_API_KEY,
        'Content-Type': 'application/json'
    }
});

```

---

## 🛠️ Troubleshooting

If you encounter issues, use the following commands:

* **Application inaccessible (Port 3000 busy):**

```bash
fuser -k 3000/tcp
pm2 restart minicloud

```

* **View Error Logs:**

```bash
pm2 logs minicloud --lines 50

```

* **If ETIMEDOUT persists:**

```bash
unset HTTPS_PROXY
unset HTTP_PROXY

```

---

*Maintained by Rifqi Ardianto.*

```

```
