// Import the necessary libraries and files
var express = require('express');
var path = require('path');

// The keyword require returns an object module.exports for a given file.
// The following line makes the initGame function (exported in reuse.js) available here.
var reuse = require('./reuse'); 

var app = express();

//Serve landing page
app.use(express.static(path.join(__dirname, 'public')));

var http = require('http');
var server = http.createServer(app);
server.listen(8080);
var io = require('socket.io').listen(server);

//Listen for Socket.IO Connections. Once connected, start the game logic.
io.on('connection', function (socket) {
	//establish web socket connection between client and server. uniquely identify client.
    console.log('Socket connection established. Socket ID =',socket.id);
	reuse.initGame(io, socket);
});



