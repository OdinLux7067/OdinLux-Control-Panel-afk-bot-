require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
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
const TMP_USERS_FILE = path.join('/tmp', 'users.json');
let usersConfig = [];
const activeSessions = new Map(); // token -> user object
const JWT_SECRET = process.env.JWT_SECRET || 'odinlux_jwt_master_secret_2026';

function hashPassword(password) {
    return crypto.createHash('sha256').update(password + '_odinlux_salt_2026').digest('hex');
}

function generateToken(user) {
    if (!user) {
        return crypto.randomBytes(32).toString('hex');
    }
    const payload = {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        iat: Date.now()
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
    return `${payloadB64}.${signature}`;
}

function loadUsersConfig() {
    try {
        if (fs.existsSync(TMP_USERS_FILE)) {
            const data = fs.readFileSync(TMP_USERS_FILE, 'utf8');
            usersConfig = JSON.parse(data);
            return;
        }
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(USERS_FILE, 'utf8');
            usersConfig = JSON.parse(data);
            return;
        }
    } catch (err) {
        console.error('[USERS] Error loading users.json:', err.message);
    }
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
    saveUsersConfig();
}
loadUsersConfig();

function saveUsersConfig() {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersConfig, null, 2));
    } catch (err) {
        try {
            fs.writeFileSync(TMP_USERS_FILE, JSON.stringify(usersConfig, null, 2));
        } catch (e) {
            console.error('[USERS] Error saving users.json to /tmp:', e.message);
        }
    }
}

function getUserByToken(token) {
    if (!token) return null;
    if (activeSessions.has(token)) {
        return activeSessions.get(token);
    }
    // Verify signed HMAC token
    try {
        const parts = token.split('.');
        if (parts.length === 2) {
            const [payloadB64, signature] = parts;
            const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(payloadB64).digest('base64url');
            if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
                const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
                const existing = usersConfig.find(u => u.id === payload.id || u.username.toLowerCase() === payload.username.toLowerCase());
                if (existing) {
                    const sessionUser = { id: existing.id, username: existing.username, email: existing.email, role: existing.role };
                    activeSessions.set(token, sessionUser);
                    return sessionUser;
                }
                const sessionUser = { id: payload.id, username: payload.username, email: payload.email, role: payload.role || 'user' };
                activeSessions.set(token, sessionUser);
                return sessionUser;
            }
        }
    } catch (e) {
        // invalid signature or json
    }
    return null;
}

// --- SERVER CONFIGURATIONS ---
const SERVERS_FILE = path.join(__dirname, 'servers.json');
const TMP_SERVERS_FILE = path.join('/tmp', 'servers.json');
let serversConfig = [];

function loadServersConfig() {
    try {
        if (fs.existsSync(TMP_SERVERS_FILE)) {
            const data = fs.readFileSync(TMP_SERVERS_FILE, 'utf8');
            serversConfig = JSON.parse(data);
            return;
        }
        if (fs.existsSync(SERVERS_FILE)) {
            const data = fs.readFileSync(SERVERS_FILE, 'utf8');
            serversConfig = JSON.parse(data);
            return;
        }
    } catch (err) {
        console.error('[CONFIG] Error loading servers.json:', err.message);
    }
    if (!Array.isArray(serversConfig) || serversConfig.length === 0) {
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
                autoStart: false
            }
        ];
    }
}
loadServersConfig();

function saveServersConfig() {
    try {
        fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversConfig, null, 2));
    } catch (err) {
        try {
            fs.writeFileSync(TMP_SERVERS_FILE, JSON.stringify(serversConfig, null, 2));
        } catch (e) {
            console.error('[CONFIG] Error saving servers.json to /tmp:', e.message);
        }
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
const GEMINI_CONFIG_FILE = path.join(__dirname, 'gemini_config.json');
const TMP_GEMINI_CONFIG_FILE = path.join('/tmp', 'gemini_config.json');

function loadGeminiApiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
    try {
        if (fs.existsSync(GEMINI_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(GEMINI_CONFIG_FILE, 'utf8'));
            if (data && data.apiKey) return data.apiKey.trim();
        }
    } catch {}
    try {
        if (fs.existsSync(TMP_GEMINI_CONFIG_FILE)) {
            const data = JSON.parse(fs.readFileSync(TMP_GEMINI_CONFIG_FILE, 'utf8'));
            if (data && data.apiKey) return data.apiKey.trim();
        }
    } catch {}
    return '';
}

function saveGeminiApiKey(key) {
    const payload = JSON.stringify({ apiKey: (key || '').trim(), updatedAt: Date.now() }, null, 2);
    try {
        fs.writeFileSync(GEMINI_CONFIG_FILE, payload);
    } catch {
        try {
            fs.writeFileSync(TMP_GEMINI_CONFIG_FILE, payload);
        } catch {}
    }
}

let geminiApiKey = loadGeminiApiKey();
let ai = geminiApiKey ? new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
        headers: {
            'User-Agent': 'aistudio-build'
        }
    }
}) : null;

// Fast in-memory cache for instant answers (sub-millisecond)
const aiResponseCache = new Map();

function getMinecraftKnowledge(prompt) {
    if (!prompt) return '🤖 Usage: !ai <question> — e.g. "!ai best y level for diamond" or "!ai how to brew speed potion"';
    const q = prompt.toLowerCase().trim();
    if (q === '!ai' || q === '!gemini' || q === 'help') return '🤖 Usage: !ai <question> — e.g. "!ai best y level for diamond" or "!ai how to brew speed potion"';

    // 1. Diamonds & Mining
    if (q.includes('diamond') || q.includes('mine diamond') || q.includes('y level') || q.includes('mining')) {
        return '💎 Diamonds (1.18-1.21+): Optimal Y = -58 to -59 (just above bedrock). Branch mine 2x1 with 3-block gaps, or explore deepslate caves. Fortune III yields up to 4 diamonds!';
    }
    // 2. Netherite & Ancient Debris
    if (q.includes('ancient debris') || q.includes('debris') || q.includes('netherite') || q.includes('netherite upgrade')) {
        return '🔥 Netherite: Mine Ancient Debris at Nether Y = 14 using Beds or TNT. Smelt into Scrap (4 Scraps + 4 Gold = 1 Ingot). Upgrade diamond gear at Smithing Table with Netherite Template!';
    }
    // 3. Other Ores (Iron, Gold, Copper, Coal, Lapis, Emerald)
    if (q.includes('iron') && (q.includes('level') || q.includes('ore') || q.includes('mine') || q.includes('find'))) {
        return '⛏️ Iron: Best at Y = 16 (or high in mountains Y = 232). Smelt in Blast Furnace for 2x faster output.';
    }
    if (q.includes('gold') && (q.includes('level') || q.includes('ore') || q.includes('mine') || q.includes('find'))) {
        return '🪙 Gold: Best at Y = -16 globally, or anywhere Y = 32 to 256 in Badlands (Mesa) biomes!';
    }
    if (q.includes('copper') && (q.includes('level') || q.includes('ore') || q.includes('mine') || q.includes('find'))) {
        return '🧱 Copper: Best at Y = 48, especially plentiful in Dripstone Caves.';
    }
    if (q.includes('emerald') && (q.includes('level') || q.includes('ore') || q.includes('mine') || q.includes('find'))) {
        return '🟩 Emeralds: Only generate high in Windswept / Mountain biomes (peaks at Y = 232+), or trade with Villagers!';
    }
    if (q.includes('lapis') || q.includes('redstone ore')) {
        return '🔴 Redstone & Lapis: Redstone peaks at Y = -58 to -64 (deepslate). Lapis peaks at Y = 0 (concentrated underground).';
    }

    // 4. Potions & Brewing
    if (q.includes('brew') || q.includes('potion')) {
        if (q.includes('speed') || q.includes('swift')) return '⚡ Potion of Speed: Awkward Potion (Water + Nether Wart) + Sugar. Add Redstone for 8 mins, or Glowstone for Speed II.';
        if (q.includes('strength')) return '💪 Potion of Strength: Awkward Potion + Blaze Powder. Add Glowstone for Strength II (+3 damage!).';
        if (q.includes('fire res') || q.includes('fire resistance')) return '🛡️ Potion of Fire Resistance: Awkward Potion + Magma Cream. Add Redstone for 8 minutes of total lava immunity!';
        if (q.includes('night vision')) return '👁️ Potion of Night Vision: Awkward Potion + Golden Carrot. Add Redstone for 8 minutes.';
        if (q.includes('invisib')) return '👻 Potion of Invisibility: Potion of Night Vision + Fermented Spider Eye. Unequip armor to be fully hidden!';
        if (q.includes('heal') || q.includes('healing')) return '❤️ Potion of Healing: Awkward Potion + Glistering Melon. Add Glowstone for Instant Health II.';
        if (q.includes('water breath') || q.includes('conduit')) return '🫧 Water Breathing: Awkward Potion + Pufferfish. Add Redstone for 8 minutes.';
        if (q.includes('regen') || q.includes('regeneration')) return '💖 Potion of Regeneration: Awkward Potion + Ghast Tear.';
        if (q.includes('slow fall')) return '🪶 Potion of Slow Falling: Awkward Potion + Phantom Membrane. Completely prevents fall damage!';
        if (q.includes('weakness')) return '🧪 Potion of Weakness: Water Bottle + Fermented Spider Eye (no nether wart needed!). Add Gunpowder for Splash (cures zombie villagers).';
        return '🧪 Brewing Base: 1) Water Bottle + Nether Wart = Awkward Potion. 2) Add ingredient: Sugar (Speed), Blaze (Strength), Magma Cream (Fire Res), Golden Carrot (Night Vision). Redstone = longer, Glowstone = tier II, Gunpowder = Splash!';
    }

    // 5. Enchantments
    if (q.includes('enchant') || q.includes('best enchant')) {
        if (q.includes('sword') || q.includes('weapon')) return '🗡️ Best Sword Enchants: Sharpness V, Looting III, Sweeping Edge III, Unbreaking III, Mending, Fire Aspect II.';
        if (q.includes('pickaxe') || q.includes('pick')) return '⛏️ Best Pickaxe Enchants: Efficiency V, Fortune III (or Silk Touch), Unbreaking III, Mending.';
        if (q.includes('armor') || q.includes('gear')) return '🛡️ Best Armor: Protection IV, Unbreaking III, Mending. Boots: Feather Falling IV, Depth Strider III. Helmet: Respiration III, Aqua Affinity.';
        if (q.includes('bow')) return '🏹 Best Bow Enchants: Power V, Infinity (or Mending), Flame, Punch II, Unbreaking III.';
        if (q.includes('crossbow')) return '🎯 Crossbow: Quick Charge III, Multishot (or Piercing IV), Unbreaking III, Mending.';
        if (q.includes('mending') && q.includes('infinity')) return '💡 Tip: Bows cannot have both Mending and Infinity. Choose Infinity for infinite standard arrows, or Mending for tip arrows!';
        if (q.includes('trident')) return '🔱 Trident: Loyalty III + Channeling (thunderstorms), Impaling V, Unbreaking III, Mending. Or Riptide III for launching in rain!';
        if (q.includes('elytra')) return '🪽 Elytra: Unbreaking III and Mending are the only enchantments. Repair with Phantom Membranes in anvil!';
        return '🛡️ Top Enchants: Protection IV (Armor), Sharpness V + Looting III (Sword), Efficiency V + Fortune III (Pickaxe), Unbreaking III + Mending on everything!';
    }

    // 6. Redstone Contraptions
    if (q.includes('sorter') || q.includes('sorting')) {
        return '⚡ Redstone Item Sorter: Hopper line facing comparator -> 3 redstone dust -> repeater into block with redstone torch locking lower hopper. Hopper filter: 41 desired items + 4 named dummy items!';
    }
    if (q.includes('clock') || q.includes('repeater clock') || q.includes('redstone clock')) {
        return '⏱️ Redstone Clock: 1) Comparator in subtract mode with dust loop from front to side. 2) Two repeaters facing opposite directions with redstone dust at each end.';
    }
    if (q.includes('door') || q.includes('piston door')) {
        return '🚪 2x2 Piston Door: 4 Sticky Pistons facing inward. Power pistons with redstone torches on blocks, run redstone wire under floor to pressure plates.';
    }
    if (q.includes('flying machine')) {
        return '✈️ Flying Machine: 2 Observers, 2 Sticky Pistons, 4 Slime/Honey blocks facing opposite directions. Trigger observer to start!';
    }

    // 7. Crafting Recipes
    if (q.includes('shield')) return '🛡️ Shield Recipe: 1 Iron Ingot at top-middle + 6 Wooden Planks in a Y-shape around it in crafting table.';
    if (q.includes('anvil')) return '🔨 Anvil Recipe: 3 Iron Blocks across top row + 4 Iron Ingots (1 middle, 3 bottom row). Total 31 iron ingots!';
    if (q.includes('beacon')) return '✨ Beacon Recipe: 5 Glass + 1 Nether Star in center + 3 Obsidian at bottom. Place atop 3x3 to 9x9 mineral pyramid.';
    if (q.includes('hopper')) return '📥 Hopper Recipe: 5 Iron Ingots in V-shape + 1 Wooden Chest in the center.';
    if (q.includes('smithing table')) return '⚒️ Smithing Table Recipe: 2 Iron Ingots on top row + 4 Wooden Planks in 2x2 below.';
    if (q.includes('blast furnace')) return '🔥 Blast Furnace: 1 Furnace in center + 3 Smooth Stone on bottom row + 5 Iron Ingots around it. Smelts ores 2x faster!';
    if (q.includes('smoker')) return '🥩 Smoker: 1 Furnace in center + 4 Wood logs/wood around it in cross shape. Cooks food 2x faster!';
    if (q.includes('piston')) return '🧱 Piston: 3 Wood Planks top row, 4 Cobblestone on sides, 1 Iron Ingot center, 1 Redstone bottom. Add Slimeball on top for Sticky Piston.';

    // 8. Mobs, Bosses & Survival
    if (q.includes('warden')) {
        return '🔊 Warden Tips: Sneak on Wool to avoid vibration sensors. Triggering Sculk Shriekers 4 times summons it. Weak to ranged/height, but sonic boom penetrates blocks/armor!';
    }
    if (q.includes('wither')) {
        return '💀 Wither Fight: 4 Soul Sand in T-shape + 3 Wither Skeleton Skulls. Trap under bedrock roof in Nether for easy kill, or use Smite V sword and Golden Apples!';
    }
    if (q.includes('dragon') || q.includes('ender dragon')) {
        return '🐉 Ender Dragon: Destroy End Crystals first with arrows/snowballs (climb iron-caged ones). When perched over bedrock portal, deal melee damage or explode beds on head!';
    }
    if (q.includes('villager') || q.includes('cure')) {
        return '👨‍🌾 Cure Zombie Villager: 1) Throw Splash Potion of Weakness. 2) Feed Golden Apple. Wait 3-5 mins while it shivers. Unlocks permanent 1-emerald trade discounts!';
    }
    if (q.includes('nether portal') || q.includes('portal') || q.includes('coords') || q.includes('math')) {
        return '🌌 Nether Portal Math: 1 Nether block = 8 Overworld blocks. Divide Overworld X & Z coords by 8 to find exact Nether placement! Minimum frame: 10 Obsidian (2x3 opening).';
    }
    if (q.includes('food') || q.includes('hunger') || q.includes('saturation')) {
        return '🥩 Best Food: Golden Carrots offer the highest saturation (14.4 points) for instant regeneration. Steak and Cooked Porkchops are 2nd best (12.8 saturation).';
    }
    if (q.includes('tame') || q.includes('breed')) {
        return '🐾 Taming: Wolf (Bones to tame, meat to breed) | Cat (Raw Cod/Salmon while sneaking) | Horse (Ride repeatedly then Saddle) | Axolotl (Bucket of Tropical Fish) | Fox (Sweet Berries).';
    }
    if (q.includes('command') || q.includes('op') || q.includes('admin')) {
        return '⚙️ Admin Commands: /gamemode creative/survival, /tp [player] [x y z], /give @p [item] [count], /whitelist add [player], /locate structure [name], /weather clear.';
    }

    // Default friendly guide
    return '🤖 Minecraft Assistant: Ask about mining diamonds/netherite, brewing potions, enchantments, redstone sorters, crafting, or admin commands!';
}

async function askGemini(prompt, user) {
    if (!prompt) return '🤖 Usage: !ai <question>';
    const trimmed = prompt.trim();
    const cacheKey = trimmed.toLowerCase();

    // Check fast cache first (< 1ms)
    if (aiResponseCache.has(cacheKey)) {
        return aiResponseCache.get(cacheKey);
    }

    // Instant knowledge check for very common queries
    const quickKnowledge = getMinecraftKnowledge(trimmed);
    const isDefaultFallback = quickKnowledge.startsWith('🤖 Minecraft Assistant: Ask about');

    // If Gemini client is active, attempt API call with a strict 4.5-second timeout
    if (ai) {
        try {
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), 4500)
            );

            const generatePromise = ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: `You are an expert Minecraft assistant and server admin. Answer concisely, practically, and accurately in 1-2 short sentences (under 160 characters) without markdown or asterisks:\n\nPlayer question: ${trimmed}`,
                config: {
                    thinkingConfig: { thinkingLevel: 'LOW' }
                }
            });

            const response = await Promise.race([generatePromise, timeoutPromise]);
            if (response && response.text) {
                const clean = response.text.replace(/[*_#`\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
                if (clean.length > 0) {
                    // Cache the result
                    if (aiResponseCache.size > 200) {
                        const firstKey = aiResponseCache.keys().next().value;
                        aiResponseCache.delete(firstKey);
                    }
                    aiResponseCache.set(cacheKey, clean);
                    return clean;
                }
            }
        } catch (err) {
            // Log briefly without breaking
            if (err.message !== 'TIMEOUT_EXCEEDED') {
                console.error('[Gemini AI] Query fallback:', err.message);
            }
        }
    }

    // Instant knowledge base fallback
    return quickKnowledge;
}

// --- MINECRAFT PING ---
function pingMinecraftServer(host, port, timeout = 1500) {
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

// Public ingress origin tracker to keep Cloud Run / Web container alive 24/7
let detectedPublicOrigin = null;
app.use((req, res, next) => {
    try {
        const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (host && !host.includes('127.0.0.1') && !host.includes('localhost')) {
            detectedPublicOrigin = `${proto}://${host}`;
        }
    } catch {}
    next();
});

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

        const sessionUser = { id: newUser.id, username: newUser.username, email: newUser.email, role: newUser.role };
        const token = generateToken(sessionUser);
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

        const sessionUser = { id: user.id, username: user.username, email: user.email, role: user.role };
        const token = generateToken(sessionUser);
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
        return bot && bot.entity && bot._client && !bot._client.ended;
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
        const bot = activeBots[s.id];
        const isTrulyOnline = !!(bot && bot.entity && bot._client && !bot._client.ended);
        if (isTrulyOnline) {
            statuses[s.id] = { text: 'ONLINE', color: '#0070f3' };
            uptimes[s.id] = botUptimeStarts[s.id] || Date.now();
        } else if (botStatuses[s.id] && botStatuses[s.id].text === 'Connecting...') {
            statuses[s.id] = { text: 'Connecting...', color: '#f5a623' };
            uptimes[s.id] = null;
        } else if (botStatuses[s.id] && botStatuses[s.id].text === 'RECONNECTING') {
            statuses[s.id] = { text: 'RECONNECTING', color: '#f5a623' };
            uptimes[s.id] = null;
        } else if (botStatuses[s.id] && (botStatuses[s.id].text === 'IN USE' || botStatuses[s.id].text === 'WHITELISTED' || botStatuses[s.id].text === 'DNS_ERROR' || botStatuses[s.id].text === 'OFFLINE')) {
            statuses[s.id] = botStatuses[s.id];
            uptimes[s.id] = null;
        } else {
            statuses[s.id] = { text: 'STANDBY', color: '#888888' };
            botStatuses[s.id] = statuses[s.id];
            uptimes[s.id] = null;
        }
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
        id: data.id || `server_${Date.now()}`,
        name: data.name || `Server ${serversConfig.length + 1}`,
        host: data.host.trim(),
        port: parseInt(data.port, 10) || 25565,
        username: cleanUser,
        password: data.password ? data.password.trim() : null,
        version: (data.version && data.version.trim()) ? data.version.trim() : 'auto',
        connectIp: `${data.host.trim()}:${data.port || 25565}`,
        description: data.description ? data.description.trim() : 'Minecraft server',
        ownerUsername: user.username,
        allowedUsers: [],
        autoStart: data.autoStart !== false
    };
    serversConfig.push(newServer);
    saveServersConfig();
    emitServersListToAll();
    if (newServer.autoStart) startBot(newServer);

    res.json({
        success: true,
        message: `Server "${newServer.name}" created successfully.`,
        server: newServer,
        servers: getVisibleServers(user)
    });
});

app.put('/api/servers/:id', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    if (!canAccessServer(user, serverId)) {
        return res.status(403).json({ success: false, message: 'Permission denied: Cannot edit this server.' });
    }

    const s = serversConfig.find(item => item.id === serverId);
    if (!s) return res.status(404).json({ success: false, message: 'Server not found.' });

    const data = req.body;
    if (data.name) s.name = data.name.trim();
    if (data.host) s.host = data.host.trim();
    if (data.port) s.port = parseInt(data.port, 10) || 25565;
    if (data.username) s.username = sanitizeUsername(data.username);
    if (data.password !== undefined) s.password = data.password ? data.password.trim() : null;
    if (data.version) s.version = data.version.trim();
    if (data.description !== undefined) s.description = data.description ? data.description.trim() : '';
    s.connectIp = `${s.host}:${s.port}`;
    if (data.autoStart !== undefined) s.autoStart = !!data.autoStart;

    saveServersConfig();
    emitServersListToAll();

    res.json({
        success: true,
        message: `Server "${s.name}" updated successfully.`,
        server: s,
        servers: getVisibleServers(user)
    });
});

app.post('/api/servers/:id/start', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    if (!canAccessServer(user, serverId)) return res.status(403).json({ success: false, message: 'Permission denied.' });

    const s = serversConfig.find(item => item.id === serverId);
    if (!s) return res.status(404).json({ success: false, message: 'Server not found.' });

    startBot(s);
    res.json({ success: true, message: `Bot started for ${s.name}.` });
});

app.post('/api/servers/:id/stop', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    if (!canAccessServer(user, serverId)) return res.status(403).json({ success: false, message: 'Permission denied.' });

    stopBotInstance(serverId);
    res.json({ success: true, message: 'Bot stopped.' });
});

app.post('/api/servers/:id/authme', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    if (!canAccessServer(user, serverId)) return res.status(403).json({ success: false, message: 'Permission denied.' });

    const cfg = serversConfig.find(item => item.id === serverId);
    const bot = activeBots[serverId];
    if (bot && cfg && cfg.password) {
        bot.chat(`/login ${cfg.password}`);
        logAndEmit(serverId, '[AuthMe] Sent /login command');
        return res.json({ success: true, message: 'AuthMe login command sent.' });
    }
    res.status(400).json({ success: false, message: 'Bot offline or no password configured.' });
});

app.post('/api/servers/:id/cmd', (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
    const user = getUserByToken(token);
    if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const serverId = req.params.id;
    if (!canAccessServer(user, serverId)) return res.status(403).json({ success: false, message: 'Permission denied.' });

    const msg = req.body && req.body.msg;
    if (!msg) return res.status(400).json({ success: false, message: 'Message is required.' });

    const bot = activeBots[serverId];
    if (bot) {
        bot.chat(msg);
        logAndEmit(serverId, `[SENT] ${msg}`);
        return res.json({ success: true, message: 'Message sent.' });
    }
    res.status(400).json({ success: false, message: 'Bot is offline.' });
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

// --- KEEPALIVE & 24/7 UPTIME MONITOR ENDPOINTS ---
app.get(['/api/keepalive', '/ping', '/healthz'], (req, res) => {
    try {
        const proto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (host && !host.includes('127.0.0.1') && !host.includes('localhost')) {
            detectedPublicOrigin = `${proto}://${host}`;
        }
    } catch {}

    const onlineList = Object.keys(activeBots).map(id => {
        const cfg = serversConfig.find(s => s.id === id);
        return { id, name: cfg ? cfg.name : id };
    });

    res.json({
        status: 'ok',
        service: 'OdinLux Minecraft AFK Bot & Panel',
        uptimeSeconds: Math.floor(process.uptime()),
        activeBotsCount: Object.keys(activeBots).length,
        activeBots: onlineList,
        timestamp: Date.now(),
        keepAlive: 'active',
        cloudRunWarm: true
    });
});

app.get('/api/servers/:id/logs', (req, res) => {
    const serverId = req.params.id;
    const logs = serverLogsBuffer.get(serverId) || [];
    res.json({ success: true, serverId, logs });
});

// --- AI QUERY REST ENDPOINT ---
app.post('/api/ai/ask', async (req, res) => {
    const prompt = req.body && req.body.prompt;
    if (!prompt) return res.status(400).json({ success: false, message: 'Prompt is required.' });

    const answer = await askGemini(prompt, 'WebUser');
    res.json({ success: true, answer, prompt });
});

// --- NODE DIAGNOSTICS & INDIA REGION ENDPOINT ---
app.get('/api/system/node', (req, res) => {
    res.json({
        nodeEnvironment: process.env.NODE_ENV || 'production',
        platform: process.platform,
        uptimeSeconds: Math.floor(process.uptime()),
        regionInfo: {
            title: 'Bot Node & Ping Information',
            description: 'The bot ping in Minecraft is determined by the distance between where this Node.js server runs and your Minecraft server host.',
            indiaNodeGuide: 'To achieve 5-bar / lowest ping (< 30ms) to Indian Minecraft servers (e.g. Aternos, Falix, Hostinger India), run this bot on an India-based node (AWS Mumbai ap-south-1, Oracle Cloud Mumbai/Hyderabad Free Tier, or on your local PC using "npm start").'
        }
    });
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
const serverLogsBuffer = new Map(); // serverId -> Array<string> (retained for reconnects/reloads)

function setBotStatus(serverId, text, color) {
    botStatuses[serverId] = { text, color };
    io.emit('status', { serverId, text, color });
}

function logAndEmit(serverId, msg) {
    const timestamp = new Date().toLocaleTimeString();
    const formatted = `[${timestamp}] ${msg}`;
    console.log(`[${serverId}] ${formatted}`);

    if (!serverLogsBuffer.has(serverId)) {
        serverLogsBuffer.set(serverId, []);
    }
    const buf = serverLogsBuffer.get(serverId);
    buf.push(formatted);
    if (buf.length > 500) buf.shift();

    io.emit('log', { serverId, msg: formatted });
}

function getPlayersArray(serverId) {
    const bot = activeBots[serverId];
    if (!bot) return [];
    const isOnline = !!(bot && (bot.entity || (bot._client && !bot._client.ended)));
    let players = [];
    if (bot.players && typeof bot.players === 'object') {
        for (const [key, p] of Object.entries(bot.players)) {
            let name = (p && (p.username || p.name)) || key;
            if (typeof name === 'string') {
                // Strip Minecraft formatting color codes (§a, §f, etc.)
                name = name.replace(/§[0-9a-fk-or]/gi, '').trim();
                // Filter out internal scoreboard or empty entries, allow valid Minecraft & Bedrock/Floodgate names
                if (name.length >= 1 && name.length <= 32 && !name.startsWith('!')) {
                    players.push(name);
                }
            }
        }
    }
    players = Array.from(new Set(players)).sort();

    // If bot is connected, guarantee that the bot itself appears in the online roster
    if (isOnline) {
        const cfg = serversConfig.find(s => s.id === serverId);
        const myName = sanitizeUsername(bot.username || (cfg && cfg.username) || 'AFK_Steve');
        if (myName && !players.includes(myName)) {
            players.unshift(myName);
        }
    }
    return players;
}

function emitPlayerList(serverId) {
    const bot = activeBots[serverId];
    const isOnline = !!(bot && (bot.entity || (bot._client && !bot._client.ended)));
    const players = getPlayersArray(serverId);
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
        let vName = res && res.version && res.version.name ? res.version.name : 'Java Edition';
        if (res && res.version && res.version.protocol === 0) {
            vName = config.version && config.version !== 'auto' ? `Paper ${config.version} (Paused)` : 'Paused (Join to start)';
        }
        const info = {
            serverId: config.id,
            online: true,
            onlinePlayers: res && res.players && typeof res.players.online === 'number' ? res.players.online : 0,
            maxPlayers: res && res.players && typeof res.players.max === 'number' ? res.players.max : 20,
            latency,
            version: vName
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

    let targetVersion = (config.version && config.version !== 'auto') ? config.version : null;
    if (!targetVersion) {
        // Smart version detection from server description or name
        const match = (config.description || '').match(/\b(1\.\d+(\.\d+)?)\b/) || (config.name || '').match(/\b(1\.\d+(\.\d+)?)\b/);
        if (match) {
            targetVersion = (match[1] === '1.21' || match[1] === '1.21.0') ? '1.21.4' : match[1];
        }
    }

    const versionStr = targetVersion ? targetVersion : 'auto-detect';
    logAndEmit(config.id, `[CONTROL] Connecting to ${config.host}:${config.port} as ${validUsername} (version: ${versionStr})...`);

    const botOptions = {
        host: config.host,
        port: config.port,
        username: validUsername,
        checkTimeoutInterval: 90000,
        hideErrors: true
    };

    if (targetVersion) {
        botOptions.version = targetVersion;
    }

    let bot;
    try {
        bot = mineflayer.createBot(botOptions);
        activeBots[config.id] = bot;
    } catch (err) {
        logAndEmit(config.id, `[ERROR] Init failed: ${err.message}`);
        setBotStatus(config.id, 'OFFLINE', '#e00000');
        if (activeHostLocks.get(lockKey) === config.id) activeHostLocks.delete(lockKey);
        return;
    }

    // TCP NoDelay for minimum packet latency and lower ping
    if (bot._client) {
        bot._client.on('connect', () => {
            try {
                if (bot._client && bot._client.socket && typeof bot._client.socket.setNoDelay === 'function') {
                    bot._client.socket.setNoDelay(true);
                }
            } catch {}
        });
    }

    bot.once('inject_allowed', () => {
        try {
            if (bot._client && bot._client.socket && typeof bot._client.socket.setNoDelay === 'function') {
                bot._client.socket.setNoDelay(true);
            }
        } catch {}
    });

    let connectionFailed = false;
    let hasEnded = false;
    bot.on('error', (err) => {
        let errMsg = err.message || 'Connection error';
        let isHandled = false;

        if (errMsg.includes('ECONNRESET')) {
            errMsg = 'Connection reset by server (ECONNRESET). Server may be rebooting or backing up.';
            if (config.version && config.version !== 'auto') {
                config.version = 'auto';
                saveServersConfig();
            }
            logAndEmit(config.id, `[NETWORK] ${errMsg}`);
            isHandled = true;
        } else if (errMsg.includes('Unsupported protocol version') || errMsg.includes("protocol version '0'")) {
            errMsg = 'Server returned protocol 0 (hibernating proxy). Auto-switching to Minecraft 1.21.4...';
            config.version = '1.21.4';
            saveServersConfig();
            logAndEmit(config.id, `[PROTOCOL] ${errMsg}`);
            isHandled = true;
        } else if (errMsg.includes('ENOTFOUND')) {
            errMsg = `Host "${config.host}" cannot be resolved (domain not found in DNS). Host may be offline or misconfigured.`;
            reconnectAttempts[config.id] = (reconnectAttempts[config.id] || 0) + 1;
            if (reconnectAttempts[config.id] >= 2) {
                logAndEmit(config.id, `[NETWORK] ${errMsg}`);
                logAndEmit(config.id, `[CONTROL] Auto-reconnect suspended: "${config.host}" does not exist in DNS. Please edit server settings with a reachable hostname or IP.`);
                setBotStatus(config.id, 'DNS_ERROR', '#e00000');
                if (reconnectTimers[config.id]) {
                    clearTimeout(reconnectTimers[config.id]);
                    delete reconnectTimers[config.id];
                }
                return;
            }
            logAndEmit(config.id, `[NETWORK] ${errMsg}`);
            isHandled = true;
        } else if (errMsg.includes('ECONNREFUSED')) {
            errMsg = `Target Minecraft server at ${config.host}:${config.port} is currently offline (Connection refused).`;
            reconnectAttempts[config.id] = (reconnectAttempts[config.id] || 0) + 1;
            if (reconnectAttempts[config.id] >= 2) {
                logAndEmit(config.id, `[NETWORK] ${errMsg}`);
                logAndEmit(config.id, `[STANDBY] Server appears to be offline. Auto-reconnect paused to conserve bandwidth. Click "Start Bot" when server is back online.`);
                setBotStatus(config.id, 'OFFLINE', '#e00000');
                if (reconnectTimers[config.id]) {
                    clearTimeout(reconnectTimers[config.id]);
                    delete reconnectTimers[config.id];
                }
                return;
            }
            logAndEmit(config.id, `[NETWORK] ${errMsg} Waiting for server to come online...`);
            isHandled = true;
        } else if (errMsg.includes('ETIMEDOUT') || errMsg.includes('timed out')) {
            errMsg = `Connection to ${config.host}:${config.port} timed out. Server may be lagging or rebooting.`;
            reconnectAttempts[config.id] = (reconnectAttempts[config.id] || 0) + 1;
            if (reconnectAttempts[config.id] >= 3) {
                logAndEmit(config.id, `[NETWORK] ${errMsg}`);
                logAndEmit(config.id, `[STANDBY] Server timed out after multiple attempts. Pausing auto-reconnect until manual restart.`);
                setBotStatus(config.id, 'OFFLINE', '#e00000');
                if (reconnectTimers[config.id]) {
                    clearTimeout(reconnectTimers[config.id]);
                    delete reconnectTimers[config.id];
                }
                return;
            }
            logAndEmit(config.id, `[NETWORK] ${errMsg}`);
            isHandled = true;
        }

        if (!isHandled) {
            logAndEmit(config.id, `[NETWORK] ${errMsg}`);
        }

        if (autoReconnect[config.id] !== false && !hasEnded) {
            setBotStatus(config.id, 'RECONNECTING', '#f5a623');
            // If connection timed out or failed before 'end' event, schedule safe auto-reconnect
            if (!reconnectTimers[config.id]) {
                const delayMs = Math.min(25000, Math.max(5000, ((reconnectAttempts[config.id] || 0) + 1) * 5000));
                reconnectTimers[config.id] = setTimeout(() => {
                    delete reconnectTimers[config.id];
                    if (autoReconnect[config.id] !== false && !activeBots[config.id]) {
                        startBot(serversConfig.find(s => s.id === config.id) || config);
                    }
                }, delayMs);
            }
        }
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
        connectionFailed = false;
        logAndEmit(config.id, `[LOGIN] 🔐 Logged into Minecraft server successfully as ${validUsername}!`);
    });

    bot.on('spawn', () => {
        try {
            reconnectAttempts[config.id] = 0;
            connectionFailed = false;
            setBotStatus(config.id, 'ONLINE', '#0070f3');
            botUptimeStarts[config.id] = Date.now();
            io.emit('uptime_update', { serverId: config.id, uptimeStart: botUptimeStarts[config.id] });

            let dimName = 'Overworld';
            try {
                if (bot.game) {
                    if (typeof bot.game.dimension === 'string') {
                        dimName = bot.game.dimension.replace(/^minecraft:/, '');
                    } else if (bot.game.dimension && typeof bot.game.dimension.name === 'string') {
                        dimName = bot.game.dimension.name.replace(/^minecraft:/, '');
                    }
                }
            } catch {}
            let gameMode = (bot.game && bot.game.gameMode) ? bot.game.gameMode : 'Survival';
            let posStr = '';
            try {
                if (bot.entity && bot.entity.position && typeof bot.entity.position.x === 'number' && !isNaN(bot.entity.position.x)) {
                    posStr = `at (X: ${Math.round(bot.entity.position.x)}, Y: ${Math.round(bot.entity.position.y)}, Z: ${Math.round(bot.entity.position.z)})`;
                }
            } catch {}

            logAndEmit(config.id, `[WORLD] 🌍 ${validUsername} has joined and spawned into the world! ${posStr} [${dimName} | ${gameMode}]`);
            logAndEmit(config.id, `[STATUS] 🟢 24/7 Bot Connection Active — Online & Ready.`);

            if (config.password) {
                setTimeout(() => {
                    try {
                        bot.chat(`/login ${config.password}`);
                        logAndEmit(config.id, `[AuthMe] Sent /login password command.`);
                    } catch {}
                }, 1200);
            }

            emitPlayerList(config.id);
            setTimeout(() => {
                emitPlayerList(config.id);
                const pl = getPlayersArray(config.id);
                if (pl.length > 0) {
                    logAndEmit(config.id, `[PLAYERS] 👥 Online Roster (${pl.length} player${pl.length === 1 ? '' : 's'}): ${pl.slice(0, 8).join(', ')}${pl.length > 8 ? ' ...' : ''}`);
                }
            }, 1800);
            setTimeout(() => emitPlayerList(config.id), 4000);
            updateSMPInfo(config);
        } catch (spawnErr) {
            console.error('[SPAWN HANDLER ERROR]', spawnErr);
        }

        // --- ENHANCED 24/7 ACTIVE ANTI-AFK ROUTINE ---
        // Keeps the bot active and prevents Aternos / Minehut / Spigot idle kicks and shutdowns
        if (afkTimers[config.id]) clearInterval(afkTimers[config.id]);
        let afkStep = 0;
        afkTimers[config.id] = setInterval(() => {
            if (bot && bot.entity) {
                try {
                    afkStep = (afkStep + 1) % 4;
                    // 1. Arm swing
                    bot.swingArm();

                    // 2. Subtle camera look rotation
                    const currentYaw = bot.entity.yaw || 0;
                    const pitch = bot.entity.pitch || 0;
                    const delta = (afkStep % 2 === 0 ? 0.12 : -0.12);
                    bot.look(currentYaw + delta, pitch, true);

                    // 3. Sneak pulse to trigger server activity detection
                    if (afkStep === 1) {
                        bot.setControlState('sneak', true);
                        setTimeout(() => {
                            if (bot) bot.setControlState('sneak', false);
                        }, 250);
                    }

                    // 4. Grounded micro-jump
                    if (afkStep === 3 && bot.entity.onGround) {
                        bot.setControlState('jump', true);
                        setTimeout(() => {
                            if (bot) bot.setControlState('jump', false);
                        }, 180);
                    }
                } catch {}
            }
        }, 22000); // Trigger every 22 seconds
    });

    bot.on('respawn', () => {
        try {
            logAndEmit(config.id, `[WORLD] 🌍 ${validUsername} respawned / transferred dimension.`);
            emitPlayerList(config.id);
            setTimeout(() => emitPlayerList(config.id), 2000);
        } catch {}
    });

    bot.on('playerJoined', (player) => {
        const pName = player ? (player.username || player.name) : 'Player';
        if (pName && pName !== validUsername) {
            logAndEmit(config.id, `[PLAYER JOINED] + ${pName} joined the server.`);
        }
        emitPlayerList(config.id);
    });

    bot.on('playerLeft', (player) => {
        const pName = player ? (player.username || player.name) : 'Player';
        if (pName && pName !== validUsername) {
            logAndEmit(config.id, `[PLAYER LEFT] - ${pName} left the server.`);
        }
        emitPlayerList(config.id);
    });

    bot.on('playerUpdated', () => {
        emitPlayerList(config.id);
    });

    // Dedicated Live Player Roster Syncer (every 5 seconds while online)
    const rosterInterval = setInterval(() => {
        if (activeBots[config.id] && bot && (bot.entity || (bot._client && !bot._client.ended))) {
            emitPlayerList(config.id);
        }
    }, 5000);

    const posInterval = setInterval(() => {
        if (bot && bot.entity) {
            const p = bot.entity.position;
            botPositions[config.id] = { x: p.x.toFixed(1), y: p.y.toFixed(1), z: p.z.toFixed(1) };
            io.emit('position', { serverId: config.id, ...botPositions[config.id] });
        }
    }, 4000);

    // --- IN-GAME COMMAND HANDLER (!ai, !ping, !pos, !uptime, !help) ---
    let lastCmdTime = 0;
    const handleInGameCommand = async (sender, rawMessage) => {
        if (!rawMessage || !activeBots[config.id]) return;
        const msg = rawMessage.trim();
        const lower = msg.toLowerCase();

        // Prevent rapid command spam (1s cooldown)
        const now = Date.now();
        if (now - lastCmdTime < 1000) return;

        // 1. Ping Command
        if (lower === '!ping' || lower.startsWith('!ping ')) {
            lastCmdTime = now;
            const latency = (bot.player && bot.player.ping) ? bot.player.ping : ((bot._client && bot._client.latency) ? bot._client.latency : 48);
            const bars = latency < 120 ? '5/5 bars 🟢' : (latency < 250 ? '4/5 bars 🟡' : '3/5 bars 🟠');
            bot.chat(`[Bot] 🏓 Ping: ${latency}ms (${bars}) | 24/7 Node Active`);
            return;
        }

        // 2. Position / Coords Command
        if (lower === '!pos' || lower === '!coords') {
            lastCmdTime = now;
            if (bot.entity && bot.entity.position) {
                const p = bot.entity.position;
                bot.chat(`[Bot] 📍 Bot Position: X: ${p.x.toFixed(1)}, Y: ${p.y.toFixed(1)}, Z: ${p.z.toFixed(1)}`);
            }
            return;
        }

        // 3. Uptime Command
        if (lower === '!uptime') {
            lastCmdTime = now;
            const start = botUptimeStarts[config.id];
            if (start) {
                const totalSec = Math.floor((now - start) / 1000);
                const hrs = Math.floor(totalSec / 3600);
                const mins = Math.floor((totalSec % 3600) / 60);
                const sec = totalSec % 60;
                bot.chat(`[Bot] ⏱️ 24/7 Uptime: ${hrs}h ${mins}m ${sec}s without disconnect`);
            } else {
                bot.chat(`[Bot] ⏱️ Online & actively running.`);
            }
            return;
        }

        // 4. Help Command
        if (lower === '!help' || lower === '!bot' || lower === '!commands') {
            lastCmdTime = now;
            bot.chat(`[Bot] 🤖 Commands: !ai <question>, !ping, !pos, !uptime. Try: "!ai best y level for diamond"`);
            return;
        }

        // 5. In-Game AI Assistant Command (!ai or !gemini)
        if (lower.startsWith('!ai') || lower.startsWith('!gemini')) {
            lastCmdTime = now;
            const question = msg.replace(/^!(ai|gemini)\s*/i, '').trim();

            if (!question || question.toLowerCase() === 'help') {
                bot.chat(`[AI] 🤖 Usage: !ai <question> — e.g. "!ai best y level for diamond" or "!ai speed potion"`);
                return;
            }

            const answer = await askGemini(question, sender);
            const clean = answer.replace(/[*_#`\n\r]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 180);
            if (activeBots[config.id]) {
                bot.chat(`[AI] ${clean}`);
            }
        }
    };

    bot.on('chat', async (user, message) => {
        if (user === bot.username || user === config.username) return;
        handleInGameCommand(user, message);
    });

    bot.on('messagestr', (message, position) => {
        if (!message || typeof message !== 'string') return;
        const trimmed = message.trim();
        if (!trimmed) return;

        // Log all server messages, broadcasts and player chats to console
        logAndEmit(config.id, trimmed);

        // Parse chat from custom formatted SMP servers (Paper, LPC, Essentials)
        const match = trimmed.match(/(?:<([^>]+)>|([a-zA-Z0-9_]{3,16})\s*[:»])\s*(!ai\b.*|!gemini\b.*|!ping\b|!pos\b|!uptime\b|!help\b)/i);
        if (match) {
            const sender = match[1] || match[2] || 'Player';
            const cmd = match[3];
            if (sender !== bot.username && sender !== config.username) {
                handleInGameCommand(sender, cmd);
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
        } else if (lower.includes('duplicate_login') || lower.includes('another location') || lower.includes('already connected') || lower.includes('already logged in') || lower.includes('another device')) {
            wasConflict = true;
            autoReconnect[config.id] = false;
            setBotStatus(config.id, 'STANDBY', '#888888');
            logAndEmit(config.id, `[SESSION CONFLICT] Another player/session is actively using username "${validUsername}". Bot is standing by so you can play without disconnection. Click "Start" when you are done playing.`);
        }
    });

    bot.on('end', (reason) => {
        hasEnded = true;
        clearInterval(posInterval);
        clearInterval(rosterInterval);
        if (afkTimers[config.id]) {
            clearInterval(afkTimers[config.id]);
            delete afkTimers[config.id];
        }
        delete activeBots[config.id];
        delete botUptimeStarts[config.id];
        io.emit('uptime_update', { serverId: config.id, uptimeStart: null });
        emitPlayerList(config.id);

        if (activeHostLocks.get(lockKey) === config.id) {
            activeHostLocks.delete(lockKey);
        }

        logAndEmit(config.id, `[DISCONNECTED] (${reason || 'Connection closed'}).`);

        if (wasKickedWhitelist) {
            setBotStatus(config.id, 'WHITELISTED', '#f5a623');
            return;
        }

        if (wasConflict) {
            setBotStatus(config.id, 'STANDBY', '#888888');
            return;
        }

        // Only stop if user explicitly stopped the bot via Stop Bot button
        if (autoReconnect[config.id] === false) {
            setBotStatus(config.id, 'STANDBY', '#888888');
            return;
        }

        // CONTINUOUS 24/7 AUTO-RECONNECT: Keeps the bot in the server continuously even if server restarts or reboots
        reconnectAttempts[config.id] = (reconnectAttempts[config.id] || 0) + 1;
        // Fast reconnect for first 3 attempts (5s, 10s, 15s), then 25s backoff
        const delayMs = Math.min(25000, Math.max(5000, (reconnectAttempts[config.id] || 1) * 5000));
        setBotStatus(config.id, 'RECONNECTING', '#f5a623');
        logAndEmit(config.id, `[24/7 AUTO-RECONNECT] Reconnecting in ${delayMs / 1000}s (attempt #${reconnectAttempts[config.id]})...`);

        if (reconnectTimers[config.id]) clearTimeout(reconnectTimers[config.id]);
        reconnectTimers[config.id] = setTimeout(() => {
            delete reconnectTimers[config.id];
            const currentCfg = serversConfig.find(s => s.id === config.id) || config;
            startBot(currentCfg);
        }, delayMs);
    });
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

                const history = serverLogsBuffer.get(s.id) || [];
                if (history.length > 0) {
                    socket.emit('logs_history', { serverId: s.id, logs: history });
                }
            });
        } else {
            socket.emit('auth_error', { message: 'Session expired. Please log in again.' });
        }
    });

    socket.on('request_server_logs', (data) => {
        if (!data || !data.serverId) return;
        const logs = serverLogsBuffer.get(data.serverId) || [];
        socket.emit('logs_history', { serverId: data.serverId, logs });
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
        if (!data || !data.serverId) return;
        if (!canAccessServer(socket.user, data.serverId)) return;
        emitPlayerList(data.serverId);
        const pl = getPlayersArray(data.serverId);
        if (pl.length > 0) {
            logAndEmit(data.serverId, `[PLAYERS] 👥 Online Roster (${pl.length}): ${pl.join(', ')}`);
        } else {
            const bot = activeBots[data.serverId];
            const isOnline = !!(bot && (bot.entity || (bot._client && !bot._client.ended)));
            if (isOnline) {
                logAndEmit(data.serverId, `[PLAYERS] 👥 Roster empty or waiting for server tablist packet.`);
            }
        }
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
        await Promise.all(visible.map(s => updateSMPInfo(s)));
        visible.forEach(s => emitPlayerList(s.id));
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
            const key = (data && data.apiKey ? data.apiKey.trim() : '');
            const testAi = new GoogleGenAI({
                apiKey: key,
                httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
            });
            const res = await testAi.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: 'Hello! Verify connection in 1 word.',
                config: { thinkingConfig: { thinkingLevel: 'LOW' } }
            });
            if (res && res.text) {
                geminiApiKey = key;
                ai = testAi;
                saveGeminiApiKey(key);
                socket.emit('gemini_key_saved', { success: true, message: 'Gemini 3.8 Flash key verified and permanently saved!' });
            }
        } catch (err) {
            socket.emit('gemini_key_saved', { success: false, message: `Key verification error: ${err.message}` });
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[HTTP] Server listening on port ${PORT}`);
    // Start active bots on launch only if explicitly enabled
    serversConfig.forEach((cfg) => {
        if (cfg.autoStart === true) {
            console.log(`[BOOT] Auto-starting bot for "${cfg.name}" (${cfg.host}:${cfg.port})...`);
            startBot(cfg);
        }
    });

    // --- 24/7 MULTI-TIER KEEP-ALIVE HEARTBEAT ---
    // 1. Internal loopback heartbeat every 60s
    setInterval(() => {
        http.get(`http://127.0.0.1:${PORT}/api/keepalive`, () => {}).on('error', () => {});
    }, 60000);

    // 2. External public ingress ping every 75s (generates ingress traffic to prevent Cloud Run scale-to-zero when device is powered off)
    setInterval(() => {
        if (detectedPublicOrigin) {
            try {
                const targetUrl = new URL(`${detectedPublicOrigin}/api/keepalive`);
                const client = targetUrl.protocol === 'https:' ? https : http;
                client.get(targetUrl.href, { timeout: 10000 }, (res) => {
                    // Ingress keepalive success
                }).on('error', () => {});
            } catch {}
        }
    }, 75000);
});

module.exports = app;
