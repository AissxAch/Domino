class PeerNetwork {
    constructor(onStateUpdate, onPlayerJoin, onPlayerLeave, onGameStart) {
        this.peer = null;
        this.connections = []; // Connections to other peers
        this.isHost = false;
        this.roomId = null;
        this.playerId = null; // My peer ID
        this.players = []; // Array of { id, name, isHost }
        
        // ICE servers config: STUN + free TURN relays for mobile data NAT traversal
        this.iceConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                {
                    urls: 'turn:openrelay.metered.ca:80',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                },
                {
                    urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                    username: 'openrelayproject',
                    credential: 'openrelayproject'
                }
            ]
        };
        
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
            
            const fullPeerId = 'alg-domino-' + this.roomId;
            
            this.peer = new Peer(fullPeerId, {
                debug: 1,
                config: this.iceConfig
            });
            
            this.peer.on('open', (id) => {
                console.log('[Host] PeerJS connected with id:', id);
                this.isHost = true;
                this.playerId = id;
                this.players = [{ id: this.playerId, name: playerName, isHost: true }];
                
                this.setupHostListeners();
                resolve(this.roomId);
            });

            this.peer.on('error', (err) => {
                console.error("PeerJS Host Error:", err);
                if (err.type === 'unavailable-id') {
                    // Room code collision, try again with new code
                    this.roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
                    reject(new Error('Room code taken, please try again.'));
                } else {
                    reject(err);
                }
            });

            this.peer.on('disconnected', () => {
                console.log('[Host] Disconnected from signaling server, attempting reconnect...');
                if (this.peer && !this.peer.destroyed) {
                    this.peer.reconnect();
                }
            });
        });
    }

    // Join an existing room
    joinRoom(roomId, playerName) {
        return new Promise((resolve, reject) => {
            this.roomId = roomId.toUpperCase();
            const hostPeerId = 'alg-domino-' + this.roomId;
            
            let settled = false;
            
            this.peer = new Peer(undefined, {
                debug: 1,
                config: this.iceConfig
            });
            
            this.peer.on('open', (id) => {
                console.log('[Client] PeerJS connected with id:', id);
                this.isHost = false;
                this.playerId = id;
                
                // Connect to host
                const conn = this.peer.connect(hostPeerId, {
                    metadata: { name: playerName },
                    reliable: true
                });

                // Timeout: if connection doesn't open in 10 seconds, fail
                const timeout = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        console.error('[Client] Connection to host timed out');
                        conn.close();
                        reject(new Error('Connection timed out. Check the room code and try again.'));
                    }
                }, 10000);
                
                conn.on('open', () => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    console.log('[Client] Connected to host!');
                    this.connections = [conn];
                    this.setupClientListeners(conn);
                    resolve(this.roomId);
                });

                conn.on('error', (err) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    console.error('[Client] Connection error:', err);
                    reject(err);
                });
            });
            
            this.peer.on('error', (err) => {
                console.error("PeerJS Client Error:", err);
                if (!settled) {
                    settled = true;
                    if (err.type === 'peer-unavailable') {
                        reject(new Error('Room not found. Check the code and try again.'));
                    } else {
                        reject(err);
                    }
                }
            });
        });
    }

    // --- Host Specific Logic ---
    setupHostListeners() {
        this.peer.on('connection', (conn) => {
            console.log('[Host] Incoming connection from:', conn.peer);
            
            if (this.players.length >= 4) {
                conn.on('open', () => {
                    conn.send({ type: 'ERROR', message: 'Room is full' });
                    setTimeout(() => conn.close(), 1000);
                });
                return;
            }

            conn.on('open', () => {
                console.log('[Host] Connection opened with:', conn.peer, 'metadata:', conn.metadata);
                const playerName = (conn.metadata && conn.metadata.name) || 'Player';
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
                    console.log('[Host] Connection closed with:', conn.peer);
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
            console.log("[Client] Connection to host lost.");
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
            this.onStateUpdate({ action: action, playerId: this.playerId });
        } else {
            if (this.connections[0] && this.connections[0].open) {
                this.connections[0].send({ type: 'PLAYER_ACTION', action: action });
            }
        }
    }

    disconnect() {
        if (this.peer) {
            this.peer.destroy();
        }
        this.peer = null;
        this.connections = [];
        this.players = [];
        this.roomId = null;
        this.isHost = false;
    }
}
