const connection = new signalR.HubConnectionBuilder()
    .withUrl("/gameHub")
    .withAutomaticReconnect()
    .build();

let myName = "";
let myRole = ""; // "Admin" or "Player"
let roomCode = "";
let currentPlayerName = "";
let turnStartTime = null;
let timerInterval = null;
let playerTimes = {};

const sections = ['section-initial', 'section-lobby', 'section-game', 'section-gameover'];

function showSection(id) {
    sections.forEach(s => {
        document.getElementById(s).classList.add('d-none');
    });
    document.getElementById(id).classList.remove('d-none');
}

function exitRoom() {
    if (confirm("¿Estás seguro de que deseas salir de la sala?")) {
        location.reload();
    }
}

const elLoading = document.getElementById('loading-overlay');
const elMainCard = document.getElementById('main-card');

function init() {
    connection.start().then(() => {
        elLoading.style.opacity = '0';
        setTimeout(() => {
            elLoading.classList.add('d-none');
            elMainCard.style.display = 'block';
        }, 300);
    }).catch(err => {
        console.error(err);
        alert("Error al conectar con el servidor. Revisa tu conexión.");
    });
}
init();

function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s}.${ms}`;
}

function startTimer() {
    stopTimer();
    turnStartTime = Date.now();
    timerInterval = setInterval(() => {
        const elapsed = (Date.now() - turnStartTime) / 1000;
        document.getElementById('stopwatch').innerText = formatTime(elapsed);
    }, 100);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

async function copyCode() {
    try {
        await navigator.clipboard.writeText(roomCode);
        const fb = document.getElementById('copy-feedback');
        fb.style.opacity = '1';
        fb.style.transform = 'translateY(0px)';
        setTimeout(() => {
            fb.style.opacity = '0';
            fb.style.transform = 'translateY(-10px)';
        }, 2000);
    } catch (e) {
        console.error("Clipboard copy failed", e);
    }
}

document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('admin-name').value.trim();
    if (!name) return alert("Por favor, ingresa tu nombre.");
    myName = name;
    myRole = "Admin";
    document.getElementById('admin-name').disabled = true;
    const btn = document.getElementById('btn-create');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Creando...';
    connection.invoke("CreateRoom", name);
});

document.getElementById('btn-join').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    const code = document.getElementById('join-code').value.trim();
    if (!name || code.length !== 6) return alert("Ingresa tu nombre y un código válido de 6 dígitos.");
    myName = name;
    myRole = "Player";
    const btn = document.getElementById('btn-join');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Uniéndose...';
    connection.invoke("JoinRoom", code, name);
});

document.getElementById('btn-start').addEventListener('click', () => {
    connection.invoke("StartGame", roomCode);
});

function submitColor() {
    const color = document.getElementById('color-input').value.trim();
    if (!color) return;
    
    stopTimer();
    const elapsedSeconds = (Date.now() - turnStartTime) / 1000;
    
    document.getElementById('color-input').value = '';
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('color-input').disabled = true;
    
    connection.invoke("SubmitColor", roomCode, color, elapsedSeconds);
}

document.getElementById('btn-submit').addEventListener('click', submitColor);
document.getElementById('color-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitColor();
});

document.getElementById('btn-reset').addEventListener('click', () => {
    connection.invoke("ResetGame", roomCode);
});

// SignalR Events
connection.on("RoomCreated", (code) => {
    roomCode = code;
    setupLobby([myName], true);
});

connection.on("JoinError", (msg) => {
    alert(msg);
    const btn = document.getElementById('btn-join');
    btn.disabled = false;
    btn.innerHTML = 'Unirse';
});

connection.on("JoinedRoom", (code, playerNames) => {
    roomCode = code;
    setupLobby(playerNames, false);
});

connection.on("PlayerJoined", (playerName, playerNames) => {
    updateLobbyPlayers(playerNames);
});

connection.on("PlayerLeft", (playerName, playerNames) => {
    updateLobbyPlayers(playerNames);
});

connection.on("AdminLeft", () => {
    alert("El administrador ha cerrado la sala.");
    location.reload();
});

function setupLobby(playerNames, isAdmin) {
    showSection('section-lobby');
    document.getElementById('display-room-code').innerText = roomCode;
    document.getElementById('global-exit-controls').classList.remove('d-none');
    
    if (isAdmin) {
        document.getElementById('admin-controls').classList.remove('d-none');
        document.getElementById('player-wait-msg').classList.add('d-none');
    } else {
        document.getElementById('admin-controls').classList.add('d-none');
        document.getElementById('player-wait-msg').classList.remove('d-none');
    }
    
    updateLobbyPlayers(playerNames);
}

function updateLobbyPlayers(names) {
    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    names.forEach((n, idx) => {
        const isAdm = idx === 0;
        const badge = document.createElement('span');
        badge.className = `badge ${isAdm ? 'badge-glow border-warning text-warning' : 'glass-inner border text-light'} fs-5 py-2 px-3 rounded-pill`;
        badge.innerHTML = isAdm ? `👑 ${n}` : `👾 ${n}`;
        list.appendChild(badge);
    });
    document.getElementById('player-count').innerText = names.length;
    
    if (myRole === 'Admin') {
        const startBtn = document.getElementById('btn-start');
        startBtn.disabled = names.length < 2;
        if(names.length >= 2) {
            startBtn.classList.remove('btn-secondary');
            startBtn.classList.add('btn-success');
        } else {
            startBtn.classList.add('btn-secondary');
            startBtn.classList.remove('btn-success');
        }
    }
}

connection.on("GameStarted", (firstPlayerName, allPlayerNames) => {
    playerTimes = {};
    allPlayerNames.forEach(n => playerTimes[n] = 0);
    document.getElementById('used-colors').innerHTML = '';
    document.getElementById('last-color-display').classList.add('d-none');
    setupTurn(firstPlayerName, true);
});

connection.on("NextTurn", (nextPlayerName, submittedColor, prevPlayerName) => {
    if (submittedColor && prevPlayerName) {
        document.getElementById('last-color-display').classList.remove('d-none');
        document.getElementById('last-player-name').innerText = prevPlayerName;
        document.getElementById('last-color').innerText = submittedColor;

        const div = document.createElement('span');
        div.className = 'badge glass-inner text-light border border-secondary border-opacity-50 fs-6 p-2 px-3 rounded-pill shadow-sm';
        div.innerHTML = `<span class="neon-text-cyan">${submittedColor}</span> <span class="opacity-50 small ms-1">(${prevPlayerName})</span>`;
        document.getElementById('used-colors').appendChild(div);
    }
    setupTurn(nextPlayerName, false);
});

function setupTurn(playerName, isFirstTurn) {
    if(isFirstTurn) showSection('section-game');
    currentPlayerName = playerName;
    
    document.getElementById('current-player-name').innerText = playerName;
    
    const turnBox = document.getElementById('turn-box');
    const isMyTurn = myRole === 'Player' && myName === playerName;
    
    if (isMyTurn) {
        turnBox.classList.add('active-my-turn');
        
        document.getElementById('my-turn-controls').classList.remove('d-none');
        document.getElementById('not-my-turn').classList.add('d-none');
        
        const input = document.getElementById('color-input');
        input.disabled = false;
        document.getElementById('btn-submit').disabled = false;
        setTimeout(() => input.focus(), 100);
    } else {
        turnBox.classList.remove('active-my-turn');
        
        document.getElementById('my-turn-controls').classList.add('d-none');
        document.getElementById('not-my-turn').classList.remove('d-none');
        document.getElementById('waiting-for-name').innerText = playerName;
    }
    
    updateLiveScores();
    startTimer();
}

function updateLiveScores() {
    const list = document.getElementById('live-scores');
    list.innerHTML = '';
    for (const [name, time] of Object.entries(playerTimes)) {
        // Skip showing the admin in the time scores since they don't play
        if (myRole === 'Admin' && name === myName) continue; 
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center fw-bold text-light';
        li.innerHTML = `<span><span class="opacity-50 me-2">👾</span>${name}</span><span class="badge badge-glow rounded-pill p-2 fs-6">${formatTime(time)}</span>`;
        list.appendChild(li);
    }
}

connection.on("GameOver", (loserName, losingColor, totalSeconds, scores) => {
    stopTimer();
    showSection('section-gameover');
    
    document.getElementById('loser-name').innerText = loserName;
    document.getElementById('losing-color').innerText = losingColor;
    document.getElementById('total-game-time').innerText = formatTime(totalSeconds);
    
    const tbody = document.getElementById('final-scores');
    tbody.innerHTML = '';
    scores.forEach((s, i) => {
        const isLoser = s.name === loserName;
        const tr = document.createElement('tr');
        if (isLoser) tr.className = 'glass-inner border-danger bg-danger bg-opacity-10';
        else tr.className = 'border-bottom border-secondary border-opacity-25';
        
        tr.innerHTML = `<td class="fw-bold fs-5 ps-3 py-3 rounded-start ${isLoser?'text-danger':''}">${i+1}. ${s.name} ${isLoser ? '☠️' : '🏆'}</td><td class="text-end fw-bold fs-5 pe-3 py-3 rounded-end ${isLoser?'text-danger':'neon-text-cyan'}">${formatTime(s.accumulatedSeconds)}</td>`;
        tbody.appendChild(tr);
    });
    
    if (myRole === 'Admin') {
        document.getElementById('admin-reset-controls').classList.remove('d-none');
        document.getElementById('player-reset-msg').classList.add('d-none');
    } else {
        document.getElementById('admin-reset-controls').classList.add('d-none');
        document.getElementById('player-reset-msg').classList.remove('d-none');
    }
});

connection.on("GameReset", (playerNames) => {
    updateLobbyPlayers(playerNames);
    showSection('section-lobby');
});
