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

// Store active rooms
const activeRooms = {};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Broadcast total online users to everyone
    io.emit('onlineCount', io.engine.clientsCount);

    // Host creates a room
    socket.on('createRoom', (data) => {
        const { roomCode, player, boardSize } = data;
        socket.join(roomCode);
        activeRooms[roomCode] = { host: player, guest: null, boardSize: boardSize };
        console.log(`Room created: ${roomCode}`);
    });

    // Guest joins a room
    socket.on('joinRoom', (data) => {
        const { roomCode, player } = data;
        const room = activeRooms[roomCode];

        if (room && !room.guest) {
            socket.join(roomCode);
            room.guest = player;
            
            // Tell the guest the join was successful and give them host data
            socket.emit('joinSuccess', { host: room.host, boardSize: room.boardSize });
            
            // Tell the host that the guest has arrived
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

    // Handle sudden disconnects (closing the tab)
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        io.emit('onlineCount', io.engine.clientsCount);

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
