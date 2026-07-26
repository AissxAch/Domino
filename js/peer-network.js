class PeerNetwork {
    constructor(onStateUpdate, onPlayerJoin, onPlayerLeave, onGameStart) {
        this.peer = null;
        this.connections = []; // Connections to other peers
        this.isHost = false;
        this.roomId = null;
        this.playerId = null; // My peer ID
        this.players = []; // Array of { id, name, isHost }
        
        // Callbacks
        this.onStateUpdate = onStateUpdate;
        this.onPlayerJoin = onPlayerJoin;
        this.onPlayerLeave = onPlayerLeave;
        this.onGameStart = onGameStart;
    }

    // Host a new game room
    hostRoom(playerName) {
        return new Promise((resolve, reject) => {
            // Generate a simple 5-character room code
            this.roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
            
            // In PeerJS, the ID we pass is the room code. 
            // To ensure uniqueness globally, we might prefix it.
            const fullPeerId = 'alg-domino-' + this.roomId;
            
            this.peer = new Peer(fullPeerId);
            
            this.peer.on('open', (id) => {
                this.isHost = true;
                this.playerId = id;
                this.players = [{ id: this.playerId, name: playerName, isHost: true }];
                
                this.setupHostListeners();
                resolve(this.roomId);
            });

            this.peer.on('error', (err) => {
                console.error("PeerJS Error:", err);
                reject(err);
            });
        });
    }

    // Join an existing room
    joinRoom(roomId, playerName) {
        return new Promise((resolve, reject) => {
            this.roomId = roomId.toUpperCase();
            const hostPeerId = 'alg-domino-' + this.roomId;
            
            this.peer = new Peer(); // Let PeerJS assign a random ID for client
            
            this.peer.on('open', (id) => {
                this.isHost = false;
                this.playerId = id;
                
                // Connect to host
                const conn = this.peer.connect(hostPeerId, {
                    metadata: { name: playerName }
                });
                
                conn.on('open', () => {
                    this.connections = [conn];
                    this.setupClientListeners(conn);
                    resolve(this.roomId);
                });

                conn.on('error', (err) => {
                    reject(err);
                });
            });
            
            this.peer.on('error', (err) => {
                console.error("PeerJS Error:", err);
                reject(err);
            });
        });
    }

    // --- Host Specific Logic ---
    setupHostListeners() {
        this.peer.on('connection', (conn) => {
            if (this.players.length >= 4) {
                conn.on('open', () => {
                    conn.send({ type: 'ERROR', message: 'Room is full' });
                    setTimeout(() => conn.close(), 1000);
                });
                return;
            }

            conn.on('open', () => {
                const playerName = conn.metadata.name;
                this.connections.push(conn);
                
                const newPlayer = { id: conn.peer, name: playerName, isHost: false };
                this.players.push(newPlayer);
                
                this.onPlayerJoin(this.players);
                
                // Broadcast updated player list to everyone
                this.broadcast({ type: 'PLAYER_LIST', players: this.players });

                conn.on('data', (data) => {
                    this.handleData(data, conn.peer);
                });

                conn.on('close', () => {
                    this.connections = this.connections.filter(c => c.peer !== conn.peer);
                    this.players = this.players.filter(p => p.id !== conn.peer);
                    this.onPlayerLeave(this.players);
                    this.broadcast({ type: 'PLAYER_LIST', players: this.players });
                });
            });
        });
    }

    // --- Client Specific Logic ---
    setupClientListeners(conn) {
        conn.on('data', (data) => {
            this.handleData(data, conn.peer);
        });

        conn.on('close', () => {
            console.log("Connection to host lost.");
            // Handle disconnect UI
        });
    }

    // --- Shared Logic ---
    handleData(data, senderId) {
        switch (data.type) {
            case 'PLAYER_LIST':
                this.players = data.players;
                this.onPlayerJoin(this.players);
                break;
            case 'GAME_START':
                this.onGameStart(data.state);
                break;
            case 'STATE_UPDATE':
                this.onStateUpdate(data.state);
                break;
            case 'PLAYER_ACTION':
                // Only Host receives PLAYER_ACTION, updates game state, and broadcasts STATE_UPDATE
                if (this.isHost) {
                    this.onStateUpdate({ action: data.action, playerId: senderId });
                }
                break;
            case 'ERROR':
                alert(data.message);
                break;
        }
    }

    // Host sends complete state to all clients
    broadcastState(state) {
        if (!this.isHost) return;
        this.broadcast({ type: 'STATE_UPDATE', state: state });
    }
    
    // Host starts game
    broadcastStart(state) {
        if (!this.isHost) return;
        this.broadcast({ type: 'GAME_START', state: state });
    }

    broadcast(data) {
        this.connections.forEach(conn => {
            if (conn.open) {
                conn.send(data);
            }
        });
    }

    // Client sends action to Host
    sendAction(action) {
        if (this.isHost) {
            // Host applies action directly
            this.onStateUpdate({ action: action, playerId: this.playerId });
        } else {
            // Client sends to host (connections[0] is host)
            if (this.connections[0] && this.connections[0].open) {
                this.connections[0].send({ type: 'PLAYER_ACTION', action: action });
            }
        }
    }

    disconnect() {
        if (this.peer) {
            this.peer.destroy();
        }
        this.connections = [];
        this.players = [];
        this.roomId = null;
        this.isHost = false;
    }
}
