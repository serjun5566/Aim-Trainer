const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreElement = document.getElementById('score');
const timerElement = document.getElementById('timer');
const startMenu = document.getElementById('startMenu');
const lobbyMenu = document.getElementById('lobbyMenu');
const sensRange = document.getElementById('sensRange');
const sensValue = document.getElementById('sensValue');
const leaderList = document.getElementById('leaderList');

let score = 0, timeLeft = 30, targets = [], gameActive = false;
let sensitivity = 1.0, crosshairX = 0, crosshairY = 0;

// 連線與狀態變數
let peer = null, conn = null;
let myReady = false, peerReady = false;
let playersScores = {};

// 1. 生成 5 位代碼
function generateId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let res = '';
    for(let i=0; i<5; i++) res += chars[Math.floor(Math.random()*chars.length)];
    return res;
}

// 2. 初始化 Peer
function reinitializePeer() {
    if (peer) peer.destroy();
    const cid = document.getElementById('myCustomId').value.toUpperCase() || generateId();
    document.getElementById('myCustomId').value = cid;
    
    peer = new Peer(cid);
    peer.on('open', (id) => {
        document.getElementById('currentIdDisplay').innerText = id;
        document.getElementById('myLobbyId').innerText = id;
        playersScores[id] = 0;
        updateLeaderboard();
    });
    peer.on('connection', (c) => setupConnection(c));
    peer.on('error', (err) => { if(err.type === 'unavailable-id') alert('ID 已被佔用！'); });
}

document.getElementById('myCustomId').value = generateId();
reinitializePeer();

function connectToPeer() {
    const tid = document.getElementById('peerIdInput').value.toUpperCase();
    if (tid) setupConnection(peer.connect(tid));
}

function setupConnection(c) {
    conn = c;
    startMenu.style.display = 'none';
    lobbyMenu.style.display = 'block';
    document.getElementById('connectionStatus').innerText = "狀態: 已連線";
    document.getElementById('connectionStatus').style.color = "#00ff88";
    document.getElementById('peerLobbyId').innerText = conn.peer;

    conn.on('data', (data) => {
        if (data.type === 'readyStatus') {
            peerReady = data.status;
            updateLobbyUI();
            checkAllReady();
        } else if (data.type === 'gameStart') {
            realStartGame();
        } else if (data.type === 'scoreUpdate') {
            playersScores[data.id] = data.score;
            updateLeaderboard();
        }
    });
}

// 3. 準備機制
function pressReady() {
    myReady = !myReady;
    document.getElementById('readyBtn').innerText = myReady ? "取消準備" : "準備遊戲";
    updateLobbyUI();
    if (conn) conn.send({ type: 'readyStatus', status: myReady });
    checkAllReady();
}

function updateLobbyUI() {
    const m = document.getElementById('myReadyStatus');
    const p = document.getElementById('peerReadyStatus');
    m.innerText = myReady ? "已準備" : "未準備";
    m.style.background = myReady ? "#00ff88" : "#444";
    if (conn) {
        p.innerText = peerReady ? "已準備" : "未準備";
        p.style.background = peerReady ? "#00ff88" : "#444";
    }
}

function checkAllReady() {
    if (myReady && (conn ? peerReady : true)) {
        if (conn) conn.send({ type: 'gameStart' });
        realStartGame();
    }
}

// 4. 遊戲核心
function realStartGame() {
    if (gameActive) return;
    canvas.requestPointerLock();
    score = 0; timeLeft = 30; targets = []; gameActive = true;
    lobbyMenu.style.display = 'none';
    crosshairX = canvas.width / 2; crosshairY = canvas.height / 2;

    const timerInterval = setInterval(() => {
        if (!gameActive) { clearInterval(timerInterval); return; }
        timeLeft--;
        timerElement.innerText = timeLeft;
        if (timeLeft <= 0) endGame();
    }, 1000);
    animate();
}

class Target {
    constructor() {
        this.radius = 25;
        this.x = Math.random() * (canvas.width - 50) + 25;
        this.y = Math.random() * (canvas.height - 50) + 25;
        this.vx = (Math.random() - 0.5) * 8;
        this.vy = (Math.random() - 0.5) * 8;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        if (this.x + this.radius > canvas.width || this.x - this.radius < 0) this.vx *= -1;
        if (this.y + this.radius > canvas.height || this.y - this.radius < 0) this.vy *= -1;
    }
    draw() {
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = "#00d4ff"; ctx.fill(); ctx.closePath();
    }
}

function animate() {
    if (!gameActive) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (targets.length < 5) targets.push(new Target());
    targets.forEach(t => { t.update(); t.draw(); });
    
    if (document.pointerLockElement === canvas) {
        ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(crosshairX-10, crosshairY); ctx.lineTo(crosshairX+10, crosshairY);
        ctx.moveTo(crosshairX, crosshairY-10); ctx.lineTo(crosshairX, crosshairY+10);
        ctx.stroke();
    }
    requestAnimationFrame(animate);
}

// 5. 事件監聽 (Esc 修正)
canvas.addEventListener('mousedown', () => {
    if (!gameActive) return;
    if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
        return;
    }
    targets.forEach((t, i) => {
        const d = Math.sqrt((crosshairX - t.x)**2 + (crosshairY - t.y)**2);
        if (d < t.radius) {
            targets.splice(i, 1);
            score += 100; scoreElement.innerText = score;
            playersScores[peer.id] = score; updateLeaderboard();
            if (conn) conn.send({ type: 'scoreUpdate', id: peer.id, score: score });
        }
    });
});

window.addEventListener('mousemove', (e) => {
    if (gameActive && document.pointerLockElement === canvas) {
        crosshairX += e.movementX * sensitivity;
        crosshairY += e.movementY * sensitivity;
        crosshairX = Math.max(0, Math.min(canvas.width, crosshairX));
        crosshairY = Math.max(0, Math.min(canvas.height, crosshairY));
    }
});

sensRange.addEventListener('input', (e) => {
    sensitivity = parseFloat(e.target.value);
    sensValue.innerText = sensitivity.toFixed(1);
});

function updateLeaderboard() {
    const sorted = Object.entries(playersScores).sort((a,b)=>b[1]-a[1]).slice(0,5);
    leaderList.innerHTML = sorted.map(([id, s]) => `<li>${id}: ${s}</li>`).join('');
}

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

function endGame() {
    gameActive = false; document.exitPointerLock();
    alert(`遊戲結束！你的分數: ${score}`);
    location.reload();
}