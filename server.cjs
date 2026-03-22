const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Store active rooms and the auto-match queue
const activeRooms = {};
let autoMatchQueue = null;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Broadcast total online users to everyone
    io.emit('onlineCount', io.engine.clientsCount);

    // --- AUTO MATCHMAKING ---
    socket.on('findRandomMatch', (data) => {
        const { player, boardSize } = data;
        
        if (autoMatchQueue && autoMatchQueue.socket.id !== socket.id) {
            // We found a waiting player! Match them up.
            const hostData = autoMatchQueue;
            const guestData = { socket, player };
            
            // Generate a random room code for them
            const roomCode = 'AUTO_' + Math.random().toString(36).substr(2,4).toUpperCase();
            
            hostData.socket.join(roomCode);
            guestData.socket.join(roomCode);
            
            activeRooms[roomCode] = { host: hostData.player, guest: guestData.player, boardSize: hostData.boardSize };
            
            // Notify both players that a match was found
            hostData.socket.emit('autoMatchFound', { role: 'host', roomCode, opponent: guestData.player, boardSize: hostData.boardSize });
            guestData.socket.emit('autoMatchFound', { role: 'guest', roomCode, opponent: hostData.player, boardSize: hostData.boardSize });
            
            console.log(`Auto Match created: ${roomCode}`);
            autoMatchQueue = null; // Clear the queue for the next people
        } else {
            // Nobody is waiting, put this player in the queue
            autoMatchQueue = { socket, player, boardSize };
        }
    });

    socket.on('cancelAutoMatch', () => {
        if (autoMatchQueue && autoMatchQueue.socket.id === socket.id) {
            autoMatchQueue = null;
        }
    });

    // --- PRIVATE ROOMS ---
    socket.on('createRoom', (data) => {
        const { roomCode, player, boardSize } = data;
        socket.join(roomCode);
        activeRooms[roomCode] = { host: player, guest: null, boardSize: boardSize };
        console.log(`Room created: ${roomCode}`);
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, player } = data;
        const room = activeRooms[roomCode];

        if (room && !room.guest) {
            socket.join(roomCode);
            room.guest = player;
            socket.emit('joinSuccess', { host: room.host, boardSize: room.boardSize });
            socket.to(roomCode).emit('guestJoined', { guest: player });
            console.log(`${player.name} joined room: ${roomCode}`);
        } else {
            socket.emit('joinError', 'Room not found or already full!');
        }
    });

    // Relay Game Actions
    socket.on('makeMove', (data) => socket.to(data.roomCode).emit('makeMove', data.payload));
    socket.on('sendChat', (data) => socket.to(data.roomCode).emit('sendChat', data.payload));
    socket.on('sendEmoji', (data) => socket.to(data.roomCode).emit('sendEmoji', data.payload));
    socket.on('requestRematch', (data) => socket.to(data.roomCode).emit('requestRematch'));
    socket.on('acceptRematch', (data) => socket.to(data.roomCode).emit('acceptRematch'));
    socket.on('leaveRoom', (data) => {
        socket.to(data.roomCode).emit('opponentLeft');
        delete activeRooms[data.roomCode];
    });

    // Handle sudden disconnects
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        io.emit('onlineCount', io.engine.clientsCount);

        // Remove from auto queue if they close the app while waiting
        if (autoMatchQueue && autoMatchQueue.socket.id === socket.id) {
            autoMatchQueue = null;
        }

        // Find if they were in a room and alert the other player
        for (const code in activeRooms) {
            const room = activeRooms[code];
            if ((room.host && room.host.id === socket.id) || (room.guest && room.guest.id === socket.id)) {
                socket.to(code).emit('opponentLeft');
                delete activeRooms[code];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
