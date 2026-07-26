document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const screens = {
        mainMenu: document.getElementById('main-menu'),
        lobby: document.getElementById('lobby-screen'),
        game: document.getElementById('game-screen')
    };

    const buttons = {
        host: document.getElementById('btn-host'),
        join: document.getElementById('btn-join'),
        copyCode: document.getElementById('btn-copy-code'),
        startGame: document.getElementById('btn-start-game'),
        leaveLobby: document.getElementById('btn-leave-lobby'),
        passTurn: document.getElementById('btn-pass'),
        nextRound: document.getElementById('btn-next-round'),
        backMenu: document.getElementById('btn-back-menu')
    };

    const inputs = { joinCode: document.getElementById('join-code') };
    const lobby = {
        codeDisplay: document.getElementById('display-room-code'),
        playerCount: document.getElementById('player-count'),
        playersList: document.getElementById('lobby-players')
    };

    const gameUI = {
        board: document.getElementById('board'),
        localHand: document.getElementById('local-hand'),
        turnIndicator: document.getElementById('turn-indicator'),
        gameOverModal: document.getElementById('game-over-modal'),
        gameOverTitle: document.getElementById('game-over-title'),
        gameOverMessage: document.getElementById('game-over-message'),
        scoreBoard: document.getElementById('score-board'),
        toastContainer: document.getElementById('toast-container')
    };

    // --- State ---
    let network = null;
    let game = null;
    let localPlayerId = null;
    let localPlayerName = "Player " + Math.floor(Math.random() * 1000);
    let currentState = null;

    // --- Core Functions ---
    function switchScreen(screenName) {
        Object.values(screens).forEach(s => {
            s.classList.remove('active');
            s.classList.add('hidden');
        });
        screens[screenName].classList.remove('hidden');
        screens[screenName].classList.add('active');
    }

    function showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerText = message;
        gameUI.toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // --- Network Callbacks ---
    const onStateUpdate = (state) => {
        if (network.isHost && state.action) {
            // Process action if host
            game.processAction(state);
            network.broadcastState(game.getState());
            renderGame(game.getState());
        } else if (!network.isHost && !state.action) {
            // Receive state if client
            currentState = state;
            renderGame(state);
        }
    };

    const onPlayerJoin = (players) => {
        lobby.playerCount.innerText = players.length;
        lobby.playersList.innerHTML = '';
        players.forEach(p => {
            const li = document.createElement('li');
            li.innerHTML = `<span>${p.name} ${p.id === network.playerId ? '(You)' : ''}</span> 
                            <span>${p.isHost ? '👑 Host' : ''}</span>`;
            lobby.playersList.appendChild(li);
        });

        if (network.isHost && players.length >= 2) {
            buttons.startGame.classList.remove('hidden');
        } else {
            buttons.startGame.classList.add('hidden');
        }
    };

    const onPlayerLeave = (players) => {
        onPlayerJoin(players);
        showToast("A player left.");
    };

    const onGameStart = (state) => {
        currentState = state;
        switchScreen('game');
        renderGame(state);
    };

    // --- Initialization ---
    function initNetwork() {
        if (!network) {
            network = new PeerNetwork(onStateUpdate, onPlayerJoin, onPlayerLeave, onGameStart);
        }
    }

    // --- Event Listeners ---
    buttons.host.addEventListener('click', async () => {
        buttons.host.disabled = true;
        buttons.host.innerText = "Hosting...";
        initNetwork();
        try {
            const code = await network.hostRoom(localPlayerName);
            localPlayerId = network.playerId;
            game = new DominoGame(); // Only host runs the game engine
            lobby.codeDisplay.innerText = code;
            switchScreen('lobby');
        } catch (e) {
            alert("Failed to host: " + e.message);
        } finally {
            buttons.host.disabled = false;
            buttons.host.innerText = "Host Game";
        }
    });

    buttons.join.addEventListener('click', async () => {
        const code = inputs.joinCode.value.trim();
        if (!code) return alert("Please enter a room code");
        
        buttons.join.disabled = true;
        buttons.join.innerText = "Joining...";
        initNetwork();
        try {
            await network.joinRoom(code, localPlayerName);
            localPlayerId = network.playerId;
            lobby.codeDisplay.innerText = code;
            switchScreen('lobby');
        } catch (e) {
            alert("Failed to join or room full.");
            network.disconnect();
        } finally {
            buttons.join.disabled = false;
            buttons.join.innerText = "Join Game";
        }
    });

    buttons.copyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(lobby.codeDisplay.innerText);
        showToast("Code copied!");
    });

    buttons.leaveLobby.addEventListener('click', () => {
        network.disconnect();
        switchScreen('mainMenu');
    });

    buttons.startGame.addEventListener('click', () => {
        if (!network.isHost) return;
        game.initPlayers(network.players);
        const state = game.startRound();
        network.broadcastStart(state);
        onGameStart(state); // Host triggers its own start
    });

    buttons.nextRound.addEventListener('click', () => {
        if (!network.isHost) return;
        const state = game.startRound(game.roundResult.winnerIndex);
        network.broadcastState(state);
        gameUI.gameOverModal.classList.add('hidden');
        renderGame(state);
    });

    buttons.backMenu.addEventListener('click', () => {
        network.disconnect();
        window.location.reload();
    });

    buttons.passTurn.addEventListener('click', () => {
        network.sendAction({ type: 'PASS' });
    });

    // --- DOM Rendering Tools ---
    
    function createDominoElement(tile, hidden = false, horizontal = false, isBoard = false) {
        const dom = document.createElement('div');
        dom.className = `domino ${hidden ? 'hidden' : ''} ${horizontal ? 'horizontal' : ''}`;
        
        if (!hidden) {
            const half1 = document.createElement('div');
            half1.className = 'domino-half';
            appendDots(half1, tile[0]);
            
            const half2 = document.createElement('div');
            half2.className = 'domino-half';
            appendDots(half2, tile[1]);
            
            dom.appendChild(half1);
            dom.appendChild(half2);
            dom.dataset.t0 = tile[0];
            dom.dataset.t1 = tile[1];
        }
        return dom;
    }

    function appendDots(container, count) {
        const layouts = {
            0: [],
            1: [5],
            2: [1, 9],
            3: [1, 5, 9],
            4: [1, 3, 7, 9],
            5: [1, 3, 5, 7, 9],
            6: [1, 3, 4, 6, 7, 9]
        };
        layouts[count].forEach(pos => {
            const dot = document.createElement('div');
            dot.className = `dot p${pos}`;
            container.appendChild(dot);
        });
    }

    // --- Main Game Render Loop ---
    function renderGame(state) {
        // 1. Identify local player and opponents mapping
        const localIndex = state.players.findIndex(p => p.id === localPlayerId);
        const myPlayer = state.players[localIndex];
        
        // Setup opponent positions based on player count
        const opponents = [];
        let numPlayers = state.players.length;
        for(let i=1; i<numPlayers; i++) {
            opponents.push(state.players[(localIndex + i) % numPlayers]);
        }

        // 2. Render Opponent UI
        // Clear all
        ['top', 'left', 'right'].forEach(pos => {
            document.querySelector(`.${pos}-opponent`).style.visibility = 'hidden';
        });

        if (numPlayers === 2) {
            renderOpponent(opponents[0], 'top');
        } else if (numPlayers === 3) {
            renderOpponent(opponents[0], 'left');
            renderOpponent(opponents[1], 'right');
        } else if (numPlayers === 4) {
            renderOpponent(opponents[0], 'left');
            renderOpponent(opponents[1], 'top');
            renderOpponent(opponents[2], 'right');
        }

        // 3. Render Local Player Info
        document.getElementById('player-local-info').querySelector('.player-name').innerText = "You" + (myPlayer.isTeam2 ? " (Team 2)" : (state.players.length===4 ? " (Team 1)" : ""));
        document.getElementById('player-local-info').querySelector('.player-score').innerText = `Score: ${myPlayer.score}`;
        
        // 4. Render Local Hand
        gameUI.localHand.innerHTML = '';
        const isMyTurn = state.activePlayerId === localPlayerId;
        const validMoves = isMyTurn ? getLocalValidMoves(myPlayer.hand, state.leftEnd, state.rightEnd, state.board.length) : [];
        
        myPlayer.hand.forEach(tile => {
            const domTile = createDominoElement(tile, false, false);
            
            if (isMyTurn) {
                // Check if tile is in validMoves
                const validOptions = validMoves.filter(v => v.tile[0] === tile[0] && v.tile[1] === tile[1]);
                if (validOptions.length > 0) {
                    domTile.classList.add('valid-move');
                    domTile.addEventListener('click', () => handleTileClick(tile, validOptions, state));
                } else {
                    domTile.classList.add('disabled');
                }
            } else {
                domTile.classList.add('disabled');
            }
            gameUI.localHand.appendChild(domTile);
        });

        // 5. Controls & Turn Indicator
        gameUI.turnIndicator.classList.toggle('active-turn', isMyTurn);
        if (isMyTurn) {
            gameUI.turnIndicator.innerText = "Your Turn!";
            // Show Pass button if no valid moves
            if (validMoves.length === 0) {
                buttons.passTurn.classList.remove('hidden');
            } else {
                buttons.passTurn.classList.add('hidden');
            }
        } else {
            const activePlayer = state.players.find(p => p.id === state.activePlayerId);
            gameUI.turnIndicator.innerText = `${activePlayer ? activePlayer.name : 'Waiting'}'s Turn`;
            buttons.passTurn.classList.add('hidden');
        }

        // 6. Render Board
        renderBoard(state.board);

        // 7. Check Game Over states
        if (state.gameState === 'ROUND_OVER' || state.gameState === 'GAME_OVER') {
            showGameOverModal(state);
        } else {
            gameUI.gameOverModal.classList.add('hidden');
        }
    }

    function renderOpponent(player, position) {
        const container = document.querySelector(`.${position}-opponent`);
        container.style.visibility = 'visible';
        
        const info = document.getElementById(`player-${position}-info`);
        info.querySelector('.player-name').innerText = player.name + (player.isTeam2 ? " (T2)" : (currentState.players.length===4 ? " (T1)" : ""));
        info.querySelector('.player-score').innerText = `Score: ${player.score}`;

        const handContainer = document.getElementById(`hand-${position}`);
        handContainer.innerHTML = '';
        const isHorizontal = position === 'top';
        for(let i=0; i<player.handCount; i++) {
            handContainer.appendChild(createDominoElement([0,0], true, isHorizontal));
        }
    }

    function renderBoard(boardTiles) {
        gameUI.board.innerHTML = '';
        if (boardTiles.length === 0) return;

        // Start drawing from center (0,0) relative to board
        let currentX = 0;
        let minX = 0, maxX = 0; // For camera panning

        boardTiles.forEach((bTile, index) => {
            // bTile is { tile: [left, right], rotated: bool, isDouble: bool }
            const isDouble = bTile.tile[0] === bTile.tile[1];
            // In standard dominoes, doubles are placed vertically, others horizontally.
            // A horizontal domino on board is horizontal = true. A double is horizontal = false (vertical).
            const domTile = createDominoElement(bTile.tile, false, !isDouble, true);
            
            // Adjust visual layout based on rotation and chain
            // Simplified rendering: straight line from left to right
            
            // To render nicely, we position absolute in center
            domTile.style.position = 'absolute';
            domTile.style.top = '50%';
            
            // Width of horizontal tile is 100, vertical is 50.
            const w = isDouble ? 50 : 100;
            
            if (index === 0) {
                // First tile at center
                domTile.style.left = `calc(50% - ${w/2}px)`;
                domTile.style.transform = `translateY(-50%)`;
                currentX += (w/2);
            } else {
                // We append to the right side sequentially just to show them.
                // A full 2D snake algorithm is complex. Let's make it a single line with scrolling.
                // Wait, our game logic prepends (left) and appends (right).
                // It's easier if we use Flexbox for the board for a simple line.
            }
        });

        // ACTUALLY, Flexbox is infinitely easier for a straight line!
        // Let's redo board rendering using flex layout on #board.
        gameUI.board.style.position = 'relative';
        gameUI.board.style.display = 'flex';
        gameUI.board.style.alignItems = 'center';
        gameUI.board.style.justifyContent = 'center';
        gameUI.board.style.gap = '2px';
        gameUI.board.style.width = 'max-content';
        gameUI.board.style.margin = 'auto';
        gameUI.board.style.transition = 'transform 0.3s ease';

        boardTiles.forEach(bTile => {
            const isDouble = bTile.tile[0] === bTile.tile[1];
            const domTile = createDominoElement(bTile.tile, false, !isDouble, true);
            
            // If it's a normal horizontal tile, we might need to swap the visual dots if it's rotated
            if (!isDouble && bTile.rotated) {
                domTile.style.flexDirection = 'row-reverse';
            }
            
            gameUI.board.appendChild(domTile);
        });

        // Add dragging to board container for scrolling if it gets long
        const container = document.querySelector('.board-container');
        if (gameUI.board.clientWidth > container.clientWidth) {
            container.style.overflowX = 'auto';
            // Scroll to center initially
            container.scrollLeft = (gameUI.board.clientWidth - container.clientWidth) / 2;
        } else {
            container.style.overflowX = 'hidden';
        }
    }

    // --- Helper logic (client side validation) ---
    function getLocalValidMoves(hand, leftEnd, rightEnd, boardLength) {
        if (boardLength === 0) {
            const has66 = hand.find(t => t[0] === 6 && t[1] === 6);
            if (has66) return [{ tile: has66, side: 'first' }];
            return hand.map(t => ({ tile: t, side: 'first' }));
        }

        let valid = [];
        hand.forEach(tile => {
            if (tile[0] === leftEnd || tile[1] === leftEnd) valid.push({ tile, side: 'left' });
            if (tile[0] === rightEnd || tile[1] === rightEnd) valid.push({ tile, side: 'right' });
        });
        return valid;
    }

    function handleTileClick(tile, validOptions, state) {
        // If only one valid option, play it immediately
        if (validOptions.length === 1) {
            network.sendAction({ type: 'PLAY', tile: tile, side: validOptions[0].side });
            return;
        }

        // If multiple (can go left or right), prompt user
        // Quick & dirty UI: standard js confirm/prompt or just custom UI
        const side = window.confirm(`Play on LEFT end? (Cancel to play on RIGHT)`) ? 'left' : 'right';
        
        // Ensure choice is valid
        const chosenOption = validOptions.find(o => o.side === side);
        if (chosenOption) {
            network.sendAction({ type: 'PLAY', tile: tile, side: side });
        } else {
            showToast("Invalid choice!");
        }
    }

    function showGameOverModal(state) {
        const r = state.roundResult;
        gameUI.gameOverModal.classList.remove('hidden');
        
        if (state.gameState === 'GAME_OVER') {
            gameUI.gameOverTitle.innerText = "Game Over!";
            buttons.nextRound.classList.add('hidden');
        } else {
            gameUI.gameOverTitle.innerText = r.isBlocked ? "Game Blocked!" : "Round Over!";
            if (network.isHost) {
                buttons.nextRound.classList.remove('hidden');
            }
        }

        gameUI.gameOverMessage.innerText = `${r.winnerName} won the round and gained ${r.pointsGained} points!`;
        
        gameUI.scoreBoard.innerHTML = '';
        state.players.forEach(p => {
            const div = document.createElement('div');
            div.innerText = `${p.name} ${p.isTeam2 ? '(Team 2)' : ''}: ${p.score} pts`;
            gameUI.scoreBoard.appendChild(div);
        });
    }

});
