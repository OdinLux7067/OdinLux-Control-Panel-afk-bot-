/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * OdinLux 3D Spatial UI & Glassmorphism Studio Engine
 * Full 3D WebGL background, interactive mouse tilt, particle physics, scroll animations & customization
 */

(function () {
    'use strict';

    // --- DEFAULT CONFIGURATION STATE ---
    const DEFAULT_CONFIG = {
        themeAccent: '#10b981',
        themeAccentName: 'Emerald Matrix',
        spatialDepth: 'cinematic', // off, subtle, cinematic, extreme
        spatialDepthPx: 25,
        glassBlur: 16,
        glassOpacity: 0.68,
        glassBorderOpacity: 0.14,
        backgroundMode: 'minecraft_voxels', // minecraft_voxels, cyber_grid, holographic, nebula, minimal
        mouseTilt: true,
        mouseTiltSensitivity: 1.0,
        mouseGlow: true,
        mouseGlowSize: 550,
        clickSparks: true,
        magneticButtons: true,
        pageAnimation: 'spatial', // spatial, holo, slide, instant
        scrollProgressBar: true,
        soundFX: true,
        soundVolume: 0.12
    };

    // Preset Collections
    const PRESETS = {
        'default': {
            name: 'Emerald Matrix',
            themeAccent: '#10b981',
            spatialDepth: 'cinematic',
            spatialDepthPx: 25,
            glassBlur: 16,
            glassOpacity: 0.68,
            glassBorderOpacity: 0.14,
            backgroundMode: 'minecraft_voxels',
            mouseTilt: true,
            mouseGlow: true,
            pageAnimation: 'spatial'
        },
        'diamond': {
            name: 'Diamond Dimension',
            themeAccent: '#00d4ff',
            spatialDepth: 'extreme',
            spatialDepthPx: 45,
            glassBlur: 22,
            glassOpacity: 0.72,
            glassBorderOpacity: 0.22,
            backgroundMode: 'minecraft_voxels',
            mouseTilt: true,
            mouseGlow: true,
            pageAnimation: 'holo'
        },
        'amethyst': {
            name: 'Amethyst Aurora',
            themeAccent: '#a855f7',
            spatialDepth: 'cinematic',
            spatialDepthPx: 30,
            glassBlur: 20,
            glassOpacity: 0.65,
            glassBorderOpacity: 0.16,
            backgroundMode: 'nebula',
            mouseTilt: true,
            mouseGlow: true,
            pageAnimation: 'spatial'
        },
        'nether': {
            name: 'Nether Fortress',
            themeAccent: '#ef4444',
            spatialDepth: 'extreme',
            spatialDepthPx: 40,
            glassBlur: 14,
            glassOpacity: 0.8,
            glassBorderOpacity: 0.2,
            backgroundMode: 'cyber_grid',
            mouseTilt: true,
            mouseGlow: true,
            pageAnimation: 'holo'
        },
        'solar': {
            name: 'Solar Amber',
            themeAccent: '#f5a623',
            spatialDepth: 'cinematic',
            spatialDepthPx: 25,
            glassBlur: 16,
            glassOpacity: 0.65,
            glassBorderOpacity: 0.15,
            backgroundMode: 'holographic',
            mouseTilt: true,
            mouseGlow: true,
            pageAnimation: 'slide'
        },
        'stealth': {
            name: 'Stealth Obsidian',
            themeAccent: '#94a3b8',
            spatialDepth: 'subtle',
            spatialDepthPx: 12,
            glassBlur: 24,
            glassOpacity: 0.55,
            glassBorderOpacity: 0.1,
            backgroundMode: 'minimal',
            mouseTilt: false,
            mouseGlow: false,
            pageAnimation: 'instant'
        }
    };

    // Load active config from localStorage or fallback
    let currentConfig = Object.assign({}, DEFAULT_CONFIG);
    try {
        const saved = localStorage.getItem('odinlux_spatial_config');
        if (saved) {
            currentConfig = Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
        }
    } catch (e) {
        console.warn('[SpatialStudio] Could not read saved config:', e);
    }

    // --- AUDIO SYNTHESIZER (NATIVE WEB AUDIO API) ---
    let audioCtx = null;
    function getAudioContext() {
        if (!audioCtx && typeof window.AudioContext !== 'undefined') {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            } catch {}
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playSound(type) {
        if (!currentConfig.soundFX) return;
        const ctx = getAudioContext();
        if (!ctx) return;

        try {
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            const vol = Math.max(0.01, Math.min(1.0, currentConfig.soundVolume));

            if (type === 'click') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(300, now + 0.06);
                gain.gain.setValueAtTime(vol * 0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
                osc.start(now);
                osc.stop(now + 0.06);
            } else if (type === 'pop') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(450, now);
                osc.frequency.exponentialRampToValueAtTime(900, now + 0.08);
                gain.gain.setValueAtTime(vol * 0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                osc.start(now);
                osc.stop(now + 0.08);
            } else if (type === 'page') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(320, now);
                osc.frequency.exponentialRampToValueAtTime(640, now + 0.12);
                gain.gain.setValueAtTime(vol * 0.35, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
                osc.start(now);
                osc.stop(now + 0.14);
            } else if (type === 'success') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(523.25, now); // C5
                osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
                osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
                gain.gain.setValueAtTime(vol * 0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                osc.start(now);
                osc.stop(now + 0.35);
            }
        } catch {}
    }

    // --- THREE.JS 3D SPATIAL BACKGROUND ENGINE ---
    let threeRenderer, threeScene, threeCamera, threeAnimationId;
    let threeMeshGroup, threeParticleSystem, threePointLight;
    let mouse3DX = 0, mouse3DY = 0, target3DX = 0, target3DY = 0;

    // Helper: Generate procedural Minecraft ore texture onto Canvas
    function createOreBlockTexture(oreType) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        // Base stone color
        let baseColor = '#505050';
        let oreColors = ['#00d4ff', '#38bdf8', '#7dd3fc', '#0284c7']; // diamond default

        if (oreType === 'emerald') {
            baseColor = '#4a4a4a';
            oreColors = ['#10b981', '#34d399', '#059669', '#6ee7b7'];
        } else if (oreType === 'gold') {
            baseColor = '#4d4d4d';
            oreColors = ['#f5a623', '#fbbf24', '#fef08a', '#d97706'];
        } else if (oreType === 'redstone') {
            baseColor = '#3f3f3f';
            oreColors = ['#ef4444', '#f87171', '#b91c1c', '#fca5a5'];
        } else if (oreType === 'netherite') {
            baseColor = '#242124';
            oreColors = ['#524d52', '#6b666b', '#3b373b', '#827d82'];
        } else if (oreType === 'obsidian') {
            baseColor = '#120c1f';
            oreColors = ['#3b185f', '#511281', '#280c42', '#a855f7'];
        }

        // Fill base stone with pixel noise
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, size, size);

        const pixelSize = 4;
        for (let x = 0; x < size; x += pixelSize) {
            for (let y = 0; y < size; y += pixelSize) {
                const shade = (Math.random() - 0.5) * 30;
                ctx.fillStyle = `rgba(0, 0, 0, ${Math.abs(shade) / 100})`;
                ctx.fillRect(x, y, pixelSize, pixelSize);
            }
        }

        // Draw ore gems
        const gemSpots = [
            [8, 8], [16, 12], [24, 20], [36, 16], [44, 24],
            [12, 36], [20, 44], [36, 40], [44, 48], [28, 32]
        ];

        gemSpots.forEach(([gx, gy]) => {
            const color = oreColors[Math.floor(Math.random() * oreColors.length)];
            ctx.fillStyle = color;
            ctx.fillRect(gx, gy, pixelSize * 2, pixelSize * 2);
            // Highlight spot
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(gx + pixelSize, gy, pixelSize, pixelSize);
        });

        // 1px block bevel border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0, 0, size, size);

        return new THREE.CanvasTexture(canvas);
    }

    function initThreeSpatialScene() {
        const canvas = document.getElementById('spatial3dCanvas');
        if (!canvas || typeof THREE === 'undefined') return;

        // Clean up any existing instance
        if (threeAnimationId) {
            cancelAnimationFrame(threeAnimationId);
            threeAnimationId = null;
        }

        const width = window.innerWidth;
        const height = window.innerHeight;

        try {
            threeRenderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: true,
                antialias: true,
                powerPreference: 'high-performance'
            });
            threeRenderer.setSize(width, height);
            threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            threeScene = new THREE.Scene();
            threeCamera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
            threeCamera.position.z = 110;

            // Lights
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
            threeScene.add(ambientLight);

            const dirLight = new THREE.DirectionalLight(new THREE.Color(currentConfig.themeAccent), 1.2);
            dirLight.position.set(40, 60, 50);
            threeScene.add(dirLight);

            threePointLight = new THREE.PointLight(new THREE.Color(currentConfig.themeAccent), 1.8, 250);
            threePointLight.position.set(0, 0, 40);
            threeScene.add(threePointLight);

            // Container group for 3D meshes
            threeMeshGroup = new THREE.Group();
            threeScene.add(threeMeshGroup);

            buildSceneForMode(currentConfig.backgroundMode);
            animateThree();
        } catch (err) {
            console.warn('[SpatialStudio] WebGL Scene init skipped:', err.message);
        }
    }

    function buildSceneForMode(mode) {
        if (!threeScene || !threeMeshGroup) return;

        // Clear existing children
        while (threeMeshGroup.children.length > 0) {
            const obj = threeMeshGroup.children[0];
            threeMeshGroup.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        }

        const accentColor = new THREE.Color(currentConfig.themeAccent);

        if (mode === 'minecraft_voxels') {
            // Authentic Minecraft Ore Blocks Floating in 3D Space
            const oreTypes = ['diamond', 'emerald', 'gold', 'redstone', 'netherite', 'obsidian'];
            const blockCount = 12;

            for (let i = 0; i < blockCount; i++) {
                const oreType = oreTypes[i % oreTypes.length];
                const texture = createOreBlockTexture(oreType);
                const mat = new THREE.MeshStandardMaterial({
                    map: texture,
                    roughness: 0.45,
                    metalness: (oreType === 'gold' || oreType === 'netherite') ? 0.7 : 0.2
                });

                const size = 7 + (Math.random() * 5);
                const geom = new THREE.BoxGeometry(size, size, size);
                const cube = new THREE.Mesh(geom, mat);

                // Distribute around periphery so text remains readable
                const angle = (i / blockCount) * Math.PI * 2 + (Math.random() * 0.4);
                const radius = 55 + (Math.random() * 45);
                cube.position.x = Math.cos(angle) * radius;
                cube.position.y = Math.sin(angle) * (radius * 0.65);
                cube.position.z = -20 + (Math.random() * 40);

                cube.rotation.x = Math.random() * Math.PI;
                cube.rotation.y = Math.random() * Math.PI;

                cube.userData = {
                    rotSpeedX: (Math.random() - 0.5) * 0.012,
                    rotSpeedY: (Math.random() - 0.5) * 0.015,
                    floatOffset: Math.random() * Math.PI * 2,
                    floatAmp: 2 + Math.random() * 3,
                    initialY: cube.position.y
                };

                threeMeshGroup.add(cube);
            }

            // Star / Energy Sparkle Particles
            const pGeom = new THREE.BufferGeometry();
            const pCount = 180;
            const pPositions = new Float32Array(pCount * 3);
            for (let p = 0; p < pCount * 3; p += 3) {
                pPositions[p] = (Math.random() - 0.5) * 260;
                pPositions[p + 1] = (Math.random() - 0.5) * 160;
                pPositions[p + 2] = (Math.random() - 0.5) * 80;
            }
            pGeom.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
            const pMat = new THREE.PointsMaterial({
                color: accentColor,
                size: 2.2,
                transparent: true,
                opacity: 0.65,
                blending: THREE.AdditiveBlending
            });
            threeParticleSystem = new THREE.Points(pGeom, pMat);
            threeMeshGroup.add(threeParticleSystem);

        } else if (mode === 'cyber_grid') {
            // Undulating 3D Perspective Wireframe Matrix Plane
            const gridGeom = new THREE.PlaneGeometry(280, 280, 24, 24);
            const gridMat = new THREE.MeshBasicMaterial({
                color: accentColor,
                wireframe: true,
                transparent: true,
                opacity: 0.28
            });
            const gridMesh = new THREE.Mesh(gridGeom, gridMat);
            gridMesh.rotation.x = -Math.PI / 2.3;
            gridMesh.position.y = -45;
            gridMesh.position.z = -10;
            threeMeshGroup.add(gridMesh);

            // Floating cyber prisms
            for (let i = 0; i < 8; i++) {
                const geom = new THREE.OctahedronGeometry(6 + Math.random() * 4);
                const mat = new THREE.MeshStandardMaterial({
                    color: accentColor,
                    wireframe: true,
                    metalness: 0.8,
                    roughness: 0.2
                });
                const prism = new THREE.Mesh(geom, mat);
                prism.position.set((Math.random() - 0.5) * 160, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 40);
                prism.userData = {
                    rotSpeedX: 0.01,
                    rotSpeedY: 0.015,
                    floatOffset: Math.random() * Math.PI,
                    floatAmp: 3,
                    initialY: prism.position.y
                };
                threeMeshGroup.add(prism);
            }

        } else if (mode === 'holographic') {
            // Connected Constellation Nodes
            const nodeCount = 35;
            const nodeGeom = new THREE.SphereGeometry(1.4, 8, 8);
            const nodeMat = new THREE.MeshBasicMaterial({ color: accentColor });

            const nodes = [];
            for (let i = 0; i < nodeCount; i++) {
                const sphere = new THREE.Mesh(nodeGeom, nodeMat);
                sphere.position.set((Math.random() - 0.5) * 190, (Math.random() - 0.5) * 110, (Math.random() - 0.5) * 50);
                sphere.userData = {
                    vx: (Math.random() - 0.5) * 0.08,
                    vy: (Math.random() - 0.5) * 0.08
                };
                threeMeshGroup.add(sphere);
                nodes.push(sphere);
            }

        } else if (mode === 'nebula') {
            // 3D Aurora Wave Particles
            const count = 400;
            const geom = new THREE.BufferGeometry();
            const positions = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                const u = i / count;
                positions[i * 3] = (u - 0.5) * 220;
                positions[i * 3 + 1] = Math.sin(u * Math.PI * 4) * 25;
                positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
            }
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const mat = new THREE.PointsMaterial({
                color: accentColor,
                size: 3.0,
                transparent: true,
                opacity: 0.55,
                blending: THREE.AdditiveBlending
            });
            const nebula = new THREE.Points(geom, mat);
            threeMeshGroup.add(nebula);

        } else if (mode === 'minimal') {
            // Subtle floating dust only
            const count = 70;
            const geom = new THREE.BufferGeometry();
            const pos = new Float32Array(count * 3);
            for (let i = 0; i < count * 3; i++) {
                pos[i] = (Math.random() - 0.5) * 180;
            }
            geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
            const mat = new THREE.PointsMaterial({
                color: 0xffffff,
                size: 1.2,
                transparent: true,
                opacity: 0.25
            });
            threeMeshGroup.add(new THREE.Points(geom, mat));
        }
    }

    function animateThree() {
        threeAnimationId = requestAnimationFrame(animateThree);

        // Smooth camera mouse follow (lerp)
        mouse3DX += (target3DX - mouse3DX) * 0.04;
        mouse3DY += (target3DY - mouse3DY) * 0.04;

        if (threeCamera) {
            threeCamera.position.x = mouse3DX * 16;
            threeCamera.position.y = -mouse3DY * 12;
            threeCamera.lookAt(0, 0, 0);
        }

        if (threePointLight) {
            threePointLight.position.x = mouse3DX * 60;
            threePointLight.position.y = -mouse3DY * 40;
        }

        // Animate meshes in scene
        const time = Date.now() * 0.001;
        if (threeMeshGroup) {
            threeMeshGroup.children.forEach(child => {
                if (child.userData && child.userData.rotSpeedX) {
                    child.rotation.x += child.userData.rotSpeedX;
                    child.rotation.y += child.userData.rotSpeedY;
                }
                if (child.userData && child.userData.floatAmp && !child.userData.isBeingDragged) {
                    child.position.y = child.userData.initialY + Math.sin(time + child.userData.floatOffset) * child.userData.floatAmp;
                }
            });
        }

        if (threeRenderer && threeScene && threeCamera) {
            threeRenderer.render(threeScene, threeCamera);
        }
    }

    // --- MOUSE 3D CARD TILT & SPECULAR SHEEN ENGINE ---
    function setupCardTiltEngine() {
        const selector = '.stat-card, .bot-fleet-card, .smp-embed, .console-wrapper, .server-profile-box, .modal-box';

        document.addEventListener('mousemove', (e) => {
            // Update 3D canvas target
            target3DX = (e.clientX / window.innerWidth) * 2 - 1;
            target3DY = (e.clientY / window.innerHeight) * 2 - 1;

            if (!currentConfig.mouseTilt) return;

            const targetCard = e.target.closest(selector);
            if (!targetCard) return;

            // If this is a modal that has been moved or is being dragged, don't override its transform
            if (targetCard.classList.contains('modal-box') && (targetCard.dataset.dragged === 'true' || targetCard.dataset.isDragging === 'true')) {
                return;
            }

            const rect = targetCard.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const normX = (x / rect.width) * 2 - 1;
            const normY = (y / rect.height) * 2 - 1;

            const maxAngle = 10 * currentConfig.mouseTiltSensitivity;
            const rotX = -normY * maxAngle;
            const rotY = normX * maxAngle;

            targetCard.style.setProperty('--card-shine-x', `${(x / rect.width) * 100}%`);
            targetCard.style.setProperty('--card-shine-y', `${(y / rect.height) * 100}%`);

            const depthZ = currentConfig.spatialDepthPx;
            targetCard.style.transform = `perspective(1000px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) translateZ(${depthZ}px) scale3d(${currentConfig.spatialDepth === 'off' ? 1 : 1.02}, ${currentConfig.spatialDepth === 'off' ? 1 : 1.02}, 1.02)`;
        });

        document.addEventListener('mouseout', (e) => {
            const targetCard = e.target.closest(selector);
            if (targetCard && !targetCard.contains(e.relatedTarget)) {
                if (targetCard.classList.contains('modal-box') && targetCard.dataset.dragged === 'true') {
                    return;
                }
                targetCard.style.transform = '';
            }
        });
    }

    // --- DRAGGABLE MODALS ENGINE (MOVE WITH MOUSE) ---
    function setupDraggableModals() {
        let activeModal = null;
        let startMouseX = 0;
        let startMouseY = 0;
        let modalStartLeft = 0;
        let modalStartTop = 0;

        document.addEventListener('mousedown', (e) => {
            // Find modal header handle or studio header
            const handle = e.target.closest('.modal-header, .studio-header');
            if (!handle) return;

            // Do not initiate drag if clicking close button, buttons, or inputs
            if (e.target.closest('.modal-close, button, input, select, a')) return;

            const modalBox = handle.closest('.modal-box');
            if (!modalBox) return;

            activeModal = modalBox;
            activeModal.dataset.isDragging = 'true';

            // Freeze the initial rect coordinates
            const rect = modalBox.getBoundingClientRect();

            if (modalBox.dataset.dragged !== 'true') {
                modalBox.style.position = 'fixed';
                modalBox.style.margin = '0';
                modalBox.style.left = `${rect.left}px`;
                modalBox.style.top = `${rect.top}px`;
                modalBox.style.transform = 'none';
                modalBox.dataset.dragged = 'true';
            }

            modalStartLeft = parseFloat(modalBox.style.left) || rect.left;
            modalStartTop = parseFloat(modalBox.style.top) || rect.top;
            startMouseX = e.clientX;
            startMouseY = e.clientY;

            handle.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!activeModal) return;

            const deltaX = e.clientX - startMouseX;
            const deltaY = e.clientY - startMouseY;

            let newLeft = modalStartLeft + deltaX;
            let newTop = modalStartTop + deltaY;

            // Constrain inside viewport boundary
            const boxWidth = activeModal.offsetWidth;
            const boxHeight = activeModal.offsetHeight;
            const minX = -boxWidth * 0.5;
            const maxX = window.innerWidth - boxWidth * 0.5;
            const minY = 0;
            const maxY = window.innerHeight - 60;

            newLeft = Math.max(minX, Math.min(newLeft, maxX));
            newTop = Math.max(minY, Math.min(newTop, maxY));

            activeModal.style.left = `${newLeft}px`;
            activeModal.style.top = `${newTop}px`;
        });

        const stopModalDrag = () => {
            if (activeModal) {
                activeModal.dataset.isDragging = 'false';
                const handle = activeModal.querySelector('.modal-header, .studio-header');
                if (handle) handle.style.cursor = 'grab';
                activeModal = null;
                document.body.style.userSelect = '';
            }
        };

        document.addEventListener('mouseup', stopModalDrag);
        window.addEventListener('blur', stopModalDrag);
    }

    // --- INTERACTIVE 3D VOXEL DRAGGING & ROTATION WITH MOUSE ---
    function setup3DObjectMouseInteraction() {
        const canvas = document.getElementById('spatial3dCanvas');
        if (!canvas) return;

        let isDraggingVoxel = false;
        let selectedMesh = null;
        let prevMousePos = { x: 0, y: 0 };
        const raycaster = new THREE.Raycaster();
        const mouseVec = new THREE.Vector2();

        // Check if cursor is over any 3D voxel in the background scene
        window.addEventListener('mousemove', (e) => {
            if (!threeCamera || !threeMeshGroup) return;

            // When dragging, move the selected mesh
            if (isDraggingVoxel && selectedMesh) {
                const dx = e.clientX - prevMousePos.x;
                const dy = e.clientY - prevMousePos.y;

                selectedMesh.position.x += dx * 0.18;
                selectedMesh.position.y -= dy * 0.18;
                selectedMesh.rotation.y += dx * 0.025;
                selectedMesh.rotation.x += dy * 0.025;

                if (selectedMesh.userData) {
                    selectedMesh.userData.initialY = selectedMesh.position.y;
                }

                prevMousePos = { x: e.clientX, y: e.clientY };
                return;
            }

            // Raycast on hover to check if hovering background voxels
            if (e.target === canvas || e.target.classList.contains('page-view') || e.target.classList.contains('content-area') || e.target.id === 'authOverlay' || e.target.tagName === 'BODY') {
                mouseVec.x = (e.clientX / window.innerWidth) * 2 - 1;
                mouseVec.y = -(e.clientY / window.innerHeight) * 2 + 1;

                raycaster.setFromCamera(mouseVec, threeCamera);
                const intersects = raycaster.intersectObjects(threeMeshGroup.children, false);

                if (intersects.length > 0) {
                    document.body.style.cursor = 'grab';
                } else if (document.body.style.cursor === 'grab') {
                    document.body.style.cursor = 'default';
                }
            }
        });

        // Direct mouse grab on 3D meshes without requiring Shift key
        window.addEventListener('mousedown', (e) => {
            if (!threeCamera || !threeMeshGroup) return;
            // Don't grab background if clicking input, button, select or link
            if (e.target.closest('input, button, select, a, textarea, .modal-box, #spatial3dFloatingWidget')) return;

            mouseVec.x = (e.clientX / window.innerWidth) * 2 - 1;
            mouseVec.y = -(e.clientY / window.innerHeight) * 2 + 1;

            raycaster.setFromCamera(mouseVec, threeCamera);
            const intersects = raycaster.intersectObjects(threeMeshGroup.children, false);

            if (intersects.length > 0) {
                isDraggingVoxel = true;
                selectedMesh = intersects[0].object;
                if (selectedMesh.userData) {
                    selectedMesh.userData.isBeingDragged = true;
                }
                prevMousePos = { x: e.clientX, y: e.clientY };
                document.body.style.cursor = 'grabbing';
                playSound('pop');
                e.preventDefault();
            }
        });

        const stopVoxelDrag = () => {
            if (isDraggingVoxel && selectedMesh) {
                if (selectedMesh.userData) {
                    selectedMesh.userData.isBeingDragged = false;
                }
                isDraggingVoxel = false;
                selectedMesh = null;
                document.body.style.cursor = 'default';
            }
        };

        window.addEventListener('mouseup', stopVoxelDrag);
        window.addEventListener('blur', stopVoxelDrag);
    }

    // --- FLOATING 3D MOVEABLE ELEMENT VIEWPORT WIDGET (MOUSE DRAG) ---
    let widgetRenderer, widgetScene, widgetCamera, widgetMesh, widgetAnimationId;
    let widgetRotSpeedX = 0, widgetRotSpeedY = 0.008;
    let isDraggingWidget3D = false;
    let widgetPrevMouse = { x: 0, y: 0 };
    let currentWidgetBlockType = 'diamond';

    function ensureFloating3DWidgetDOM() {
        if (document.getElementById('spatial3dFloatingWidget')) return;

        const widgetEl = document.createElement('div');
        widgetEl.id = 'spatial3dFloatingWidget';
        widgetEl.innerHTML = `
            <div class="widget-drag-header" id="widgetDragHandle" title="Click and drag with mouse to reposition anywhere">
                <div class="widget-drag-title">
                    <span class="widget-live-dot"></span>
                    <span>🎮 3D Moveable Object</span>
                </div>
                <div class="widget-header-actions">
                    <button class="widget-icon-btn" id="btnWidgetSpinToggle" title="Toggle Auto-Spin">🔄</button>
                    <button class="widget-icon-btn" id="btnWidgetMinimize" title="Minimize / Expand">_</button>
                    <button class="widget-icon-btn" id="btnWidgetResetPos" title="Reset Widget Position">↺</button>
                </div>
            </div>
            <div class="widget-canvas-container" id="widgetCanvasArea" title="Click and drag with mouse to rotate & spin 3D object">
                <canvas id="spatialWidgetCanvas"></canvas>
                <div class="widget-canvas-overlay-hints">
                    <span>🖱️ Drag to rotate 3D block</span>
                    <span id="widgetBlockName">Diamond Ore</span>
                </div>
            </div>
            <div class="widget-controls-bar">
                <div class="widget-block-selector">
                    <button class="widget-block-pill active" data-type="diamond">Diamond</button>
                    <button class="widget-block-pill" data-type="emerald">Emerald</button>
                    <button class="widget-block-pill" data-type="gold">Gold</button>
                    <button class="widget-block-pill" data-type="netherite">Netherite</button>
                    <button class="widget-block-pill" data-type="redstone">Redstone</button>
                    <button class="widget-block-pill" data-type="obsidian">Obsidian</button>
                </div>
                <div class="widget-actions-row">
                    <span style="color: var(--text-muted); font-size: 10px;">Drag header to move window</span>
                    <button class="guide-action-btn" onclick="SpatialStudio.showMoveableGuide()" style="padding: 2px 8px; font-size: 10px;">Help Guide</button>
                </div>
            </div>
        `;
        document.body.appendChild(widgetEl);
    }

    function initFloating3DWidget() {
        ensureFloating3DWidgetDOM();

        const widgetEl = document.getElementById('spatial3dFloatingWidget');
        const handle = document.getElementById('widgetDragHandle');
        const canvas = document.getElementById('spatialWidgetCanvas');
        if (!widgetEl || !handle || !canvas || typeof THREE === 'undefined') return;

        // Restore saved widget position from localStorage
        try {
            const savedPos = localStorage.getItem('odinlux_widget_pos');
            if (savedPos) {
                const pos = JSON.parse(savedPos);
                widgetEl.style.left = `${pos.x}px`;
                widgetEl.style.top = `${pos.y}px`;
                widgetEl.style.right = 'auto';
                widgetEl.style.bottom = 'auto';
            }
        } catch {}

        // --- 1. MOUSE DRAGGING FOR THE WIDGET WINDOW ITSELF ---
        let isMovingWidget = false;
        let startX = 0, startY = 0, initLeft = 0, initTop = 0;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            isMovingWidget = true;
            const rect = widgetEl.getBoundingClientRect();
            widgetEl.style.right = 'auto';
            widgetEl.style.bottom = 'auto';
            widgetEl.style.left = `${rect.left}px`;
            widgetEl.style.top = `${rect.top}px`;
            initLeft = rect.left;
            initTop = rect.top;
            startX = e.clientX;
            startY = e.clientY;
            document.body.style.userSelect = 'none';
            handle.style.cursor = 'grabbing';
            playSound('pop');
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!isMovingWidget) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newX = Math.max(10, Math.min(window.innerWidth - widgetEl.offsetWidth - 10, initLeft + dx));
            let newY = Math.max(10, Math.min(window.innerHeight - widgetEl.offsetHeight - 10, initTop + dy));

            widgetEl.style.left = `${newX}px`;
            widgetEl.style.top = `${newY}px`;
        });

        window.addEventListener('mouseup', () => {
            if (isMovingWidget) {
                isMovingWidget = false;
                handle.style.cursor = 'grab';
                document.body.style.userSelect = '';
                try {
                    localStorage.setItem('odinlux_widget_pos', JSON.stringify({
                        x: parseFloat(widgetEl.style.left),
                        y: parseFloat(widgetEl.style.top)
                    }));
                } catch {}
            }
        });

        // Header buttons
        document.getElementById('btnWidgetMinimize')?.addEventListener('click', () => {
            widgetEl.classList.toggle('minimized');
            playSound('click');
        });

        document.getElementById('btnWidgetResetPos')?.addEventListener('click', () => {
            widgetEl.style.left = 'auto';
            widgetEl.style.top = 'auto';
            widgetEl.style.right = '24px';
            widgetEl.style.bottom = '24px';
            localStorage.removeItem('odinlux_widget_pos');
            playSound('pop');
        });

        let autoSpin = true;
        document.getElementById('btnWidgetSpinToggle')?.addEventListener('click', () => {
            autoSpin = !autoSpin;
            playSound('click');
        });

        // Block pills switcher
        document.querySelectorAll('.widget-block-pill').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.widget-block-pill').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const type = btn.getAttribute('data-type');
                changeWidgetBlock(type);
                playSound('pop');
            });
        });

        // --- 2. THREE.JS SCENE INSIDE THE WIDGET CANVAS ---
        const container = document.getElementById('widgetCanvasArea');
        const width = container.clientWidth || 308;
        const height = container.clientHeight || 220;

        try {
            widgetRenderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: true,
                antialias: true
            });
            widgetRenderer.setSize(width, height);
            widgetRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

            widgetScene = new THREE.Scene();
            widgetCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
            widgetCamera.position.set(0, 0, 22);

            const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
            widgetScene.add(ambientLight);

            const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
            dirLight.position.set(10, 15, 12);
            widgetScene.add(dirLight);

            const pointLight = new THREE.PointLight(new THREE.Color(currentConfig.themeAccent), 2.2, 30);
            pointLight.position.set(-6, -6, 10);
            widgetScene.add(pointLight);

            // Create initial block
            changeWidgetBlock(currentWidgetBlockType);

            // --- 3. MOUSE DRAGGING & ROTATING THE 3D BLOCK DIRECTLY ---
            container.addEventListener('mousedown', (e) => {
                isDraggingWidget3D = true;
                widgetPrevMouse = { x: e.clientX, y: e.clientY };
                widgetRotSpeedX = 0;
                widgetRotSpeedY = 0;
                container.style.cursor = 'grabbing';
                playSound('click');
                e.preventDefault();
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDraggingWidget3D || !widgetMesh) return;
                const dx = e.clientX - widgetPrevMouse.x;
                const dy = e.clientY - widgetPrevMouse.y;

                widgetMesh.rotation.y += dx * 0.02;
                widgetMesh.rotation.x += dy * 0.02;

                // Save velocity for toss inertia
                widgetRotSpeedY = dx * 0.005;
                widgetRotSpeedX = dy * 0.005;

                widgetPrevMouse = { x: e.clientX, y: e.clientY };
            });

            window.addEventListener('mouseup', () => {
                if (isDraggingWidget3D) {
                    isDraggingWidget3D = false;
                    container.style.cursor = 'grab';
                }
            });

            // Zoom with wheel
            container.addEventListener('wheel', (e) => {
                e.preventDefault();
                widgetCamera.position.z = Math.max(10, Math.min(36, widgetCamera.position.z + e.deltaY * 0.02));
            }, { passive: false });

            // Animation loop for widget
            function animateWidget() {
                widgetAnimationId = requestAnimationFrame(animateWidget);

                if (widgetMesh) {
                    if (!isDraggingWidget3D) {
                        if (autoSpin) {
                            widgetMesh.rotation.y += 0.01;
                        }
                        // Dampen inertia velocity
                        widgetMesh.rotation.y += widgetRotSpeedY;
                        widgetMesh.rotation.x += widgetRotSpeedX;
                        widgetRotSpeedY *= 0.94;
                        widgetRotSpeedX *= 0.94;
                    }
                }

                widgetRenderer.render(widgetScene, widgetCamera);
            }
            animateWidget();

        } catch (err) {
            console.warn('[SpatialStudio] Widget WebGL init:', err);
        }
    }

    function changeWidgetBlock(type) {
        currentWidgetBlockType = type;
        if (!widgetScene) return;

        if (widgetMesh) {
            widgetScene.remove(widgetMesh);
            if (widgetMesh.geometry) widgetMesh.geometry.dispose();
            if (widgetMesh.material) widgetMesh.material.dispose();
        }

        const texture = createOreBlockTexture(type);
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.35,
            metalness: (type === 'gold' || type === 'netherite') ? 0.8 : 0.2
        });

        const geom = new THREE.BoxGeometry(8, 8, 8);
        widgetMesh = new THREE.Mesh(geom, mat);
        widgetMesh.rotation.set(0.4, 0.6, 0);
        widgetScene.add(widgetMesh);

        const names = {
            diamond: 'Diamond Ore',
            emerald: 'Emerald Ore',
            gold: 'Gold Ingot Block',
            netherite: 'Netherite Block',
            redstone: 'Redstone Crystal',
            obsidian: 'Crying Obsidian'
        };

        const lbl = document.getElementById('widgetBlockName');
        if (lbl) lbl.textContent = names[type] || type;
    }

    // --- UNIVERSAL DRAGGABLE UI ENGINE (MOVE CARDS WITH MOUSE) ---
    let isDraggableUIMode = false;

    function toggleDraggableUIMode(forceState) {
        isDraggableUIMode = (typeof forceState === 'boolean') ? forceState : !isDraggableUIMode;

        const body = document.body;
        if (isDraggableUIMode) {
            body.classList.add('draggable-ui-mode-on');
            playSound('success');
            showDraggableUIBanner();
            setupCardDragHandles();
            if (window.showToast) window.showToast('Draggable UI Mode Active: Click & drag any card with your mouse!');
        } else {
            body.classList.remove('draggable-ui-mode-on');
            hideDraggableUIBanner();
            playSound('pop');
            if (window.showToast) window.showToast('Draggable UI Mode Disabled');
        }

        const btn = document.getElementById('btnToggleMoveUI');
        if (btn) {
            btn.classList.toggle('active', isDraggableUIMode);
            btn.innerHTML = isDraggableUIMode
                ? '<i data-lucide="check" size="12"></i> Done Moving'
                : '<i data-lucide="move" size="12"></i> Move UI Cards';
            if (window.lucide) window.lucide.createIcons();
        }
    }

    function showDraggableUIBanner() {
        let banner = document.getElementById('moveUIActiveBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'moveUIActiveBanner';
            banner.className = 'move-ui-active-banner';
            banner.innerHTML = `
                <span>🖐️ Draggable UI Mode: Grab any card or handle to reposition</span>
                <button onclick="SpatialStudio.resetUILayout()">↺ Reset Layout</button>
                <button onclick="SpatialStudio.toggleDraggableUIMode(false)">✓ Done</button>
            `;
            document.body.appendChild(banner);
        }
        banner.style.display = 'flex';
    }

    function hideDraggableUIBanner() {
        const banner = document.getElementById('moveUIActiveBanner');
        if (banner) banner.style.display = 'none';
    }

    function setupCardDragHandles() {
        const cards = document.querySelectorAll('.stat-card, .bot-fleet-card, .smp-card-container');
        cards.forEach((card, idx) => {
            if (!card.dataset.cardDragId) {
                card.dataset.cardDragId = `card_pos_${idx}`;
            }

            // Restore saved positions
            try {
                const saved = localStorage.getItem(`odinlux_pos_${card.dataset.cardDragId}`);
                if (saved) {
                    const pos = JSON.parse(saved);
                    card.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
                }
            } catch {}

            // Prepend grip handle if not existing
            if (!card.querySelector('.draggable-ui-handle')) {
                const grip = document.createElement('div');
                grip.className = 'draggable-ui-handle';
                grip.innerHTML = '⠿ Drag Card';
                card.prepend(grip);
            }

            // Enable mouse drag on handle or entire card when in mode
            card.onmousedown = (e) => {
                if (!isDraggableUIMode) return;
                if (e.target.closest('button, input, select, a, textarea')) return;

                let cardX = 0, cardY = 0;
                const match = (card.style.transform || '').match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
                if (match) {
                    cardX = parseFloat(match[1]) || 0;
                    cardY = parseFloat(match[2]) || 0;
                }

                const startMouseX = e.clientX;
                const startMouseY = e.clientY;

                card.classList.add('card-is-dragging');
                playSound('pop');
                e.preventDefault();

                function onMove(me) {
                    const dx = me.clientX - startMouseX;
                    const dy = me.clientY - startMouseY;
                    card.style.transform = `translate(${cardX + dx}px, ${cardY + dy}px)`;
                }

                function onUp(ue) {
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    card.classList.remove('card-is-dragging');

                    const endMatch = (card.style.transform || '').match(/translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/);
                    if (endMatch) {
                        try {
                            localStorage.setItem(`odinlux_pos_${card.dataset.cardDragId}`, JSON.stringify({
                                x: parseFloat(endMatch[1]),
                                y: parseFloat(endMatch[2])
                            }));
                        } catch {}
                    }
                }

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            };
        });
    }

    function resetUILayout() {
        document.querySelectorAll('.stat-card, .bot-fleet-card, .smp-card-container').forEach(card => {
            card.style.transform = '';
            if (card.dataset.cardDragId) {
                localStorage.removeItem(`odinlux_pos_${card.dataset.cardDragId}`);
            }
        });
        playSound('pop');
        if (window.showToast) window.showToast('Reset UI layout to default grid!');
    }

    // --- FEATURE GUIDE MODAL ("WHERE IS THIS?") ---
    function ensureHelpGuideModalDOM() {
        if (document.getElementById('spatialHelpGuideModal')) return;

        const modal = document.createElement('div');
        modal.id = 'spatialHelpGuideModal';
        modal.innerHTML = `
            <div class="guide-modal-box">
                <div class="guide-modal-header">
                    <h3><span>🎮</span> Moveable / Draggable UI & 3D Elements Guide</h3>
                    <button class="modal-close" onclick="SpatialStudio.closeMoveableGuide()">&times;</button>
                </div>
                <div class="guide-modal-body">
                    <div class="guide-card-item">
                        <div class="guide-card-icon">🕹️</div>
                        <div class="guide-card-content">
                            <h4>1. Moveable 3D Element Widget (Bottom-Right)</h4>
                            <p>Located in the bottom-right corner! Click & drag inside the 3D canvas to spin, flip, and toss the Minecraft Ore block with real-time mouse inertia. Grab the widget header to move the entire window anywhere on screen.</p>
                            <button class="guide-action-btn" onclick="SpatialStudio.highlightWidget()">Spotlight 3D Widget</button>
                        </div>
                    </div>

                    <div class="guide-card-item">
                        <div class="guide-card-icon">🖐️</div>
                        <div class="guide-card-content">
                            <h4>2. Draggable UI Panels & Cards (Move with Mouse)</h4>
                            <p>Click "Move UI Cards" in the top navigation bar or the button below. All dashboard cards (Bot Status, Console, Fleet Cards) unlock so you can drag and reposition them anywhere with your mouse.</p>
                            <button class="guide-action-btn" onclick="SpatialStudio.toggleDraggableUIMode(true); SpatialStudio.closeMoveableGuide();">Turn ON Draggable UI</button>
                        </div>
                    </div>

                    <div class="guide-card-item">
                        <div class="guide-card-icon">🧱</div>
                        <div class="guide-card-content">
                            <h4>3. Interactive 3D Background Voxels</h4>
                            <p>Hover over any of the floating Minecraft ore blocks in the background and click & drag with your mouse to rotate and move them in 3D WebGL space.</p>
                            <button class="guide-action-btn" onclick="SpatialStudio.closeMoveableGuide()">Try on Background</button>
                        </div>
                    </div>

                    <div class="guide-card-item">
                        <div class="guide-card-icon">✨</div>
                        <div class="guide-card-content">
                            <h4>4. 3D Spatial & Glassmorphism Studio</h4>
                            <p>Customize spatial perspective depth, mouse tilt intensity, glass blur, theme colors, and particle animations in real time.</p>
                            <button class="guide-action-btn" onclick="SpatialStudio.closeMoveableGuide(); SpatialStudio.openModal();">Open 3D Studio</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    function showMoveableGuide() {
        ensureHelpGuideModalDOM();
        const modal = document.getElementById('spatialHelpGuideModal');
        if (modal) {
            modal.style.display = 'flex';
            playSound('pop');
        }
    }

    function closeMoveableGuide() {
        const modal = document.getElementById('spatialHelpGuideModal');
        if (modal) modal.style.display = 'none';
    }

    function highlightWidget() {
        closeMoveableGuide();
        const widget = document.getElementById('spatial3dFloatingWidget');
        if (widget) {
            widget.classList.remove('minimized');
            widget.style.transform = 'scale(1.1)';
            playSound('success');
            setTimeout(() => {
                widget.style.transform = 'scale(1)';
            }, 350);
        }
    }

    // --- MOUSE GLOW FOLLOWER ENGINE ---
    let glowX = window.innerWidth / 2, glowY = window.innerHeight / 2;
    let targetGlowX = glowX, targetGlowY = glowY;

    function setupMouseGlowFollower() {
        const glowEl = document.getElementById('mouseSpatialGlow');
        if (!glowEl) return;

        window.addEventListener('mousemove', (e) => {
            targetGlowX = e.clientX;
            targetGlowY = e.clientY;
        }, { passive: true });

        function updateGlowPosition() {
            if (currentConfig.mouseGlow) {
                glowX += (targetGlowX - glowX) * 0.15;
                glowY += (targetGlowY - glowY) * 0.15;
                glowEl.style.left = `${glowX}px`;
                glowEl.style.top = `${glowY}px`;
                glowEl.style.display = 'block';
            } else {
                glowEl.style.display = 'none';
            }
            requestAnimationFrame(updateGlowPosition);
        }
        requestAnimationFrame(updateGlowPosition);
    }

    // --- CLICK SPARK PARTICLES BURST ---
    function setupClickSparks() {
        document.addEventListener('click', (e) => {
            if (!currentConfig.clickSparks) return;
            // Play click audio
            playSound('click');

            const sparkCount = 7;
            const colors = [currentConfig.themeAccent, '#ffffff', '#00d4ff'];

            for (let i = 0; i < sparkCount; i++) {
                const spark = document.createElement('div');
                spark.className = 'spatial-spark';
                spark.style.left = `${e.clientX}px`;
                spark.style.top = `${e.clientY}px`;
                spark.style.backgroundColor = colors[i % colors.length];

                const angle = Math.random() * Math.PI * 2;
                const distance = 25 + Math.random() * 45;
                const tx = Math.cos(angle) * distance;
                const ty = Math.sin(angle) * distance;

                spark.style.setProperty('--spark-tx', `${tx}px`);
                spark.style.setProperty('--spark-ty', `${ty}px`);

                document.body.appendChild(spark);
                setTimeout(() => spark.remove(), 700);
            }
        });
    }

    // --- SCROLL ANIMATION & PROGRESS BAR ---
    function setupScrollAnimations() {
        const mainEl = document.querySelector('main');
        const progressEl = document.getElementById('scrollProgressBar');
        const scrollBtn = document.getElementById('btnScrollToTop');

        if (!mainEl) return;

        mainEl.addEventListener('scroll', () => {
            const scrollTop = mainEl.scrollTop;
            const scrollHeight = mainEl.scrollHeight - mainEl.clientHeight;
            const percent = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;

            if (progressEl) {
                if (currentConfig.scrollProgressBar) {
                    progressEl.style.width = `${percent}%`;
                    progressEl.style.display = 'block';
                } else {
                    progressEl.style.display = 'none';
                }
            }

            if (scrollBtn) {
                if (scrollTop > 180) {
                    scrollBtn.classList.add('visible');
                } else {
                    scrollBtn.classList.remove('visible');
                }
            }
        }, { passive: true });

        if (scrollBtn) {
            scrollBtn.addEventListener('click', () => {
                playSound('pop');
                mainEl.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }
    }

    // --- PAGE TRANSITION CHOREOGRAPHER ---
    function triggerPageTransition(targetViewId) {
        playSound('page');
        const viewEl = document.getElementById('view-' + targetViewId);
        if (!viewEl) return;

        // Remove old transition classes
        viewEl.classList.remove('page-enter-spatial', 'page-enter-holo', 'page-enter-slide');

        const mode = currentConfig.pageAnimation;
        if (mode === 'spatial') {
            viewEl.classList.add('page-enter-spatial');
        } else if (mode === 'holo') {
            viewEl.classList.add('page-enter-holo');
        } else if (mode === 'slide') {
            viewEl.classList.add('page-enter-slide');
        }

        // Clean up animation class once animation completes to keep DOM calm and eliminate flicker
        setTimeout(() => {
            if (viewEl) {
                viewEl.classList.remove('page-enter-spatial', 'page-enter-holo', 'page-enter-slide');
            }
        }, 480);
    }

    // --- APPLY CSS VARIABLES REACTIVELY ---
    function applyConfigToDOM(config) {
        const root = document.documentElement;

        // Accent & RGB
        root.style.setProperty('--accent', config.themeAccent);
        const rgb = hexToRgb(config.themeAccent) || { r: 16, g: 185, b: 129 };
        root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        root.style.setProperty('--accent-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
        root.style.setProperty('--accent-glow-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`);

        // Glassmorphism
        root.style.setProperty('--glass-blur', `${config.glassBlur}px`);
        root.style.setProperty('--glass-opacity', config.glassOpacity);
        root.style.setProperty('--glass-card-opacity', (config.glassOpacity * 0.92).toFixed(2));
        root.style.setProperty('--glass-border-opacity', config.glassBorderOpacity);

        // 3D Spatial
        root.style.setProperty('--spatial-depth-level', `${config.spatialDepthPx}px`);
        root.style.setProperty('--spatial-depth-z', `${config.spatialDepthPx}px`);
        root.style.setProperty('--spatial-tilt-intensity', config.mouseTiltSensitivity);

        // Mouse glow
        root.style.setProperty('--mouse-glow-size', `${config.mouseGlowSize}px`);

        // Three.js background updates
        if (threeScene) {
            buildSceneForMode(config.backgroundMode);
        }
    }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }

    function saveConfig(newConfig) {
        currentConfig = Object.assign({}, currentConfig, newConfig);
        try {
            localStorage.setItem('odinlux_spatial_config', JSON.stringify(currentConfig));
        } catch (e) {
            console.error('[SpatialStudio] Could not save config:', e);
        }
        applyConfigToDOM(currentConfig);
    }

    // --- CUSTOMIZATION STUDIO UI MODAL POPULATION & HANDLERS ---
    function openCustomizerModal() {
        playSound('pop');
        const modal = document.getElementById('customizerModal');
        if (!modal) return;
        syncCustomizerFormValues();
        modal.style.display = 'flex';
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    function closeCustomizerModal() {
        playSound('click');
        const modal = document.getElementById('customizerModal');
        if (modal) modal.style.display = 'none';
    }

    function syncCustomizerFormValues() {
        // Theme swatches
        document.querySelectorAll('.theme-swatch-btn').forEach(btn => {
            const color = btn.getAttribute('data-color');
            if (color && color.toLowerCase() === currentConfig.themeAccent.toLowerCase()) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Custom color input
        const customColorInp = document.getElementById('studioCustomColor');
        if (customColorInp) customColorInp.value = currentConfig.themeAccent;

        // Sliders
        const setSlider = (id, val, valId, suffix = '') => {
            const el = document.getElementById(id);
            const valEl = document.getElementById(valId);
            if (el) el.value = val;
            if (valEl) valEl.textContent = `${val}${suffix}`;
        };

        setSlider('sliderGlassBlur', currentConfig.glassBlur, 'valGlassBlur', 'px');
        setSlider('sliderGlassOpacity', Math.round(currentConfig.glassOpacity * 100), 'valGlassOpacity', '%');
        setSlider('sliderBorderGlow', Math.round(currentConfig.glassBorderOpacity * 100), 'valBorderGlow', '%');
        setSlider('sliderSpatialDepth', currentConfig.spatialDepthPx, 'valSpatialDepth', 'px');
        setSlider('sliderMouseGlow', currentConfig.mouseGlowSize, 'valMouseGlow', 'px');
        setSlider('sliderSoundVol', Math.round(currentConfig.soundVolume * 100), 'valSoundVol', '%');

        // Segmented controls
        setSegmentActive('segBgMode', currentConfig.backgroundMode);
        setSegmentActive('segPageAnim', currentConfig.pageAnimation);

        // Switches
        const setSwitch = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.checked = !!val;
        };
        setSwitch('switchMouseTilt', currentConfig.mouseTilt);
        setSwitch('switchMouseGlow', currentConfig.mouseGlow);
        setSwitch('switchClickSparks', currentConfig.clickSparks);
        setSwitch('switchScrollProgress', currentConfig.scrollProgressBar);
        setSwitch('switchSoundFX', currentConfig.soundFX);
    }

    function setSegmentActive(containerId, value) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.querySelectorAll('.studio-segment-btn').forEach(btn => {
            if (btn.getAttribute('data-value') === value) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    function bindCustomizerEvents() {
        // Theme swatch click
        document.querySelectorAll('.theme-swatch-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const color = btn.getAttribute('data-color');
                const name = btn.getAttribute('data-name') || 'Custom Theme';
                if (color) {
                    playSound('click');
                    saveConfig({ themeAccent: color, themeAccentName: name });
                    syncCustomizerFormValues();
                }
            });
        });

        // Custom color input
        const customColorInp = document.getElementById('studioCustomColor');
        if (customColorInp) {
            customColorInp.addEventListener('input', (e) => {
                saveConfig({ themeAccent: e.target.value, themeAccentName: 'Custom Palette' });
            });
        }

        // Sliders
        const bindSlider = (id, key, valId, multiplier = 1, suffix = '') => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', (e) => {
                const num = parseFloat(e.target.value) * multiplier;
                const update = {};
                update[key] = num;
                saveConfig(update);
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = `${e.target.value}${suffix}`;
            });
        };

        bindSlider('sliderGlassBlur', 'glassBlur', 'valGlassBlur', 1, 'px');
        bindSlider('sliderGlassOpacity', 'glassOpacity', 'valGlassOpacity', 0.01, '%');
        bindSlider('sliderBorderGlow', 'glassBorderOpacity', 'valBorderGlow', 0.01, '%');
        bindSlider('sliderSpatialDepth', 'spatialDepthPx', 'valSpatialDepth', 1, 'px');
        bindSlider('sliderMouseGlow', 'mouseGlowSize', 'valMouseGlow', 1, 'px');
        bindSlider('sliderSoundVol', 'soundVolume', 'valSoundVol', 0.01, '%');

        // Segmented buttons
        document.querySelectorAll('.studio-segmented').forEach(container => {
            const settingKey = container.getAttribute('data-setting');
            container.querySelectorAll('.studio-segment-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const val = btn.getAttribute('data-value');
                    playSound('click');
                    const update = {};
                    update[settingKey] = val;
                    saveConfig(update);
                    container.querySelectorAll('.studio-segment-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                });
            });
        });

        // Toggles
        const bindToggle = (id, key) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', (e) => {
                playSound('click');
                const update = {};
                update[key] = e.target.checked;
                saveConfig(update);
            });
        };

        bindToggle('switchMouseTilt', 'mouseTilt');
        bindToggle('switchMouseGlow', 'mouseGlow');
        bindToggle('switchClickSparks', 'clickSparks');
        bindToggle('switchScrollProgress', 'scrollProgressBar');
        bindToggle('switchSoundFX', 'soundFX');

        // Preset buttons
        document.querySelectorAll('.btn-preset-load').forEach(btn => {
            btn.addEventListener('click', () => {
                const presetKey = btn.getAttribute('data-preset');
                if (PRESETS[presetKey]) {
                    playSound('success');
                    saveConfig(PRESETS[presetKey]);
                    syncCustomizerFormValues();
                    if (window.showToast) {
                        window.showToast(`Applied preset: ${PRESETS[presetKey].name}`);
                    }
                }
            });
        });

        // Reset to Defaults button
        const btnReset = document.getElementById('btnStudioReset');
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                playSound('pop');
                saveConfig(DEFAULT_CONFIG);
                syncCustomizerFormValues();
                if (window.showToast) {
                    window.showToast('Reset to default 3D spatial settings');
                }
            });
        }
    }

    // --- INITIALIZATION ---
    window.addEventListener('DOMContentLoaded', () => {
        applyConfigToDOM(currentConfig);
        initThreeSpatialScene();
        setupCardTiltEngine();
        setupDraggableModals();
        setup3DObjectMouseInteraction();
        initFloating3DWidget();
        ensureHelpGuideModalDOM();
        setupMouseGlowFollower();
        setupClickSparks();
        setupScrollAnimations();
        bindCustomizerEvents();

        // Window resize for Three.js
        window.addEventListener('resize', () => {
            if (threeRenderer && threeCamera) {
                const w = window.innerWidth;
                const h = window.innerHeight;
                threeCamera.aspect = w / h;
                threeCamera.updateProjectionMatrix();
                threeRenderer.setSize(w, h);
            }
        });
    });

    // Expose global controller
    window.SpatialStudio = {
        openModal: openCustomizerModal,
        closeModal: closeCustomizerModal,
        onPageTransition: triggerPageTransition,
        playSound: playSound,
        getConfig: () => currentConfig,
        applyPreset: (key) => {
            if (PRESETS[key]) saveConfig(PRESETS[key]);
        },
        toggleDraggableUIMode: toggleDraggableUIMode,
        resetUILayout: resetUILayout,
        showMoveableGuide: showMoveableGuide,
        closeMoveableGuide: closeMoveableGuide,
        highlightWidget: highlightWidget,
        changeWidgetBlock: changeWidgetBlock
    };

})();
