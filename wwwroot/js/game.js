const connection = new signalR.HubConnectionBuilder()
    .withUrl("/gameHub")
    .withAutomaticReconnect()
    .build();

let myName = "";
let myRole = "";
let roomCode = "";
let currentPlayerName = "";
let turnStartTime = null;
let timerInterval = null;
let playerTimes = {};
let playerPoints = {};
let playerStreaks = {};
let selectedRounds = 3;

const sections = ['section-initial', 'section-lobby', 'section-game', 'section-gameover', 'section-tournament'];

function showSection(id) {
    sections.forEach(s => document.getElementById(s).classList.add('d-none'));
    document.getElementById(id).classList.remove('d-none');
}

function exitRoom() {
    if (confirm("¿Estás seguro de que deseas salir de la sala?")) location.reload();
}

async function copyCode() {
    try {
        await navigator.clipboard.writeText(roomCode);
        const fb = document.getElementById('copy-feedback');
        fb.style.opacity = '1';
        fb.style.transform = 'translateY(0px)';
        setTimeout(() => { fb.style.opacity = '0'; fb.style.transform = 'translateY(-10px)'; }, 2000);
    } catch (e) { console.error(e); }
}

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
        document.getElementById('stopwatch').innerText = formatTime((Date.now() - turnStartTime) / 1000);
    }, 100);
}

function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

const elLoading = document.getElementById('loading-overlay');
const elMainCard = document.getElementById('main-card');

connection.start().then(() => {
    elLoading.style.opacity = '0';
    setTimeout(() => { elLoading.classList.add('d-none'); elMainCard.style.display = 'block'; }, 300);
}).catch(err => { console.error(err); alert("Error al conectar."); });

// === ROUNDS SELECTOR ===
document.querySelectorAll('.round-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.round-select-btn').forEach(b => b.style.opacity = '0.4');
        btn.style.opacity = '1';
        selectedRounds = parseInt(btn.dataset.rounds);
        document.getElementById('selected-rounds').innerText = selectedRounds;
    });
});

// === CREATE / JOIN ===
document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('admin-name').value.trim();
    if (!name) return alert("Por favor, ingresa tu nombre.");
    myName = name; myRole = "Admin";
    document.getElementById('btn-create').disabled = true;
    connection.invoke("CreateRoom", name);
});

document.getElementById('btn-join').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    const code = document.getElementById('join-code').value.trim();
    if (!name || code.length !== 6) return alert("Ingresa tu nombre y un código de 6 dígitos.");
    myName = name; myRole = "Player";
    document.getElementById('btn-join').disabled = true;
    connection.invoke("JoinRoom", code, name);
});

document.getElementById('btn-start').addEventListener('click', () => {
    connection.invoke("StartGame", roomCode, selectedRounds);
});

function submitColor() {
    const color = document.getElementById('color-input').value.trim();
    if (!color) return;
    stopTimer();
    const elapsed = (Date.now() - turnStartTime) / 1000;
    document.getElementById('color-input').value = '';
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('color-input').disabled = true;
    connection.invoke("SubmitColor", roomCode, color, elapsed);
}
document.getElementById('btn-submit').addEventListener('click', submitColor);
document.getElementById('color-input').addEventListener('keypress', e => { if (e.key === 'Enter') submitColor(); });

document.getElementById('btn-reset').addEventListener('click', () => connection.invoke("ResetGame", roomCode));
document.getElementById('btn-newgame').addEventListener('click', () => {
    // Go back to lobby for a new tournament
    connection.invoke("ResetGame", roomCode);
});

// === SIGNALR EVENTS ===
connection.on("RoomCreated", code => { roomCode = code; setupLobby([myName], true); });
connection.on("JoinError", msg => { alert(msg); document.getElementById('btn-join').disabled = false; });
connection.on("JoinedRoom", (code, names) => { roomCode = code; setupLobby(names, false); });
connection.on("PlayerJoined", (name, names) => updateLobbyPlayers(names));
connection.on("PlayerLeft", (name, names) => updateLobbyPlayers(names));
connection.on("AdminLeft", () => { alert("El administrador cerró la sala."); location.reload(); });

function setupLobby(names, isAdmin) {
    showSection('section-lobby');
    document.getElementById('display-room-code').innerText = roomCode;
    document.getElementById('global-exit-controls').classList.remove('d-none');
    document.getElementById(isAdmin ? 'admin-controls' : 'player-wait-msg').classList.remove('d-none');
    document.getElementById(isAdmin ? 'player-wait-msg' : 'admin-controls').classList.add('d-none');
    updateLobbyPlayers(names);
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
    }
}

connection.on("GameStarted", (firstPlayerName, allPlayerNames, currentRound, maxRounds) => {
    playerTimes = {};
    playerPoints = {};
    playerStreaks = {};
    allPlayerNames.forEach(n => { playerTimes[n] = 0; playerPoints[n] = 0; playerStreaks[n] = 0; });
    document.getElementById('round-badge').innerText = currentRound;
    document.getElementById('max-rounds-badge').innerText = maxRounds;
    setupTurn(firstPlayerName, true);
});

connection.on("NextTurn", (nextPlayerName, submittedColor, prevPlayerName, streaks) => {
    if (streaks) {
        streaks.forEach(s => {
            playerStreaks[s.name] = s.streak;
            playerPoints[s.name] = s.totalPoints;
        });
    }
    setupTurn(nextPlayerName, false);
});

function setupTurn(playerName, isFirst) {
    if (isFirst) showSection('section-game');
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
    const sorted = Object.keys(playerTimes).sort((a, b) => (playerPoints[b] || 0) - (playerPoints[a] || 0));
    sorted.forEach(name => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center fw-bold text-light small';
        const streak = playerStreaks[name] || 0;
        const streakHtml = streak > 0 ? `<span class="text-warning ms-1">🔥${streak}</span>` : '';
        li.innerHTML = `
            <span><span class="opacity-50 me-2">👾</span>${name}${streakHtml}</span>
            <span class="d-flex gap-2 align-items-center">
                <span class="badge badge-glow rounded-pill px-2 py-1">${playerPoints[name] || 0} pts</span>
                <span class="opacity-50 font-monospace">${formatTime(playerTimes[name] || 0)}</span>
            </span>
        `;
        list.appendChild(li);
    });
}

function renderFinalScores(scores, loserName) {
    const tbody = document.getElementById('final-scores');
    tbody.innerHTML = '';
    scores.forEach((s, i) => {
        const isLoser = s.name === loserName;
        const tr = document.createElement('tr');
        tr.className = isLoser ? 'border-bottom border-danger border-opacity-25' : 'border-bottom border-secondary border-opacity-15';
        const colorsHtml = s.colors && s.colors.length > 0
            ? s.colors.map(c => `<span class="badge border border-light border-opacity-15 text-light fw-normal px-2 me-1 mb-1" style="background: rgba(255,255,255,0.05)">${c}</span>`).join('')
            : '<span class="opacity-50 fst-italic small">—</span>';
        const streakHtml = s.currentStreak > 0 ? `🔥 ${s.currentStreak}` : '—';
        tr.innerHTML = `
            <td class="fw-bold ps-3 py-3 ${isLoser ? 'text-danger' : ''}">${i + 1}. ${s.name} ${isLoser ? '☠️' : '🏆'}</td>
            <td class="py-3 px-2">${colorsHtml}</td>
            <td class="text-center py-3 ${isLoser ? 'text-danger' : 'text-success'}">+${s.roundPoints || 0}</td>
            <td class="text-center py-3 fw-bold neon-text-cyan">${s.totalPoints}</td>
            <td class="text-end pe-3 py-3 text-warning">${streakHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

connection.on("GameOver", (loserName, losingColor, totalSeconds, scores, currentRound, maxRounds) => {
    stopTimer();
    showSection('section-gameover');
    scores.forEach(s => { playerPoints[s.name] = s.totalPoints; playerStreaks[s.name] = s.currentStreak; });
    document.getElementById('loser-name').innerText = loserName;
    document.getElementById('losing-color').innerText = losingColor;
    document.getElementById('total-game-time').innerText = formatTime(totalSeconds);
    document.getElementById('gameover-round').innerText = currentRound;
    document.getElementById('gameover-maxrounds').innerText = maxRounds;
    renderFinalScores(scores, loserName);
    if (myRole === 'Admin') {
        document.getElementById('admin-reset-controls').classList.remove('d-none');
        document.getElementById('player-reset-msg').classList.add('d-none');
    } else {
        document.getElementById('admin-reset-controls').classList.add('d-none');
        document.getElementById('player-reset-msg').classList.remove('d-none');
    }
});

connection.on("TournamentOver", (loserName, losingColor, totalSeconds, scores, championName, podium, currentRound, maxRounds) => {
    stopTimer();
    showSection('section-tournament');
    document.getElementById('champion-name').innerText = championName;
    const podiumEl = document.getElementById('podium-list');
    podiumEl.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    podium.forEach((p, i) => {
        const isChamp = p.name === championName && i === 0;
        const div = document.createElement('div');
        div.className = `d-flex justify-content-between align-items-center py-3 px-4 mb-2 glass-inner ${isChamp ? 'border border-warning border-opacity-50' : ''}`;
        const streakHtml = p.currentStreak > 0 ? `<span class="text-warning ms-2 small">🔥${p.currentStreak}</span>` : '';
        div.innerHTML = `
            <span class="fw-bold fs-5">${medals[i] || `${i + 1}.`} ${p.name}${streakHtml}</span>
            <span class="neon-text-cyan fw-bold fs-4">${p.totalPoints} <small class="opacity-50">pts</small></span>
        `;
        podiumEl.appendChild(div);
    });
    if (myRole === 'Admin') {
        document.getElementById('admin-newgame-controls').classList.remove('d-none');
        document.getElementById('player-wait-tournament').classList.add('d-none');
    } else {
        document.getElementById('admin-newgame-controls').classList.add('d-none');
        document.getElementById('player-wait-tournament').classList.remove('d-none');
    }
});

connection.on("GameReset", (playerNames, firstPlayerName, currentRound, maxRounds, currentScores) => {
    playerTimes = {};
    playerNames.forEach(n => playerTimes[n] = 0);
    if (currentScores) currentScores.forEach(s => { playerPoints[s.name] = s.totalPoints; playerStreaks[s.name] = s.currentStreak; });
    document.getElementById('round-badge').innerText = currentRound;
    document.getElementById('max-rounds-badge').innerText = maxRounds;
    showSection('section-game');
    setupTurn(firstPlayerName, false);
});
