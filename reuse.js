// Global variables
var io,
	gameSocket,
	games = {}, // game state and player information, indexed by roomId
	roomLookup = {}, // lookup room by client socket ID
	wordList = [], // list of words to validate against
	rejectList = []; // list of words to avoid

//TODO: Move config variables to JSON or elsewhere
var MAX_TURNS = 4,
	MAX_PLAYERS = 4,
	MAX_PIN_BAN = 2;


/* Load word lists for valid words and offensive words 
 * '2of12inf' file from http://wordlist.aspell.net/12dicts/ is used to identify valid words.
 */
function loadWordLists() {
	var fs = require('fs');
	try {
		var validWords = fs.readFileSync('2of12inf.txt', 'utf-8');
		wordList = validWords.toString().split('\n').map(function(str) { //create array and trim each element
			return str.replace('%','').trim(); // remove % and newline from words
		});
		var rejectedWords = fs.readFileSync('rejectedWords.txt', 'utf-8');
		rejectList = rejectedWords.toString().split('\n').map(function(str) { //create array and trim each element
			return str.trim(); // remove newline from words
		});
		console.log('Dictionary successfully loaded');
	}
	catch (err) {
		io.sockets.emit('error', {message: 'Error loading dictionary'});
        console.log('Error loading dictionary. ' + err);
	}
}


/* Creates a new room ID and places client in the room
 * @param: data - playerName, numPlayers
 */
function createNewGame(data) {
	var roomId,
	 	room,
	 	id = this.id;
	
	// Check if client is requesting a game for more than MAX_PLAYERS
	// This is checked on the server even though the client already prevents this.
	if (data.numPlayers > MAX_PLAYERS) {
		io.sockets.to(id).emit('error', {message: "Maximum number of players: " + MAX_PLAYERS}); 
		return false;
	}
	
	// Create a unique room ID
	do {
		roomId = parseInt(Math.random() * 1000); // Generate random roomId
		room = gameSocket.adapter.rooms[roomId]; // Array of clients in room. Should return nothing if room doesn't exist.
	}
	while (room !== undefined); // Check if room already exists
		
	// Place client in room
	this.join(roomId.toString()); 

	// Store room and client data as in-memory objects
	games[roomId] = {};
	games[roomId].numPlayers = data.numPlayers; 	//same as games[roomId]={numPlayers: data.numPlayers };
	games[roomId].started = false;
	games[roomId].players = {};
	games[roomId].players[id] = {
					name: data.playerName,
					turn: 0,
					score: 0,
					pinBanUsed: 0
	};
	roomLookup[id] = roomId;
	
	data.roomId = roomId;
	data.numPlayersInRoom = 1;
	
    // Emit event to client that they have joined a room
    io.sockets.to(id).emit('playerJoinedRoom', data);  
    console.log('playerJoinedRoom', data.roomId);
}


/* Joins the specified room if available
 * @param: data - playerName, roomId 
 */
function joinExistingGame(data) {
	var room = gameSocket.adapter.rooms[data.roomId]; // Get array of clients in room
	
	// If room exists
	if(room !== undefined) {
    	var numPlayersInRoom = Object.keys(room).length; // Get number of clients in room
    	data.numPlayers = games[data.roomId].numPlayers; // Get number of players needed for game

    	// If room is not full
    	if(numPlayersInRoom < data.numPlayers && !games[data.roomId].started) {
            this.join(data.roomId.toString()); // Join room
            data.numPlayersInRoom = Object.keys(room).length;
            data.mySocketId = this.id; //change to data.id
            
        	// Store client data as in-memory objects       
        	games[data.roomId].players[this.id] = {
        			name: data.playerName,
        			turn: 0,
        			score: 0,
        			pinBanUsed: 0
        	};
        	roomLookup[this.id] = data.roomId;
        	
            // Emit an event notifying all clients in this room that a player has joined
            io.sockets.to(data.roomId).emit('playerJoinedRoom', data);  
            console.log('playerJoinedRoom', data.roomId);
    	}
    	
    	// If room is full OR game has already started
    	else{
    		// Emit an event only to requesting client that room is full
    		io.sockets.to(this.id).emit('error', {message: "Cannot join Room "+ data.roomId + 
    			" as game has already started. Create new game or join a different game."});  
    	}            
    }
	
    // If room does not exist
    else {
    	// Emit an event only to requesting client that room does not exist
    	io.sockets.to(this.id).emit('error',{message: "Room "+ data.roomId + " does not exist."} );
    }
}


/* Generate a random word that is no longer than 6 letters.
 * 3esl' file from http://wordlist.aspell.net/12dicts/ is used to identify simple words.
 * Offensive words are rejected 
 */
function randomWord(){
	var fs = require('fs');
	var simpleWordList;
	try {
		var simpleWords = fs.readFileSync('3esl.txt', 'utf-8');
		simpleWordList = simpleWords.toString().split('\n').map(function(str) { //create array and trim each element
			return str.trim();
		});
		console.log('Simple word list successfully loaded');
	}
	catch (err) {
		io.sockets.emit('error', {message: 'Error loading simple word list'});
        console.log('Error loading simple word list. ' + err);
        return;
	}
	var word;
	do {
		word = simpleWordList[parseInt(Math.random() * simpleWordList.length)];
		//console.log(word);
	}
	while (	word === undefined || 
			(!/^[a-z]+$/.test(word)) || // check for anything except lower case characters
			word.length > 6 || // word length between 3 and 6
			word.length < 3 ||
			rejectList.indexOf(word.toUpperCase) > -1); // check for rejected word
	return word;
}


/* Prepares for the first round:
 * 		Sends an initial word to the players.
 * 		Identifies first player  
 * @param: roomId
 */
function startGame(roomId){
    var keys = Object.keys(games[roomId].players); // Get list of socket IDs in the room
    var data = {
    		roomId: roomId,
    		nextPlayer: keys[0], // nextPlayerId
    		nextPlayerName: games[roomId].players[keys[0]].name,
    		currWord: randomWord().toUpperCase(),
    		pinOrBan: '',
    		letter: '',
    		playerName: '-',
    		score: '-'
    };
	games[roomId].players[data.nextPlayer].turn++;
	games[roomId].started = true;
    io.sockets.to(roomId).emit('newWord', data);
}


/* Checks if at least one letter is reused between the 2 strings
 * @param: string1, string2
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


/*function isEnglishWord(word){
	var ret;
	ret = 	wordList.indexOf(word.toLowerCase) > -1 &&
			rejectList.indexOf(word.toLowerCase) === -1;
	
	return ret;
}*/


/* Checks if the player's response is valid.
 * Most of this is already handled on the client. re-checking on server to disallow cheating.
 * @param: data - currWord, prevWord, pinOrBan, letter
 */
function isValidWord(data) {
	var ret = {
			message: '',
			value: true
	};
	
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
	//TODO: reject list for random word generation should be different from logic for valid word
	if (ret.value) {
		if (wordList.indexOf(data.currWord.toLowerCase()) === -1) { // not in word list
			ret.message = data.currWord + ' is not in our dictionary.';
			ret.value = false;
		}
		// if word is in word list, check if it is a rejected word
		if (ret.value) {
			if (rejectList.indexOf(data.currWord.toLowerCase()) > -1) { // found in rejected list
				ret.message = 'This word is not allowed.';
				ret.value = false;
			}
		}
	}
	console.log('isValidWord: ', ret, data.currWord);
	return ret;
}


/* Returns the longest possible fragment that is reused between the two words
 * @param: currWord, prevWord
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


/* Returns the winner(s) for the specified game
 * @param: roomId
 */
function computeWinner(roomId){
	var players = games[roomId].players; //players in room
	var score = [];
	var winner = [];
	
	for (var id in players) {
		score.push(players[id].score); // Create an array that only contains the score
	}
	var maxScore = Math.max.apply(Math, score); // Calculate highest score

	// Identify player(s) with highest total score
	for (var id in players) {
		if (players[id].score === maxScore){
			winner.push({
				id: id, 
				name: players[id].name, 
				score: players[id].score
			}); 
		}
	}
	console.log('winner:', winner);
	return winner;
}


/* Prepares for the next round if previous player's response is valid.
 * 		Send next word, scores and other related data to all players.
 * 		Identify next player.
 * 		If game is over, send winner information.
 * @param: data - currWord, prevWord, pinOrBan, letter, nextPinOrBan, nextLetter
 */
function nextTurn(data) {
	var id = this.id;
	var roomId = roomLookup[id];
	var valid;
	
	// If no room found for client
	if (roomId === undefined) {
		io.sockets.to(id).emit('error', {message: 'Unable to communicate with room.'});
		return false;
	}
	
	// If player response is invalid
	valid = isValidWord(data);
	if (!valid.value) {
		io.sockets.to(id).emit('error', {message: valid.message});
		return false;
	}
	
	//If word is valid
	data.playerName = games[roomId].players[id].name; // Name of current player
	
	// Identify next player
	var keys = Object.keys(games[roomId].players); // Get list of socket IDs in the room
	var i = (keys.indexOf(id) + 1) % keys.length; // index of next player
	data.nextPlayer = keys[i]; //nextPlayerId ID of next player
	data.nextPlayerName = games[roomId].players[keys[i]].name; // Name of next player
	
	// Identify reused fragment and score
	data.reusedFragment = reusedFragment(data.currWord, data.prevWord);
    data.score = 10 * data.reusedFragment.length; //currScore
    games[roomId].players[id].score += data.score; //update running total ---- change var names to totalScore and currScore 
    data.totalScore = games[roomId].players[id].score; //totalScore
    
    // Assign pin/ ban for next turn
    data.pinOrBan = data.nextPinOrBan; 
    data.letter = data.nextLetter;
    if (data.nextPinOrBan === 'pin' || data.nextPinOrBan === 'ban') {
    	games[roomId].players[id].pinBanUsed++; //update number of pins/ bans used 
    }
    data.nextPinBanLeft = MAX_PIN_BAN - games[roomId].players[data.nextPlayer].pinBanUsed; // number of pins/ bans left for next player
    console.log('nextPinBanLeft', data.nextPlayer, data.nextPinBanLeft);
    
    // Remove unnecessary properties
    delete data.prevWord; 
    delete data.nextPinOrBan;
    delete data.nextLetter;

	// Notify client to prepare for next player's turn
    io.sockets.to(roomId).emit('newWord', data);
	
    // Determine if game is over
    var turn = ++games[roomId].players[data.nextPlayer].turn; // Update turn number
	console.log('end of turn', games[roomId].players);
	if (turn > MAX_TURNS) { // If all turns have been played
		data.winner = computeWinner(roomId);
		delete games[roomId];
		io.sockets.to(roomId).emit('gameOver', data);
	}
}


/* Handles player disconnect event received from client.
 * Deletes player data so turn is not passed to them.
 */
function disconnect() {
	var id = this.id; // ID of disconnected player
	console.log(id, 'disconnected');
	
	// If player belonged to a room
	if (roomLookup[id] !== undefined) {
		var roomId = roomLookup[id]; // Get room ID of disconnected player

		// If game is not over
		if (games[roomId] !== undefined) {
			var players = games[roomId].players; // Get list of players in room
			var playerName = players[id].name; // Name of disconnected player
			var turns = [];
			var nextPlayerId;

			// Notify other players in the room that somebody left
			io.sockets.to(roomId).emit('playerLeftRoom', playerName);
		
			// Determine whose turn it is
			for (var key in players){
				turns.push(players[key].turn);
			}
			var maxTurn = Math.max.apply(Math, turns); // Find the highest turn
			
			for (key in players) {
				if (players[key].turn === maxTurn) { // Identify last player that matches maxTurn
					nextPlayerId = key;
				}
			}
		
			// If disconnected player has the next turn
			if (nextPlayerId === id) {
				console.log('Turn belongs to disconnected player');
				//TODO: Expire the timer for this player
			}
			
			// Delete player data
			delete games[roomId].players[id];
			delete roomLookup[id];
		}
	}
}


// Using 'exports' makes this function available to other files once imported
exports.initGame = function(sio, socket) {
	io = sio;
    gameSocket = socket;
    gameSocket.on('createNewGame', createNewGame);
    gameSocket.on('joinExistingGame', joinExistingGame);
    gameSocket.on('startGame', startGame);
    gameSocket.on('nextTurn', nextTurn);
    gameSocket.on('disconnect', disconnect);
    gameSocket.on('error', function (err) { console.error(err.stack);});
    
    // Load dictionary if not already loaded
	if (wordList.length === 0 || rejectList.length === 0) {
		loadWordLists();
		//console.log('check:', randomWord());
	}
	console.log('checking random word:', randomWord());
};


//TODO: Organize the code better. Like classes..
//var player = function(){
//	a: function(){}	
//};



