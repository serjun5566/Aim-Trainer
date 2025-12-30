const canvas = document.getElementById('gameCanvas');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const startMenu = document.getElementById('startMenu');
const lobbyMenu = document.getElementById('lobbyMenu');
const sensRange = document.getElementById('sensRange');
const sensValue = document.getElementById('sensValue');
const leaderList = document.getElementById('leaderList');

let score = 0, timeLeft = 30, gameActive = false;
let sensitivity = 0.002, yaw = 0, pitch = 0;
let peer = null, connections = {}, playersState = {};

// --- 3D 初始化 ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(5, 10, 7.5);
scene.add(dirLight);

const grid = new THREE.GridHelper(100, 50, 0x00ff88, 0x222222);
grid.position.y = -2;
scene.add(grid);

let targets = [];
const targetGeo = new THREE.SphereGeometry(0.6, 32, 32);

function spawnTarget() {
    const mat = new THREE.MeshPhongMaterial({ color: 0x00d4ff, emissive: 0x002233 });
    const mesh = new THREE.Mesh(targetGeo, mat);
    mesh.position.set((Math.random()-0.5)*20, Math.random()*5, -Math.random()*15 - 5);
    scene.add(mesh);
    targets.push(mesh);
}

// --- 控制與射擊 ---
document.addEventListener('mousemove', (e) => {
    if (gameActive && document.pointerLockElement === canvas) {
        yaw -= e.movementX * sensitivity;
        pitch -= e.movementY * sensitivity;
        pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
});

const raycaster = new THREE.Raycaster();
window.addEventListener('mousedown', () => {
    if (!gameActive) return;
    if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
    raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = raycaster.intersectObjects(targets);
    if (hits.length > 0) {
        const obj = hits[0].object;
        scene.remove(obj);
        targets = targets.filter(t => t !== obj);
        score += 100;
        scoreElement.innerText = score;
        playersState[peer.id].score = score;
        updateLeaderboard();
        broadcast({ type: 'scoreUpdate', id: peer.id, score: score });
    }
});

// --- 自動進入房間邏輯 ---
function generateRandomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let res = '';
    for (let i = 0; i < 5; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    return res;
}

window.addEventListener('load', () => {
    document.getElementById('roomCodeInput').value = generateRandomCode();
});

function handleEntry() {
    const name = document.getElementById('playerNameInput').value.trim();
    const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    const statusDisplay = document.getElementById('connStatus');

    if (!name || !code) return alert("請輸入名稱與房間代碼！");

    statusDisplay.innerText = "狀態: 正在建立/尋找房間...";
    if (peer) peer.destroy();

    // 嘗試成為房主
    peer = new Peer(code, { debug: 1 });

    peer.on('open', (id) => {
        setupLocalPlayer(name, id, code);
        enterLobby();
        statusDisplay.innerText = "狀態: 房間已建立 (Host)";
    });

    peer.on('connection', setupConnection);

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            // ID 已被佔用，改為加入者
            switchToClient(name, code);
        } else {
            alert("連線失敗: " + err.type);
        }
    });
}

function switchToClient(name, code) {
    if (peer) peer.destroy();
    peer = new Peer(); // 隨機 ID
    peer.on('open', (id) => {
        setupLocalPlayer(name, id, code);
        const conn = peer.connect(code);
        setupConnection(conn);
    });
}

function setupLocalPlayer(name, id, code) {
    playersState[id] = { name: name, ready: false, score: 0 };
    document.getElementById('displayRoomCode').innerText = code;
}

function setupConnection(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;
        enterLobby();
        document.getElementById('connStatus').innerText = "狀態: 已連線";
        conn.send({ type: 'initInfo', name: playersState[peer.id].name });
    });

    conn.on('data', (data) => {
        if (data.type === 'initInfo') {
            playersState[conn.peer] = { name: data.name, ready: false, score: 0 };
            updateLobbyUI();
            if (!data.reply) conn.send({ type: 'initInfo', name: playersState[peer.id].name, reply: true });
        } else if (data.type === 'readyStatus') {
            if (playersState[conn.peer]) {
                playersState[conn.peer].ready = data.status;
                updateLobbyUI();
                checkAllReady();
            }
        } else if (data.type === 'gameStart') {
            realStartGame();
        } else if (data.type === 'scoreUpdate') {
            if (playersState[data.id]) {
                playersState[data.id].score = data.score;
                updateLeaderboard();
            }
        }
    });
}

function broadcast(data) {
    Object.values(connections).forEach(c => { if (c.open) c.send(data); });
}

function pressReady() {
    const myId = peer.id;
    playersState[myId].ready = !playersState[myId].ready;
    const btn = document.getElementById('readyBtn');
    btn.innerText = playersState[myId].ready ? "取消準備" : "準備開始";
    btn.style.background = playersState[myId].ready ? "#ff4757" : "#00ff88";
    
    updateLobbyUI();
    broadcast({ type: 'readyStatus', status: playersState[myId].ready });
    checkAllReady();
}

function updateLobbyUI() {
    const list = document.getElementById('playerList');
    list.innerHTML = Object.entries(playersState).map(([id, s]) => 
        `<div class="player-tag ${s.ready ? 'ready' : ''}">${s.name}${id === peer.id ? ' (我)' : ''}</div>`
    ).join('');
}

function checkAllReady() {
    const players = Object.values(playersState);
    if (players.length >= 1 && players.every(p => p.ready)) {
        broadcast({ type: 'gameStart' });
        setTimeout(realStartGame, 500);
    }
}

function realStartGame() {
    if (gameActive) return;
    gameActive = true;
    lobbyMenu.style.display = 'none';
    document.getElementById('crosshair').style.display = 'block';
    canvas.requestPointerLock();
    const itv = setInterval(() => {
        timeLeft--;
        timerElement.innerText = timeLeft;
        if (timeLeft <= 0) { clearInterval(itv); endGame(); }
    }, 1000);
}

function endGame() {
    gameActive = false;
    document.exitPointerLock();
    document.getElementById('crosshair').style.display = 'none';
    alert(`遊戲結束！得分: ${score}`);
    location.reload();
}

function enterLobby() {
    startMenu.style.display = 'none';
    lobbyMenu.style.display = 'block';
    updateLobbyUI();
}

function updateLeaderboard() {
    const sorted = Object.entries(playersState).sort((a,b)=>b[1].score-a[1].score);
    leaderList.innerHTML = sorted.map(([id, s]) => `<li>${s.name}: ${s.score}</li>`).join('');
}

function render() {
    requestAnimationFrame(render);
    if (gameActive && targets.length < 5) spawnTarget();
    renderer.render(scene, camera);
}
render();

sensRange.addEventListener('input', (e) => {
    sensitivity = parseFloat(e.target.value);
    sensValue.innerText = sensitivity;
});

function leaveLobby() {
    if (peer) peer.destroy();
    location.reload();
}