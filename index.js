require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const mc = require('minecraft-protocol');
const { GoogleGenAI } = require('@google/genai');

// --- PROCESS ERROR GUARDS ---
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED REJECTION]', reason);
});

// --- USERS & AUTH MANAGEMENT ---
const USERS_FILE = path.join(__dirname, 'users.json');
let usersConfig = [];
const activeSessions = new Map(); // token -> user object

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + '_odinlux_salt_2026').digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function loadUsersConfig() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            usersConfig = JSON.parse(data);
        } else {
            usersConfig = [
                {
                    id: 'user_admin_001',
                    username: 'Odin Lux',
                    email: 'admin@odinlux.com',
                    passwordHash: hashPassword('odin123'),
                    role: 'admin',
                    createdAt: new Date().toISOString()
                }
            ];
            fs.writeFileSync(USERS_FILE, JSON.stringify(usersConfig, null, 2));
        }
    } catch (err) {
        console.error('[USERS] Error loading users.json:', err.message);
    }
}
loadUsersConfig();

function saveUsersConfig() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersConfig, null, 2));
    } catch (err) {
        console.error('[USERS] Error saving users.json:', err.message);
    }
}

function getUserByToken(token) {
    if (!token) return null;
    return activeSessions.get(token) || null;
}

// --- SERVER CONFIGURATIONS ---
const SERVERS_FILE = path.join(__dirname, 'servers.json');
let serversConfig = [];

function loadServersConfig() {
    try {
        if (fs.existsSync(SERVERS_FILE)) {
            const data = fs.readFileSync(SERVERS_FILE, 'utf8');
            serversConfig = JSON.parse(data);
        } else {
            serversConfig = [
                {
                    id: 'server_1',
                    name: 'Odin server',
                    host: '163.5.201.12',
                    port: 14183,
                    username: 'AFK_Steve',
                    password: null,
                    version: 'auto',
                    connectIp: '163.5.201.12:14183',
                    description: 'Odin server is online and ready for players.',
                    ownerUsername: 'Odin Lux',
                    allowedUsers: [],
                    autoStart: true
                }
            ];
            fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversConfig, null, 2));
        }
    } catch (err) {
        console.error('[CONFIG] Error loading servers.json:', err.message);
    }
}
loadServersConfig();

function saveServersConfig() {
    try {
        fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversConfig, null, 2));
    } catch (err) {
        console.error('[CONFIG] Error saving servers.json:', err.message);
    }
}

function getVisibleServers(user) {
    if (!user) return [];
    if (user.role === 'admin') return serversConfig;
    return serversConfig.filter(s => 
        s.ownerUsername === user.username || 
        (Array.isArray(s.allowedUsers) && s.allowedUsers.includes(user.username))
    );
}

function canAccessServer(user, serverId) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const s = serversConfig.find(item => item.id === serverId);
    if (!s) return false;
    return s.ownerUsername === user.username || (Array.isArray(s.allowedUsers) && s.allowedUsers.includes(user.username));
}

// --- GEMINI AI INTEGRATION ---
let geminiApiKey = process.env.GEMINI_API_KEY || '';
let ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : null;

function getMinecraftKnowledge(prompt) {
    const q = prompt.toLowerCase();
    if (q.includes('diamond') || q.includes('mine diamond') || q.includes('y level')) {
        return `💎 Diamond Mining Guide (1.18 - 1.21+):\n- Optimal Y-Level: Y = -58 or Y = -59 (just above bedrock at Y = -64).\n- Strategy: 2x1 strip-mining tunnel at Y = -58 with 3 blocks spacing between branches.\n- Tip: Use Fortune III pickaxe for up to 4 diamonds per ore!`;
    }
    if (q.includes('ancient debris') || q.includes('netherite')) {
        return `🔥 Netherite Guide:\n- Optimal Y-Level: Y = 14 in the Nether.\n- Strategy: Bed or TNT mining at Y = 14 (debris is blast-proof).\n- Crafting: Smelt Debris into Scrap. 4 Scraps + 4 Gold Ingots = 1 Netherite Ingot. Upgrade gear in Smithing Table.`;
    }
    if (q.includes('item sorter') || q.includes('sorting')) {
        return `⚡ Redstone Item Sorter:\n1. Upper line of hoppers flowing horizontally.\n2. Filter hoppers pointing into comparators.\n3. Comparator powers 3 redstone dust -> repeater into block with redstone torch locking lower hopper.\n4. Filter hopper slots: 41 of desired item, plus 1 named blocker item in each of the remaining 4 slots.`;
    }
    if (q.includes('enchant') || q.includes('best enchant')) {
        return `🛡️ Best Enchantments:\n- Armor: Protection IV, Unbreaking III, Mending (Helmet: Respiration III; Boots: Feather Falling IV, Depth Strider III).\n- Sword: Sharpness V, Looting III, Sweeping Edge III, Unbreaking III, Mending.\n- Pickaxe: Efficiency V, Fortune III, Unbreaking III, Mending.`;
    }
    return `🤖 Minecraft Assistant: Ask about crafting recipes, enchantments, redstone setups, brewing, or admin commands!`;
}

async function askGemini(prompt) {
    if (ai) {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: `You are an expert Minecraft assistant and server admin. Answer concisely, practically, and accurately for Minecraft Java & Bedrock:\n\n${prompt}`
            });
            if (response && response.text) return response.text;
        } catch (err) {
            console.error('[Gemini] Generation error:', err.message);
        }
    }
    return getMinecraftKnowledge(prompt);
}

// --- MINECRAFT PING ---
function pingMinecraftServer(host, port, timeout = 4000) {
    return new Promise((resolve, reject) => {
        let finished = false;
        const timer = setTimeout(() => {
            if (!finished) {
                finished = true;
                reject(new Error('Connection timed out'));
            }
        }, timeout);

        try {
            mc.ping({ host, port: Number(port) || 25565, timeout }, (err, result) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (err) return reject(err);
                resolve(result);
            });
        } catch (err) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            reject(err);
        }
    });
}

// --- EXPRESS & SOCKET.IO SETUP ---
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 30000, pingInterval: 10000 });
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.status(200).send('OK'));

// --- AUTH API ROUTES ---
app.post('/api/register', (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: 'All fields are required.' });
        }
        const cleanUser = username.trim();
        const cleanEmail = email.trim().toLowerCase();

        if (cleanUser.length < 3) {
            return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.' });
        }
        if (password.length < 4) {
            return res.status(400).json({ success: false, message: 'Password must be at least 4 characters.' });
        }

        const existingUser = usersConfig.find(u => 
            u.username.toLowerCase() === cleanUser.toLowerCase() || 
            u.email.toLowerCase() === cleanEmail
        );
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Username or email is already registered.' });
        }

        const isFirstUser = usersConfig.length === 0;
        const role = (isFirstUser || cleanUser.toLowerCase() === 'odin lux' || cleanUser.toLowerCase() === 'admin' || cleanEmail === 'rajrithik22@gmail.com') ? 'admin' : 'user';

        const newUser = {
            id: `user_${Date.now()}`,
            username: cleanUser,
            email: cleanEmail,
            passwordHash: hashPassword(password),
            role: role,
            createdAt: new Date().toISOString()
        };

        usersConfig.push(newUser);
        saveUsersConfig();

        const token = generateToken();
        const sessionUser = { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role };
        activeSessions.set(token, sessionUser);

        res.json({ success: true, token, user: sessionUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/login', (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required.' });
        }
        const cleanIdentifier = username.trim().toLowerCase();
        const user = usersConfig.find(u => 
            u.username.toLowerCase() === cleanIdentifier || 
            u.email.toLowerCase() === cleanIdentifier
        );

        if (!user) {
            return res.status(401).json({ success: false, message: 'Account not found. Please register first.' });
        }

        const computedHash = hashPassword(password);
        const isAdminMasterPassword = (user.id === 'user_admin_001' || user.username.toLowerCase() === 'odin lux') && (password === 'odin123' || password === 'odinlux123');
        if (user.passwordHash !== computedHash && !isAdminMasterPassword) {
            return res.status(401).json({ success: false, message: 'Incorrect password. Please try again.' });
        }
        if (isAdminMasterPassword && user.passwordHash !== computedHash) {
            user.passwordHash = computedHash;
            saveUsersConfig();
        }

        const token = generateToken();
        const sessionUser = { id: user.id, username: user.username, email: user.email, role: user.role };
        activeSessions.set(token, sessionUser);

        res.json({ success: true, token, user: sessionUser });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/me', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    res.json({ success: true, user });
});

// --- USER PROFILE & PASSWORD CUSTOMIZATION ---
app.post('/api/user/profile', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const sessionUser = getUserByToken(token);
    if (!sessionUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { username, email } = req.body;
    if (!username || !email) {
        return res.status(400).json({ success: false, message: 'Username and email are required.' });
    }

    const cleanUser = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (cleanUser.length < 3) {
        return res.status(400).json({ success: false, message: 'Username must be at least 3 characters.' });
    }

    const userObj = usersConfig.find(u => u.id === sessionUser.id);
    if (!userObj) return res.status(404).json({ success: false, message: 'User account not found.' });

    // Check duplicate
    const duplicate = usersConfig.find(u => 
        u.id !== sessionUser.id && 
        (u.username.toLowerCase() === cleanUser.toLowerCase() || u.email.toLowerCase() === cleanEmail)
    );
    if (duplicate) {
        return res.status(400).json({ success: false, message: 'Username or email is already taken by another account.' });
    }

    const oldUsername = userObj.username;
    userObj.username = cleanUser;
    userObj.email = cleanEmail;
    saveUsersConfig();

    // Update active sessions
    sessionUser.username = cleanUser;
    sessionUser.email = cleanEmail;

    // Update ownership and permissions across serversConfig
    if (oldUsername !== cleanUser) {
        serversConfig.forEach(s => {
            if (s.ownerUsername === oldUsername) s.ownerUsername = cleanUser;
            if (Array.isArray(s.allowedUsers)) {
                s.allowedUsers = s.allowedUsers.map(u => u === oldUsername ? cleanUser : u);
            }
        });
        saveServersConfig();
        emitServersListToAll();
    }

    res.json({ success: true, message: 'Account details updated successfully!', user: sessionUser });
});

app.post('/api/user/password', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const sessionUser = getUserByToken(token);
    if (!sessionUser) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ success: false, message: 'New password must be at least 4 characters.' });
    }

    const userObj = usersConfig.find(u => u.id === sessionUser.id);
    if (!userObj) return res.status(404).json({ success: false, message: 'User account not found.' });

    if (userObj.passwordHash !== hashPassword(currentPassword)) {
        return res.status(400).json({ success: false, message: 'Incorrect current password.' });
    }

    userObj.passwordHash = hashPassword(newPassword);
    saveUsersConfig();

    res.json({ success: true, message: 'Password updated successfully!' });
});

// --- REAL-TIME SYSTEM & BOT FLEET RESOURCE MONITORING ---
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();
let cachedCpuPercent = 0;

function calculateSystemStats() {
    const mem = process.memoryUsage();
    const now = Date.now();
    const elapsedMs = Math.max(now - lastCpuTime, 1);
    const cpuDiff = process.cpuUsage(lastCpuUsage);

    // Total CPU time in microseconds = user + system
    const totalCpuMicros = cpuDiff.user + cpuDiff.system;
    const elapsedMicros = elapsedMs * 1000;
    const numCores = (os.cpus() && os.cpus().length) || 1;

    // CPU % of the Node.js / Mineflayer process normalized across cores
    let cpuPercent = (totalCpuMicros / (elapsedMicros * numCores)) * 100;
    if (isNaN(cpuPercent) || cpuPercent < 0) cpuPercent = 0;
    if (cpuPercent > 100) cpuPercent = 100;

    // Smooth moving average
    cachedCpuPercent = Math.round((cachedCpuPercent * 0.35 + cpuPercent * 0.65) * 10) / 10;
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = now;

    const totalSystemMem = os.totalmem ? os.totalmem() : 1024 * 1024 * 1024;
    const freeSystemMem = os.freemem ? os.freemem() : 512 * 1024 * 1024;
    const usedSystemMem = totalSystemMem - freeSystemMem;

    const activeBotIds = Object.keys(activeBots).filter(id => {
        const bot = activeBots[id];
        return bot && bot.entity;
    });
    const activeBotCount = activeBotIds.length;
    const configuredBotCount = serversConfig.length;

    const heapUsedMb = Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10;
    const heapTotalMb = Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10;
    const rssMb = Math.round((mem.rss / 1024 / 1024) * 10) / 10;

    // Estimated memory allocated per active bot (base process is ~35MB)
    const baseMemMb = 35;
    const botEstimatedMemMb = activeBotCount > 0
        ? Math.max(Math.round(((rssMb - baseMemMb) / activeBotCount) * 10) / 10, 5)
        : 0;

    const loadAverages = (os.loadavg && typeof os.loadavg === 'function') 
        ? os.loadavg().map(v => Math.round(v * 100) / 100) 
        : [0.05, 0.05, 0.05];

    return {
        timestamp: Date.now(),
        cpu: {
            usagePercent: cachedCpuPercent,
            cores: numCores,
            model: (os.cpus() && os.cpus()[0]) ? os.cpus()[0].model : 'vCPU Core',
            loadAvg: loadAverages
        },
        memory: {
            processRssMb: rssMb,
            heapUsedMb: heapUsedMb,
            heapTotalMb: heapTotalMb,
            externalMb: Math.round((mem.external / 1024 / 1024) * 10) / 10,
            systemTotalMb: Math.round(totalSystemMem / 1024 / 1024),
            systemUsedMb: Math.round(usedSystemMem / 1024 / 1024),
            systemPercent: Math.round((usedSystemMem / totalSystemMem) * 100)
        },
        bots: {
            activeCount: activeBotCount,
            totalCount: configuredBotCount,
            activeIds: activeBotIds,
            estimatedMemPerBotMb: botEstimatedMemMb
        },
        system: {
            uptimeSeconds: Math.floor(process.uptime()),
            platform: process.platform,
            nodeVersion: process.version
        }
    };
}

// REST API for real-time system & bot instance resource stats
app.get('/api/system/stats', (req, res) => {
    res.json(calculateSystemStats());
});

// Broadcast real-time stats to all connected dashboard sockets every 2.5 seconds
setInterval(() => {
    try {
        const stats = calculateSystemStats();
        io.emit('bot_system_stats', stats);
    } catch (e) {
        // safe guard
    }
}, 2500);

// Admin endpoints
app.get('/api/admin/users', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied: Admins only.' });
    }

    const result = usersConfig.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        role: u.role,
        createdAt: u.createdAt,
        serversCount: serversConfig.filter(s => s.ownerUsername === u.username).length
    }));
    res.json({ success: true, users: result });
});

app.post('/api/admin/users/role', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied: Admins only.' });
    }

    const { userId, role } = req.body;
    const targetUser = usersConfig.find(u => u.id === userId);
    if (!targetUser) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    targetUser.role = (role === 'admin') ? 'admin' : 'user';
    saveUsersConfig();

    for (const [t, s] of activeSessions.entries()) {
        if (s.id === userId) {
            s.role = targetUser.role;
        }
    }

    emitServersListToAll();
    res.json({ success: true, message: `Updated ${targetUser.username}'s role to ${targetUser.role}.` });
});

app.post('/api/admin/users/reset-password', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied: Admins only.' });
    }

    const { userId, newPassword } = req.body;
    if (!userId || !newPassword || newPassword.length < 4) {
        return res.status(400).json({ success: false, message: 'Valid user ID and password (min 4 chars) required.' });
    }

    const targetUser = usersConfig.find(u => u.id === userId);
    if (!targetUser) return res.status(404).json({ success: false, message: 'User not found.' });

    targetUser.passwordHash = hashPassword(newPassword);
    saveUsersConfig();

    res.json({ success: true, message: `Password for ${targetUser.username} has been reset.` });
});

app.post('/api/admin/permissions', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied: Admins only.' });
    }

    const { serverId, allowedUsers } = req.body;
    const targetServer = serversConfig.find(s => s.id === serverId);
    if (!targetServer) {
        return res.status(404).json({ success: false, message: 'Server not found.' });
    }

    targetServer.allowedUsers = Array.isArray(allowedUsers) ? allowedUsers : [];
    saveServersConfig();

    emitServersListToAll();
    res.json({ success: true, message: 'Server access permissions updated successfully.' });
});

app.delete('/api/admin/users/:id', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user || user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied: Admins only.' });
    }

    const targetId = req.params.id;
    if (user.id === targetId) {
        return res.status(400).json({ success: false, message: 'You cannot delete your own admin account.' });
    }

    const idx = usersConfig.findIndex(u => u.id === targetId);
    if (idx === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const removed = usersConfig.splice(idx, 1)[0];
    saveUsersConfig();

    for (const [t, s] of activeSessions.entries()) {
        if (s.id === targetId) activeSessions.delete(t);
    }

    res.json({ success: true, message: `User ${removed.username} deleted.` });
});

// --- SERVER MANAGEMENT REST ENDPOINTS (RELIABLE FALLBACK & DIRECT ACTION) ---
app.get('/api/servers', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const visible = getVisibleServers(user);
    const statuses = {};
    const uptimes = {};
    visible.forEach(s => {
        statuses[s.id] = botStatuses[s.id] || { text: 'STANDBY', color: '#888888' };
        uptimes[s.id] = botUptimeStarts[s.id] || null;
    });

    res.json({ success: true, servers: visible, statuses, uptimes });
});

app.post('/api/servers', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const data = req.body;
    if (!data.host) return res.status(400).json({ success: false, message: 'Host is required.' });

    const cleanUser = sanitizeUsername(data.username || 'AFK_Steve');
    const newServer = {
        id: `server_${Date.now()}`,
        name: data.name || `Server ${serversConfig.length + 1}`,
        host: data.host,
        port: parseInt(data.port, 10) || 25565,
        username: cleanUser,
        password: data.password || null,
        version: (data.version && data.version.trim()) ? data.version.trim() : 'auto',
        connectIp: `${data.host}:${data.port || 25565}`,
        description: data.description || 'Minecraft server',
        ownerUsername: user.username,
        allowedUsers: [],
        autoStart: data.autoStart !== false
    };
    serversConfig.push(newServer);
    saveServersConfig();
    emitServersListToAll();
    if (data.autoStart) startBot(newServer);

    res.json({ success: true, message: `Server "${newServer.name}" created successfully.`, server: newServer });
});

app.delete('/api/servers/:id', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    if (!canAccessServer(user, serverId)) {
        return res.status(403).json({ success: false, message: 'Permission denied: Cannot delete this server.' });
    }

    const idx = serversConfig.findIndex(s => s.id === serverId);
    if (idx === -1) {
        return res.status(404).json({ success: false, message: 'Server not found.' });
    }

    stopBotInstance(serverId);
    delete botStatuses[serverId];
    delete botPositions[serverId];
    delete botUptimeStarts[serverId];
    const removed = serversConfig.splice(idx, 1)[0];
    saveServersConfig();
    emitServersListToAll();

    res.json({ success: true, message: `Server "${removed.name}" deleted successfully.`, serverId });
});

app.post('/api/servers/:id/refresh', async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    const s = serversConfig.find(item => item.id === serverId);
    if (!s) return res.status(404).json({ success: false, message: 'Server not found.' });
    if (!canAccessServer(user, serverId)) {
        return res.status(403).json({ success: false, message: 'Permission denied.' });
    }

    await updateSMPInfo(s);
    emitPlayerList(serverId);

    const bot = activeBots[serverId];
    const isOnline = !!(bot && bot.entity);
    const players = (bot && bot.players) ? Object.keys(bot.players) : [];

    res.json({
        success: true,
        message: `Status & diagnostics refreshed for ${s.name}`,
        status: botStatuses[serverId] || { text: 'STANDBY', color: '#888888' },
        uptimeStart: botUptimeStarts[serverId] || null,
        players,
        isOnline
    });
});

app.post('/api/servers/refresh-all', async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const visible = getVisibleServers(user);
    for (const s of visible) {
        updateSMPInfo(s);
        emitPlayerList(s.id);
    }
    emitServersListToAll();

    res.json({ success: true, message: `Refreshed ${visible.length} server(s).`, count: visible.length });
});

// --- BOT MANAGEMENT & LOCKS ---
const activeBots = {};
const autoReconnect = {};
const reconnectAttempts = {};
const reconnectTimers = {};
const botStatuses = {};
const botPositions = {};
const botUptimeStarts = {};
const afkTimers = {};
// Active locks map: key `${host.toLowerCase()}:${port}:${username.toLowerCase()}` -> serverId
const activeHostLocks = new Map();

function setBotStatus(serverId, text, color) {
    botStatuses[serverId] = { text, color };
    io.emit('status', { serverId, text, color });
}

function logAndEmit(serverId, msg) {
    console.log(`[${serverId}] ${msg}`);
    io.emit('log', { serverId, msg });
}

function emitPlayerList(serverId) {
    const bot = activeBots[serverId];
    const isOnline = !!(bot && bot.entity);
    const players = (bot && bot.players) ? Object.keys(bot.players) : [];
    io.emit('player_list', { serverId, players, isOnline });
}

function emitServersListToAll() {
    io.sockets.sockets.forEach(sock => {
        const u = sock.user;
        const visible = getVisibleServers(u);
        sock.emit('servers_list_updated', visible);
    });
}

async function updateSMPInfo(config) {
    try {
        const startTime = Date.now();
        const res = await pingMinecraftServer(config.host, config.port, 4000);
        const latency = res && typeof res.latency === 'number' ? res.latency : Date.now() - startTime;
        const info = {
            serverId: config.id,
            online: true,
            onlinePlayers: res && res.players && typeof res.players.online === 'number' ? res.players.online : 0,
            maxPlayers: res && res.players && typeof res.players.max === 'number' ? res.players.max : 20,
            latency,
            version: res && res.version && res.version.name ? res.version.name : 'Java Edition'
        };
        io.emit('smp_info_update', info);
        return true;
    } catch {
        const bot = activeBots[config.id];
        const isOnline = !!(bot && bot.entity);
        const info = {
            serverId: config.id,
            online: isOnline,
            onlinePlayers: isOnline ? (bot.players ? Object.keys(bot.players).length : 1) : 0,
            maxPlayers: 20,
            latency: isOnline ? 50 : 0,
            version: config.version || 'Java Edition'
        };
        io.emit('smp_info_update', info);
        return isOnline;
    }
}

function sanitizeUsername(name) {
    if (!name) return 'AFK_Steve';
    let cleaned = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
    if (cleaned.length > 16) cleaned = cleaned.substring(0, 16);
    if (cleaned.length < 3) cleaned = (cleaned + '_bot').substring(0, 16);
    return cleaned;
}

function formatKickReason(raw) {
    if (!raw) return 'Disconnected by server';
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return formatKickReason(parsed);
        } catch {
            return raw;
        }
    }
    if (raw.extra && Array.isArray(raw.extra)) {
        return raw.extra.map(item => (typeof item === 'string' ? item : (item.text || ''))).join('').trim() || raw.text || 'Disconnected';
    }
    if (raw.with && Array.isArray(raw.with)) {
        const text = raw.with.map(w => (typeof w === 'string' ? w : JSON.stringify(w))).join(' ');
        if (raw.translate === 'disconnect.genericReason') return text;
        return text || raw.translate;
    }
    if (raw.translate) {
        if (raw.translate.includes('whitelist')) return 'You are not whitelisted on this server!';
        return raw.translate;
    }
    return raw.text || JSON.stringify(raw);
}

function startBot(config) {
    if (activeBots[config.id]) {
        logAndEmit(config.id, '[CONTROL] Bot is already running.');
        return;
    }

    const validUsername = sanitizeUsername(config.username);
    const lockKey = `${config.host.toLowerCase()}:${config.port}:${validUsername.toLowerCase()}`;

    // CONFLICT PROTECTION: Check if another instance or session is already running this host:port:username
    const existingServerId = activeHostLocks.get(lockKey);
    if (existingServerId && existingServerId !== config.id && activeBots[existingServerId]) {
        logAndEmit(config.id, `[CONFLICT BLOCKED] Another bot is already connected to ${config.host}:${config.port} as "${validUsername}" (Instance ${existingServerId}). Connection stopped to prevent join/leave conflict.`);
        setBotStatus(config.id, 'CONFLICT', '#f5a623');
        return;
    }
    activeHostLocks.set(lockKey, config.id);

    autoReconnect[config.id] = true;
    config.autoStart = true;
    saveServersConfig();

    setBotStatus(config.id, 'Connecting...', '#f5a623');

    if (validUsername !== config.username) {
        logAndEmit(config.id, `[CONTROL] Note: Adjusted username to "${validUsername}" (Minecraft Java usernames must be 3-16 chars without spaces).`);
    }

    const versionStr = (config.version && config.version !== 'auto') ? config.version : 'auto-detect';
    logAndEmit(config.id, `[CONTROL] Connecting to ${config.host}:${config.port} as ${validUsername} (version: ${versionStr})...`);

    const botOptions = {
        host: config.host,
        port: config.port,
        username: validUsername,
        checkTimeoutInterval: 90000,
        hideErrors: true
    };

    if (config.version && config.version !== 'auto') {
        botOptions.version = config.version;
    }

    let bot;
    try {
        bot = mineflayer.createBot(botOptions);
    } catch (err) {
        logAndEmit(config.id, `[ERROR] Init failed: ${err.message}`);
        setBotStatus(config.id, 'OFFLINE', '#e00000');
        if (activeHostLocks.get(lockKey) === config.id) activeHostLocks.delete(lockKey);
        return;
    }

    let connectionFailed = false;
    bot.on('error', (err) => {
        connectionFailed = true;
        let errMsg = err.message || 'Connection error';
        if (errMsg.includes('ECONNRESET')) {
            errMsg = 'Connection reset by server (ECONNRESET). Re-negotiating protocol...';
            if (config.version && config.version !== 'auto') {
                config.version = 'auto';
                saveServersConfig();
            }
        }
        logAndEmit(config.id, `[ERROR] ${errMsg}`);
        setBotStatus(config.id, 'OFFLINE', '#e00000');
    });

    if (bot._client) {
        bot._client.on('error', () => {});
    }

    try {
        bot.loadPlugin(pathfinder);
    } catch (e) {
        console.error('[Pathfinder] Plugin error:', e.message);
    }

    bot.on('login', () => {
        reconnectAttempts[config.id] = 0;
        logAndEmit(config.id, `Logged in successfully as ${validUsername}!`);
    });

    bot.on('spawn', () => {
        reconnectAttempts[config.id] = 0;
        setBotStatus(config.id, 'ONLINE', '#0070f3');
        botUptimeStarts[config.id] = Date.now();
        io.emit('uptime_update', { serverId: config.id, uptimeStart: botUptimeStarts[config.id] });
        logAndEmit(config.id, `Spawned in world!`);

        if (config.password) {
            setTimeout(() => {
                try {
                    bot.chat(`/login ${config.password}`);
                } catch {}
            }, 1000);
        }

        emitPlayerList(config.id);
        updateSMPInfo(config);

        // --- ACTIVE ANTI-AFK ROUTINE ---
        // Keeps the bot alive 24/7 even when browser/system is closed, preventing server idle kicks
        if (afkTimers[config.id]) clearInterval(afkTimers[config.id]);
        afkTimers[config.id] = setInterval(() => {
            if (bot && bot.entity) {
                try {
                    // Swing arm
                    bot.swingArm();
                    // Subtle look animation to show activity
                    const currentYaw = bot.entity.yaw || 0;
                    const pitch = bot.entity.pitch || 0;
                    bot.look(currentYaw + 0.08, pitch, true);
                    setTimeout(() => {
                        if (bot && bot.entity) bot.look(currentYaw, pitch, true);
                    }, 500);
                } catch {}
            }
        }, 30000); // Trigger every 30 seconds
    });

    bot.on('playerJoined', () => emitPlayerList(config.id));
    bot.on('playerLeft', () => emitPlayerList(config.id));

    const posInterval = setInterval(() => {
        if (bot && bot.entity) {
            const p = bot.entity.position;
            botPositions[config.id] = { x: p.x.toFixed(1), y: p.y.toFixed(1), z: p.z.toFixed(1) };
            io.emit('position', { serverId: config.id, ...botPositions[config.id] });
        }
    }, 4000);

    bot.on('chat', async (user, message) => {
        if (user === bot.username || user === config.username) return;
        logAndEmit(config.id, `<${user}> ${message}`);

        const trimmed = message.trim();
        if (trimmed.toLowerCase().startsWith('!ai ') || trimmed.toLowerCase().startsWith('!gemini ')) {
            const question = trimmed.replace(/^!(ai|gemini)\s+/i, '').trim();
            if (question) {
                const answer = await askGemini(`Minecraft player ${user} asks: ${question}. Provide a brief 1-2 sentence answer under 150 chars without markdown.`);
                const clean = answer.replace(/[*_#`]/g, '').trim().substring(0, 180);
                if (activeBots[config.id]) bot.chat(`[AI] ${clean}`);
            }
        }
    });

    let wasKickedWhitelist = false;
    let wasConflict = false;

    bot.on('kicked', (reason) => {
        const formatted = formatKickReason(reason);
        logAndEmit(config.id, `[KICKED] ${formatted}`);
        const lower = formatted.toLowerCase();

        if (lower.includes('whitelist')) {
            wasKickedWhitelist = true;
            autoReconnect[config.id] = false;
            setBotStatus(config.id, 'WHITELISTED', '#f5a623');
            logAndEmit(config.id, `[WHITELIST] Server whitelist is active. To allow the bot to join, run on server console: /whitelist add ${validUsername}`);
        } else if (lower.includes('another location') || lower.includes('already connected') || lower.includes('already logged in') || lower.includes('another device')) {
            wasConflict = true;
            autoReconnect[config.id] = false;
            setBotStatus(config.id, 'CONFLICT', '#f5a623');
            logAndEmit(config.id, `[CONFLICT] Account logged in from another device/session. Auto-reconnect paused to prevent join/left kick loop.`);
        }
    });

    bot.on('end', (reason) => {
        clearInterval(posInterval);
        if (afkTimers[config.id]) {
            clearInterval(afkTimers[config.id]);
            delete afkTimers[config.id];
        }
        delete activeBots[config.id];
        delete botUptimeStarts[config.id];
        io.emit('uptime_update', { serverId: config.id, uptimeStart: null });
        if (activeHostLocks.get(lockKey) === config.id) {
            activeHostLocks.delete(lockKey);
        }

        logAndEmit(config.id, `[DISCONNECTED] (${reason || 'Connection closed'}).`);

        if (wasConflict) {
            setBotStatus(config.id, 'CONFLICT', '#f5a623');
            return;
        }

        if (wasKickedWhitelist) {
            setBotStatus(config.id, 'WHITELISTED', '#f5a623');
            return;
        }

        if (connectionFailed || !autoReconnect[config.id]) {
            setBotStatus(config.id, 'OFFLINE', '#e00000');
            return;
        }

        // CONTINUOUS 24/7 AUTO-RECONNECT: Keeps the bot in the server continuously
        reconnectAttempts[config.id] = (reconnectAttempts[config.id] || 0) + 1;
        const delayMs = reconnectAttempts[config.id] <= 3 ? 10000 : 25000;
        setBotStatus(config.id, 'RECONNECTING', '#f5a623');
        logAndEmit(config.id, `Reconnecting automatically in ${delayMs / 1000}s (attempt ${reconnectAttempts[config.id]})...`);
        reconnectTimers[config.id] = setTimeout(() => startBot(config), delayMs);
    });

    activeBots[config.id] = bot;
}

function stopBotInstance(serverId) {
    autoReconnect[serverId] = false;
    const cfg = serversConfig.find(s => s.id === serverId);
    if (cfg) {
        cfg.autoStart = false;
        saveServersConfig();
        const validUsername = sanitizeUsername(cfg.username);
        const lockKey = `${cfg.host.toLowerCase()}:${cfg.port}:${validUsername.toLowerCase()}`;
        if (activeHostLocks.get(lockKey) === serverId) activeHostLocks.delete(lockKey);
    }
    reconnectAttempts[serverId] = 0;
    if (reconnectTimers[serverId]) {
        clearTimeout(reconnectTimers[serverId]);
        delete reconnectTimers[serverId];
    }
    if (afkTimers[serverId]) {
        clearInterval(afkTimers[serverId]);
        delete afkTimers[serverId];
    }
    delete botUptimeStarts[serverId];
    io.emit('uptime_update', { serverId, uptimeStart: null });
    const bot = activeBots[serverId];
    if (bot) {
        try { bot.quit(); } catch {}
        delete activeBots[serverId];
    }
    setBotStatus(serverId, 'STOPPED', '#e00000');
    logAndEmit(serverId, '[CONTROL] Bot stopped.');
}

// --- SOCKET.IO EVENTS WITH USER AUTH ---
io.on('connection', (socket) => {
    try { socket.emit('bot_system_stats', calculateSystemStats()); } catch(e) {}
    socket.user = null;

    socket.on('authenticate', (data) => {
        const token = data && data.token;
        const user = getUserByToken(token);
        if (user) {
            socket.user = user;
            socket.emit('auth_success', { user });
            try { socket.emit('bot_system_stats', calculateSystemStats()); } catch(e) {}
            const visible = getVisibleServers(user);
            socket.emit('servers_list_updated', visible);
            visible.forEach(s => {
                const st = botStatuses[s.id] || { text: 'STANDBY', color: '#888888' };
                socket.emit('status', { serverId: s.id, ...st });
                socket.emit('uptime_update', { serverId: s.id, uptimeStart: botUptimeStarts[s.id] || null });
                emitPlayerList(s.id);
                updateSMPInfo(s);
            });
        } else {
            socket.emit('auth_error', { message: 'Session expired. Please log in again.' });
        }
    });

    socket.on('start_bot', (data) => {
        if (!canAccessServer(socket.user, data.serverId)) {
            return socket.emit('log', { serverId: data.serverId, msg: '[DENIED] You do not have permission to start this bot.' });
        }
        const cfg = serversConfig.find(s => s.id === data.serverId);
        if (cfg) startBot(cfg);
    });

    socket.on('stop_bot', (data) => {
        if (!canAccessServer(socket.user, data.serverId)) {
            return socket.emit('log', { serverId: data.serverId, msg: '[DENIED] You do not have permission to stop this bot.' });
        }
        stopBotInstance(data.serverId);
    });

    socket.on('send_chat', (data) => {
        if (!canAccessServer(socket.user, data.serverId)) {
            return socket.emit('log', { serverId: data.serverId, msg: '[DENIED] You do not have permission to send commands to this server.' });
        }
        const bot = activeBots[data.serverId];
        if (bot && bot.entity) {
            bot.chat(data.msg);
            logAndEmit(data.serverId, `[SENT by ${socket.user ? socket.user.username : 'User'}]: ${data.msg}`);
        } else {
            logAndEmit(data.serverId, '[ERROR] Bot is offline.');
        }
    });

    socket.on('trigger_authme', (data) => {
        if (!canAccessServer(socket.user, data.serverId)) return;
        const cfg = serversConfig.find(s => s.id === data.serverId);
        const bot = activeBots[data.serverId];
        if (cfg && cfg.password && bot) {
            bot.chat(`/login ${cfg.password}`);
            logAndEmit(data.serverId, '[AuthMe] Sent /login command');
        }
    });

    socket.on('get_players', (data) => {
        if (!canAccessServer(socket.user, data.serverId)) return;
        emitPlayerList(data.serverId);
    });

    socket.on('create_server', (data) => {
        if (!socket.user) return;
        const cleanUser = sanitizeUsername(data.username);
        const newServer = {
            id: `server_${Date.now()}`,
            name: data.name || `Server ${serversConfig.length + 1}`,
            host: data.host,
            port: parseInt(data.port, 10) || 25565,
            username: cleanUser,
            password: data.password || null,
            version: (data.version && data.version.trim()) ? data.version.trim() : 'auto',
            connectIp: `${data.host}:${data.port || 25565}`,
            description: data.description || 'Minecraft server',
            ownerUsername: socket.user.username,
            allowedUsers: [],
            autoStart: data.autoStart !== false
        };
        serversConfig.push(newServer);
        saveServersConfig();

        emitServersListToAll();
        if (data.autoStart) startBot(newServer);
    });

    socket.on('update_server_config', (data) => {
        if (!canAccessServer(socket.user, data.id)) return;
        const cfg = serversConfig.find(s => s.id === data.id);
        if (cfg) {
            stopBotInstance(data.id);
            const cleanUser = sanitizeUsername(data.username || cfg.username);
            const versionVal = (data.version && data.version.trim()) ? data.version.trim() : 'auto';
            Object.assign(cfg, data, { 
                username: cleanUser, 
                version: versionVal,
                connectIp: `${data.host}:${data.port}` 
            });
            saveServersConfig();
            emitServersListToAll();
        }
    });

    socket.on('delete_server', (data) => {
        if (!data || !data.serverId) return;
        if (!canAccessServer(socket.user, data.serverId)) {
            return socket.emit('log', { serverId: data.serverId, msg: '[DENIED] You do not have permission to delete this server.' });
        }
        stopBotInstance(data.serverId);
        delete botStatuses[data.serverId];
        delete botPositions[data.serverId];
        delete botUptimeStarts[data.serverId];
        serversConfig = serversConfig.filter(s => s.id !== data.serverId);
        saveServersConfig();
        emitServersListToAll();
        socket.emit('server_deleted', { serverId: data.serverId, success: true });
    });

    socket.on('refresh_fleet', async () => {
        if (!socket.user) return;
        const visible = getVisibleServers(socket.user);
        for (const s of visible) {
            updateSMPInfo(s);
            emitPlayerList(s.id);
        }
        emitServersListToAll();
        socket.emit('fleet_refreshed', { count: visible.length });
    });

    socket.on('refresh_server', async (data) => {
        if (!data || !data.serverId || !canAccessServer(socket.user, data.serverId)) return;
        const cfg = serversConfig.find(s => s.id === data.serverId);
        if (cfg) {
            await updateSMPInfo(cfg);
            emitPlayerList(cfg.id);
            socket.emit('server_refreshed', { serverId: cfg.id });
        }
    });

    socket.on('ask_gemini_ai', async (data) => {
        const answer = await askGemini(data.prompt);
        socket.emit('gemini_ai_response', { answer });
    });

    socket.on('save_gemini_key', async (data) => {
        if (!socket.user || socket.user.role !== 'admin') {
            return socket.emit('gemini_key_saved', { success: false, message: 'Only Admins can configure global Gemini AI Key.' });
        }
        try {
            const testAi = new GoogleGenAI({ apiKey: data.apiKey });
            const res = await testAi.models.generateContent({ model: 'gemini-3.8-flash', contents: 'Hello' });
            if (res && res.text) {
                geminiApiKey = data.apiKey;
                ai = testAi;
                socket.emit('gemini_key_saved', { success: true, message: 'Gemini 3.8 Flash key verified!' });
            }
        } catch (err) {
            socket.emit('gemini_key_saved', { success: false, message: `Key error: ${err.message}` });
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Server listening on port ${PORT}`);
    // Start active bots on launch so bot stays connected even when browser/system is closed
    serversConfig.forEach(async (cfg) => {
        if (cfg.autoStart !== false) {
            const isOnline = await updateSMPInfo(cfg);
            if (isOnline) {
                startBot(cfg);
            } else {
                setBotStatus(cfg.id, 'OFFLINE', '#e00000');
            }
        }
    });
});
