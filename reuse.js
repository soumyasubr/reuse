var fs = require('fs'),
	config = JSON.parse(fs.readFileSync('config.json','utf-8')),
	io, 			 // socketIO instance
	socket, 		 // socket
	games = {}, 	 // game state and player information, indexed by roomId
	roomLookup = {}, // lookup room by client socket ID
	wordList = [], 	 // list of words to validate against
	rejectList = []; // list of words to avoid


//Load dictionary if not already loaded
if (wordList.length === 0 || rejectList.length === 0) {
	loadWordLists();
}


/** 
 * Load word lists for valid words and offensive words.
 * 	'2of12inf' file from http://wordlist.aspell.net/12dicts/ is used to identify valid words. 
 * 	Word list from bannedwordlist.com is used to identify blacklisted words.
 */
function loadWordLists() {
	try {
		// Load valid words
		var validWords = fs.readFileSync(config.VALID_WORDS, 'utf-8');
		wordList = validWords.toString().split('\n').map(function(str) { //create array
			return str.replace('%','').trim(); // remove %, space and newline from each word
		});
		
		// Load rejected words
		var rejectedWords = fs.readFileSync(config.REJECTED_WORDS, 'utf-8');
		rejectList = rejectedWords.toString().split('\n').map(function(str) { //create array
			return str.trim(); // remove space and newline from each word
		});
		console.log('Dictionary successfully loaded');
	}
	catch (err) {
		io.sockets.emit('error', {
				processStep: 'init',
				message: 'Error loading dictionary. '
		});
        console.log('Error loading dictionary. ' + err);
	}
}


/** 
 * Creates a new room ID and places client in room
 * @param {Object} input
 * @param {String} input.playerName
 * @param {Number} input.numPlayers
 */
function createNewGame(input) {
	var roomId,
	 	room,
	 	id = this.id;
	
	// Create a unique room ID
	do {
		roomId = parseInt(Math.random() * 10); // Generate random roomId
		room = socket.adapter.rooms[roomId]; // Array of clients in room. Should return nothing if room doesn't exist.
	}
	while (	room !== undefined || // Check if room already exists
			roomId === 0); // Room Id should be non-zero
		
	this.join(roomId.toString()); // Place client in room

	// Store room and client data as in-memory objects
	games[roomId] = {};
	games[roomId].state = 'waiting';
	games[roomId].numPlayers = input.numPlayers;
	games[roomId].players = {};
	games[roomId].players[id] = {
				name: input.playerName,
				turn: 0,
				totalScore: 0,
				pinBanUsed: 0,
				isCurrPlayer: false
	};
	roomLookup[id] = roomId;
	
    // Notify client that they have joined a room
    io.sockets.to(id).emit('playerJoinedRoom', {
				roomId: roomId,
				playersArray: [{
					id: id,
					name: input.playerName
				}]
    });  
    console.log(input.playerName, 'created Game', roomId);
}


/** 
 * Joins the specified room, if available
 * @param {Object} data
 * @param {String} data.playerName
 * @param {Number} data.roomId
 */
function joinExistingGame(data) {
	var room = socket.adapter.rooms[data.roomId]; // Get array of clients in room
	
	if (room == undefined) { //If room does not exist
		// Notify client that room does not exist
		io.sockets.to(this.id).emit('error', {
				processStep: 'join',
				message: 'Game ' + data.roomId + ' does not exist. '
		} );
		return;
	}
    	
	if (games[data.roomId].state !== 'waiting') { // If game is not accepting players
		// Notify client that game has started
		io.sockets.to(this.id).emit('error', {
				processStep: 'join',
				message: " Game "+ data.roomId + 
					' has already started. Create new game or join a different game. '
		});  
		return;
	}
	
//	if (Object.keys(room).length >= config.MAX_PLAYERS) { //If # clients in room > max permitted
	if (Object.keys(room).length >= games[data.roomId].numPlayers) { //If # clients in room > max permitted
		// Notify requesting client that room is full
		io.sockets.to(this.id).emit('error', {
				processStep: 'join',
				message: 'Game ' + data.roomId + 
					' is full. Create new game or join a different game. '
		});  
		return;
	}
    	
    this.join(data.roomId.toString()); // Place client in room
    data.id = this.id;
            
	// Store client data as in-memory objects       
	games[data.roomId].players[data.id] = {
			name: data.playerName,
			turn: 0,
			totalScore: 0,
			pinBanUsed: 0,
			isCurrPlayer: false
	};
	roomLookup[data.id] = data.roomId;
	
	data.playersArray = [];
	for (var id in games[data.roomId].players) { //players info
			data.playersArray.push({ //Create array with player ids and names
				id: id,
				name: games[data.roomId].players[id].name
			});
	}
	
    // Notify all clients in this room that a player has joined
    io.sockets.to(data.roomId).emit('playerJoinedRoom', data);  
    console.log(data.playerName, 'joined Game', data.roomId);
}


/**
 * Prepares for the first round: Identifies first player; generates initial random word; 
 * sends word to all players in room. 
 * @param {Number} roomId
 */
function firstTurn(roomId) {
	var keys,
		firstPlayerId;
	
	if (games[roomId] == undefined) {
		io.sockets.to(this.id).emit('error', {message: 'Unable to communicate with room. '});
		return;
	}
	
	if (games[roomId].state !== 'waiting') { // Allow to start game only if game has not started yet
		io.sockets.to(this.id).emit('error', {message: 'Cannot start game. Game is already in progress. '});
		return;
	}
	
    keys = Object.keys(games[roomId].players); // Get list of socket IDs in the room
    firstPlayerId = keys[0];
    
    // update information on the server
	games[roomId].players[firstPlayerId].turn++; //increment turn # for first player
	games[roomId].players[firstPlayerId].isCurrPlayer = true; // update current player flag
	games[roomId].state = 'started'; // update game state
	
	// send new word to all clients in the room
    io.sockets.to(roomId).emit('newWord', { 
			nextPlayerId: keys[0], // first player to join the room gets the first turn
			nextPlayerName: games[roomId].players[keys[0]].name, // name of first player
			currWord: randomWord(3,7).toUpperCase(), //random word between 3 and 7 characters
			currPinBanLeft: config.MAX_PIN_BAN, // number of pins/ bans available to first player
			pinOrBan: '', // no pin or ban for first turn
    });
}


/** 
 * If player response is valid, calculate reused fragment and score;
 * Send word, score and other related data to all players for next turn;
 * If game is over - send winner information and end game on client.
 * @param {Object} data
 * @param {String} data.id
 * @param {String} data.currWord
 * @param {String} data.prevWord
 * @param {String} data.pinOrBan
 * @param {String} data.letter
 * @param {String} data.nextPinOrBan
 * @param {String} data.nextLetter
 * @param {Number} data.currScore
 * @param {Number} data.totalScore
 * @param {String} data.playerName
 * @param {String} data.reusedFragment
 * @param {Number} data.currPinBanLeft
 * @param {Number} data.nextPinBanLeft
 * @param {Number} data.nextPlayerId
 */
function nextTurn(data) {
	data.id = this.id;
	var roomId = roomLookup[data.id];
	var valid;
	
	if (roomId == undefined) { // If no room found for client
		io.sockets.to(data.id).emit('error', {message: 'Unable to communicate with room. '});
		return;
	}
	
	if (!games[roomId].players[data.id].isCurrPlayer) {
		io.sockets.to(data.id).emit('error', {message: 'Not your turn. '});
		return;
	}
	
	valid = isValidWord(data); // Check if word is valid
	if (valid.value) { 
		io.sockets.to(roomId).emit('responseAccepted'); // Notify all players that word is valid
	}
	else {
		io.sockets.to(data.id).emit('error', { // Notify current player that word is invalid
			processStep: 'active game',
			message: valid.message
		});
		return;
	} // If word is invalid, don't process further
	
	data.playerName = games[roomId].players[data.id].name; // Name of current player
	
	// Identify reused fragment and score
	if (data.currWord === '-') { // If turn was passed
		data.currScore = 0; // no points for this turn
		data.currWord = data.prevWord;
	}
	else { // if a valid word was received
		data.reusedFragment = reusedFragment(data.currWord, data.prevWord); // Identify reused fragment
	    data.currScore = 10 * data.reusedFragment.length; // calculate score for current turn
	}
    games[roomId].players[data.id].totalScore += data.currScore; //update total score
    data.totalScore = games[roomId].players[data.id].totalScore; 
	
	
	//**** If player who left had the active turn *****//
	var nextPlayerId = identifyNextPlayer(games[roomId]);
	if (!isGameOver(roomId) && nextPlayerId) { // If game is NOT over
        // Assign pin/ ban for next turn
        data.pinOrBan = data.nextPinOrBan; 
        data.letter = data.nextLetter;
        if (data.nextPinOrBan === 'pin' || data.nextPinOrBan === 'ban') { 
        	games[roomId].players[data.id].pinBanUsed++; //Update # of pins/ bans used for current player
        }
        data.currPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.id].pinBanUsed; // Number of pins/ bans left for current player
        
    	// Get next player info
        data.nextPlayerId = nextPlayerId;
		data.nextPlayerName = games[roomId].players[data.nextPlayerId].name; // Name of next player
	    data.nextPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.nextPlayerId].pinBanUsed; // Number of pins/ bans left for next player
    	    
	    // Update player information on server
	    games[roomId].players[data.nextPlayerId].turn++; // Update turn number for next player
    	games[roomId].players[data.id].isCurrPlayer = false;
    	games[roomId].players[data.nextPlayerId].isCurrPlayer = true;
    	
    	// Remove unnecessary properties
        delete data.prevWord; 
        delete data.nextPinOrBan;
        delete data.nextLetter;
        
        io.sockets.to(roomId).emit('newWord', data); // Notify clients to prepare for next player's turn
    }
    else { // If game is over
    	handleGameOver(roomId, data);
    }
}


/** 
 * Handles player disconnect event received from client;
 * Removes disconnected player and passes turn/ ends game as needed.
 */
function disconnect() {
	var _this = this,
		id = _this.id, // ID of disconnected player  
		roomId = roomLookup[id], // Room ID of disconnected player
		data = {},
		currPlayerId;
		
	console.log(id, 'disconnected');
	
	// If player didn't belong to a room, do no more
	if (roomId == undefined) {
		return;
	}
	
	if (games[roomId] == undefined) { // game has ended, and the object no longer exists
		removePlayer(); // delete player info
		return; // Do nothing more
	}
	
	var players = {};
	players = games[roomId].players; // Get list of players in room
	
	// Notify other players in the room that somebody left
	io.sockets.to(roomId).emit('playerLeftRoom', 
								{id: id, 
								name: players[id].name, 
	});
	console.log(players[id].name, 'left room', roomId);

	// if game is in waiting state..
	if (games[roomId].state !== 'started') {
		removePlayer(); // delete player info
		return; // Do nothing more
	}
	
	// Identify who has the current turn
	for (var key in players) {
		if (players[key].isCurrPlayer) {
			currPlayerId = key;
		}
	}

	removePlayer(); // delete player info
	
	// If the player that left did not have the active turn..
	if (currPlayerId !== id) {
		console.log('not disconnected player\'s turn. ',currPlayerId);
		var nextPlayerId = identifyNextPlayer(games[roomId]);
		if (!nextPlayerId) { // handle game over only if there are no more players left!
			handleGameOver(roomId, data);
		}
		return; 
	}
	
	//**** If player who left had the active turn *****//
	var nextPlayerId = identifyNextPlayer(games[roomId]);

	if (!isGameOver(roomId) && nextPlayerId) { // If game is NOT over
    	// Get next player info
		data.nextPlayerId = nextPlayerId;
		data.nextPlayerName = games[roomId].players[data.nextPlayerId].name; // Name of next player
	    data.nextPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.nextPlayerId].pinBanUsed; // number of pins/ bans left for next player
    
	    //Update player data on server
	    games[roomId].players[data.nextPlayerId].turn++; // Update turn number for next player
    	games[roomId].players[data.nextPlayerId].isCurrPlayer = true;
    	   
    	io.sockets.to(roomId).emit('activateNextPlayer', data); // Notify clients to skip to next player
    }
    else { 
    	handleGameOver(roomId, data);
    }
			
			/**
			 * Removes player from room and deletes player info from server.
			 * (within scope of disconnect)
			 */
			function removePlayer() {
				try {
					_this.leave(roomId); // leave room
					delete games[roomId].players[id];
					delete roomLookup[id];
				}
				catch (err) {
			        console.log('Could not delete from array: ' + err);
				}
			}
}


/**
 * Handle game over state; Compute winner if needed and notify clients to end game.
 * @param {Number} roomId
 * @param {Object} data
 */
function handleGameOver(roomId, data) {
	if (data.nextPlayerId == undefined) {
		io.sockets.to(roomId).emit('error', {
			message : 'Ending game as all other players left :('
		});
		data.skipTurnProcessing = true; // Set flag to skip word processing on client
	} 
	else { // If game is over
		data.winner = computeWinner(roomId); // get winner info
	}
//	games[roomId].state = 'ended';
	delete games[roomId]; // remove data for this room

	console.log('Data @ gameOver', data);
	// Notify clients that game is over
	io.sockets.to(roomId).emit('gameOver', data);
}


/**
 * Generate a random word between 3 and 7 letters.
 * 5th grade word list from http://www.ideal-group.org/dictionary/  is used. (p-5_ok.txt)
 * @param {Number} minLetters
 * @param {Number} maxLetters
 * @return {String} word
 */
function randomWord(minLetters, maxLetters){
	var simpleWordList;
	var word;
	
	try {
		// Load simple words
		var simpleWords = fs.readFileSync(config.SIMPLE_WORDS, 'utf-8');
		simpleWordList = simpleWords.toString().split('\n').map(function(str) { //create array
			return str.trim(); // remove space and newline from each word
		});
		console.log('Simple word list successfully loaded');
	}
	catch (err) {
		io.sockets.emit('error', {
				processStep: 'start game',
				message: 'Error generating initial word. '
		});
        console.log('Error loading simple word list. ' + err);
        return;
	}
	
	// Generate a random word that matches the criteria
	do {
		word = simpleWordList[parseInt(Math.random() * simpleWordList.length)];
	}
	while (	word === undefined || 
			!/^[a-z]+$/.test(word) || 		// contains only lower case characters (filter out hyphenated words, abbreviations etc.)
			word.length < minLetters || 	// word length between minLetters..
			word.length > maxLetters); 		// .. and maxLetters
	return word;
}


/** 
 * Checks if at least one letter is reused between the 2 strings
 * @param {String} string1
 * @param {String} string2
 */
function isFragmentReused(string1, string2) {
	var shortWord,
	 	longWord,
	 	isReused = false,
	 	i = 0;
	
	// Optimize algorithm by searching for shorter string in the longer one
	if (string1.length <= string2.length) {
		shortWord = string1;
		longWord = string2;
	}
	else {
		shortWord = string2;
		longWord = string1;
	}

	do {
		isReused = (longWord.indexOf(shortWord.substr(i,1)) > -1);
		i++;
	}
	while (!isReused && i<shortWord.length);
	return isReused;
}


/** 
 * Checks if the player's response is valid.
 * Most of this is already handled on the client; Re-checking on server to disallow cheating.
 * @param {Object} data
 * @param {String} data.currWord
 * @param {String} data.prevWord
 * @param {String} data.pinOrBan
 * @param {String data.letter
 * @returns {message, value}
 */
function isValidWord(data) {
	var ret = {
			message: '',
			value: true
	};
	
	// Check for special case first. If player passed turn, then word is '-'
	if (data.currWord === '-') {
		return {
			value: true
		};
	}
	
	// Check if at least one letter is reused
	if (!isFragmentReused(data.currWord, data.prevWord)) {
		ret.message = 'Must reuse at least one letter from the previous word. ';
		ret.value = false;
	}
	
	// Check if word is subset of previous word
	if (data.prevWord.indexOf(data.currWord) > -1) { // if currWord is contained in prevWord
		ret.message += 'Word cannot be a subset of the previous word. ';
		ret.value = false;
	} 
	
	// Check if word contains the pinned letter
	if (data.pinOrBan === 'pin') {
		if (data.currWord.indexOf(data.letter) === -1) { // if pinned letter is NOT contained in currWord
			ret.message += 'Word should contain the pinned letter: ' + data.letter + '. ';
			ret.value = false;
		} 
	}
	
	// Check if word contains the banned letter
	else if (data.pinOrBan === 'ban') {
		if (data.currWord.indexOf(data.letter) > -1) { // if banned letter is contained in currWord
			ret.message += 'Word should not contain the banned letter: ' + data.letter + '. ';
			ret.value = false;
		} 
	}
	
	// Only if word is valid so far, check if word is an acceptable English word 
	if (ret.value) {
		if (wordList.indexOf(data.currWord.toLowerCase()) === -1) { // not in word list
			ret.message = "Can't find " + data.currWord + ' in our dictionary. ';
			ret.value = false;
		}
		// if word is in word list, check if it is a rejected word
		if (ret.value) {
			if (rejectList.indexOf(data.currWord.toLowerCase()) > -1) { // found in rejected list
				ret.message = 'This word is not allowed. ';
				ret.value = false;
			}
		}
	}
	return ret;
}


/**
 * Returns the longest reused portion between the two words.
 * @param {String} currWord
 * @param {String} prevWord
 * @returns {String} - reused portion
 */
function reusedFragment(currWord, prevWord) {
	var isReused = false,
		ret = '',
		len = currWord.length,
		i = 0,
		j = len;
	
	// Try to find the longest possible fragment
	do {
		do {
			isReused = (prevWord.indexOf(currWord.substr(i,j)) > -1);
			if (isReused) {
				ret = currWord.substr(i,j);
			}
			i++;
		}
		while(!isReused && (i+j<=len));
		i = 0;
		j--; //reduce the length of the fragment to be tested until a match is found
	}
	while(!isReused);
	return ret;
}


/**
 * Returns the winner(s) for the specified game
 * @param {Number} roomId
 * @returns [{id, name, totalScore}]
 */
function computeWinner(roomId){
	var players = games[roomId].players; //players in room
	var score = [];
	var winner = [];
	var id;
	for (id in players) {
		if (players.hasOwnProperty(id)) {
			score.push(players[id].totalScore); // Create an array that only contains the score
		}
	}
	var maxScore = Math.max.apply(Math, score); // Calculate highest score

	// Identify player(s) with highest score
	for (id in players) {
		if (players.hasOwnProperty(id)) {
			if (players[id].totalScore === maxScore){
				winner.push({
					id: id, 
					name: players[id].name, 
					totalScore: players[id].totalScore
				}); 
			}
		}
	}
	return winner;
}


/** 
 * Returns socket ID of next player for the specified game.
 * @param {Object} roomObj
 * @returns {String}
 */
function identifyNextPlayer(roomObj) {
		var keys = Object.keys(roomObj.players); // Get list of socket IDs in the room
		if (keys.length === 1) { // If this is the only player in the room
			return;
		}
		var turns = [];
		var j;
		for (var key in roomObj.players) {
			turns.push({id: key,
						turn: roomObj.players[key].turn
			});
		}
		console.log('turns',turns);
		
		var nextPlayerId = turns[0].id; // initialize nextPlayerId
		for (var i=0; i < turns.length; i++) {
			j = (i + 1) % turns.length;
			if (turns[i].turn > turns[j].turn) {
				nextPlayerId = turns[j].id;
				break;
			}
		}
		return nextPlayerId;
}


/**
 * Checks if all turns have been played for the specified game.
 * @param {Number} roomId
 * @returns {Boolean}
 */
function isGameOver(roomId) {
	var players = games[roomId].players; // Get list of players in room
	var turnsPlayed;
	for (var key in players) {
			turnsPlayed = players[key].turn; // last player's turn
	}
	
	if (turnsPlayed === config.MAX_TURNS) { // If each player has played specified # of turns
		return true; //game over
	}
	else {
		return false; // if game is not over
	}
}


// Using 'exports' makes this function available to other files once imported
exports.initGame = function(_io, _socket) {
	io = _io;
	socket = _socket;
	socket.on('createNewGame', createNewGame);
	socket.on('joinExistingGame', joinExistingGame);
	socket.on('startGame', firstTurn);
	socket.on('nextTurn', nextTurn);
	socket.on('disconnect', disconnect);
	socket.on('leaveGame', disconnect);
    socket.on('error', function (err) { console.error(err.stack);});
};