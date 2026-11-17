/**
 * ============================================================================
 * GITHUB SESSION SYNC — 100% PERSISTENT ZERO-FAIL WHATSAPP AUTH
 * ============================================================================
 * Automatically saves Baileys session files to GitHub 'session-storage' branch
 * and restores them on container boot.
 *
 * Render restarts/rebuilds will NEVER lose the session again!
 * ============================================================================
 */

'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SESSION_KEY = process.env.SESSION_ENCRYPTION_KEY || '';

function encodeBundle(bundle) {
  const key = Buffer.from(SESSION_KEY, 'base64');
  if (key.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must contain 32 random bytes in base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  return { version: 1, algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decodeBundle(payload) {
  // Read legacy bundles during migration; all subsequent writes require encryption.
  if (!payload.algorithm) return payload;
  if (payload.algorithm !== 'aes-256-gcm' || payload.version !== 1) throw new Error('Unsupported session encryption');
  const key = Buffer.from(SESSION_KEY, 'base64');
  if (key.length !== 32) throw new Error('Session decryption key missing or invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8'));
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'midomehedi198-lgtm/nexus-fiber-bot';
const GITHUB_BRANCH = 'session-storage';
const BUNDLE_FILE   = 'session_bundle.json';

let isSaving = false;
let lastSaveTime = 0;

function githubRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method: method,
      headers: {
        'User-Agent': 'Nexus-Fibre-Bot-Sync',
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        ...(payload ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        } : {})
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: json });
        } catch (_) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API Timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Restore WhatsApp session files from GitHub into authDir
 */
async function restoreSessionFromGitHub(authDir) {
  if (!GITHUB_TOKEN) return false;
  try {
    console.log('🔄 Checking GitHub for existing WhatsApp session...');
    const res = await githubRequest(
      'GET',
      `/repos/${GITHUB_REPO}/contents/${BUNDLE_FILE}?ref=${GITHUB_BRANCH}`
    );

    if (res.status === 404) {
      console.log('ℹ️ No saved session found on GitHub. Starting fresh.');
      return false;
    }

    if (res.status !== 200 || !res.data?.content) {
      console.warn(`⚠️ GitHub session fetch returned HTTP ${res.status}`);
      return false;
    }

    // Decode bundle content
    const rawBundleJson = Buffer.from(res.data.content, 'base64').toString('utf8');
    const bundle = decodeBundle(JSON.parse(rawBundleJson));
    const files = Object.keys(bundle);

    // Validate the entire bundle before writing any auth files.
    if (files.some(filename => !/^[a-zA-Z0-9_.-]+\.json$/.test(filename) ||
        typeof bundle[filename] !== 'string')) {
      console.warn('GitHub session bundle contains invalid filenames or values.');
      return false;
    }

    if (files.length === 0 || !bundle['creds.json']) {
      console.warn('⚠️ GitHub session bundle is empty or missing creds.json');
      return false;
    }

    // Verify that creds is actually registered (not an uncompleted pairing attempt)
    try {
      const credsObj = JSON.parse(Buffer.from(bundle['creds.json'], 'base64').toString('utf8'));
      if (!credsObj.registered) {
        console.warn('⚠️ GitHub session creds.registered is not true. Discarding incomplete session.');
        return false;
      }
    } catch (_) {
      console.warn('⚠️ GitHub session creds could not be parsed.');
      return false;
    }

    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    for (const [filename, base64Content] of Object.entries(bundle)) {
      const fileBuffer = Buffer.from(base64Content, 'base64');
      fs.writeFileSync(path.join(authDir, filename), fileBuffer);
    }

    console.log(`🎉 SUCCESS! Restored ${files.length} session files from GitHub!`);
    console.log('⚡ Bot will reconnect automatically without scanning QR!');
    return true;
  } catch (err) {
    console.warn('⚠️ Could not restore session from GitHub:', err.message);
    return false;
  }
}

/**
 * Save all files in authDir to GitHub session-storage branch
 */
async function saveSessionToGitHub(authDir) {
  if (!GITHUB_TOKEN || !SESSION_KEY) return;
  // Debounce saves: at most once every 10 seconds
  if (isSaving || Date.now() - lastSaveTime < 10000) return;
  if (!fs.existsSync(authDir)) return;

  const credsPath = path.join(authDir, 'creds.json');
  if (!fs.existsSync(credsPath)) return; // Don't save empty dir

  try {
    const credsObj = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    if (!credsObj.registered) {
      // Never save unregistered/half-baked sessions!
      return;
    }
  } catch (_) {
    return;
  }

  isSaving = true;
  try {
    const fileList = fs.readdirSync(authDir);
    const bundle = {};

    for (const file of fileList) {
      const filePath = path.join(authDir, file);
      if (fs.statSync(filePath).isFile()) {
        bundle[file] = fs.readFileSync(filePath).toString('base64');
      }
    }

    if (!bundle['creds.json']) {
      isSaving = false;
      return;
    }

    // Check if file exists to get existing SHA
    const existing = await githubRequest(
      'GET',
      `/repos/${GITHUB_REPO}/contents/${BUNDLE_FILE}?ref=${GITHUB_BRANCH}`
    );
    const sha = existing.status === 200 ? existing.data?.sha : undefined;

    const bundleString = JSON.stringify(encodeBundle(bundle));
    const contentBase64 = Buffer.from(bundleString).toString('base64');

    const putRes = await githubRequest(
      'PUT',
      `/repos/${GITHUB_REPO}/contents/${BUNDLE_FILE}`,
      {
        message: `chore: persistent session sync [${new Date().toISOString()}]`,
        content: contentBase64,
        branch: GITHUB_BRANCH,
        ...(sha ? { sha } : {})
      }
    );

    if (putRes.status === 200 || putRes.status === 201) {
      lastSaveTime = Date.now();
      console.log(`💾 WhatsApp session permanently saved to GitHub (${fileList.length} files)!`);
    } else {
      console.warn(`⚠️ GitHub session save HTTP ${putRes.status}:`, putRes.data?.message || '');
    }
  } catch (err) {
    console.warn('⚠️ GitHub session save error:', err.message);
  } finally {
    isSaving = false;
  }
}

module.exports = {
  encodeBundle,
  decodeBundle,
  restoreSessionFromGitHub,
  saveSessionToGitHub
};
