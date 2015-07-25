// Global variables
var fs = require('fs');
var config = JSON.parse(fs.readFileSync('config.json','utf-8'));
var io,
	gameSocket,
	games = {}, // game state and player information, indexed by roomId
	roomLookup = {}, // lookup room by client socket ID
	wordList = [], // list of words to validate against
	rejectList = []; // list of words to avoid


/* Load word lists for valid words and offensive words 
 * '2of12inf' file from http://wordlist.aspell.net/12dicts/ is used to identify valid words.
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
			return str.trim(); // remove newline from each word
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
	if (data.numPlayers > config.MAX_PLAYERS) {
		io.sockets.to(id).emit('error', {message: "Maximum number of players: " + config.MAX_PLAYERS}); 
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
	games[roomId].numPlayers = data.numPlayers; 	
	games[roomId].state = '';
	games[roomId].players = {};
	games[roomId].players[id] = {
					name: data.playerName,
					turn: 0,
					totalScore: 0,
					pinBanUsed: 0
	};
	roomLookup[id] = roomId;
	
	data.roomId = roomId;
	data.numPlayersInRoom = 1;
	
    // Notify client that they have joined a room
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
    	if(numPlayersInRoom < data.numPlayers && games[data.roomId].state !== 'started') {
            this.join(data.roomId.toString()); // Join room
            data.numPlayersInRoom = Object.keys(room).length;
            data.id = this.id;
            
        	// Store client data as in-memory objects       
        	games[data.roomId].players[this.id] = {
        			name: data.playerName,
        			turn: 0,
        			totalScore: 0,
        			pinBanUsed: 0
        	};
        	roomLookup[this.id] = data.roomId;
        	
            // Notify all clients in this room that a player has joined
            io.sockets.to(data.roomId).emit('playerJoinedRoom', data);  
            console.log('playerJoinedRoom', data.roomId);
    	}
    	
    	// If room is full OR game has already started
    	else{
    		// Notify requesting client that room is full
    		io.sockets.to(this.id).emit('error', {message: "Cannot join Room "+ data.roomId + 
    			" as game has already started. Create new game or join a different game."});  
    	}            
    }
	
    // If room does not exist
    else {
    	// Notify requesting client that room does not exist
    	io.sockets.to(this.id).emit('error',{message: "Room "+ data.roomId + " does not exist."} );
    }
}


/* Generate a random word that is no longer than 6 letters.
 * 3esl' file from http://wordlist.aspell.net/12dicts/ is used to identify simple words.
 * Offensive words are rejected 
 */
function randomWord(){
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
		io.sockets.emit('error', {message: 'Error loading simple word list'});
        console.log('Error loading simple word list. ' + err);
        return;
	}
	
	// Generate a random word that matches the criteria
	do {
		word = simpleWordList[parseInt(Math.random() * simpleWordList.length)];
	}
	while (	word === undefined || 
			(!/^[a-z]+$/.test(word)) || // contains only lower case characters (filter out hyphenated words, abbreviations etc.)
			word.length < 3 || 			// word length between 3..
			word.length > 6 || 			// .. and 6
			rejectList.indexOf(word) > -1); // check for rejected word
	return word;
}


/* Prepares for the first round:
 * 		Sends an initial word to the players.
 * 		Identifies first player  
 * @param: roomId
 */
function firstTurn(roomId){
    var keys = Object.keys(games[roomId].players); // Get list of socket IDs in the room
    var data = {
    		roomId: roomId,
    		nextPlayerId: keys[0], 
    		nextPlayerName: games[roomId].players[keys[0]].name,
    		currWord: randomWord().toUpperCase(),
    		pinOrBan: '',
    		letter: '',
    		playerName: '-',
    		currScore: '-',
    		totalScore: '-'
    };
	games[roomId].players[data.nextPlayerId].turn++;
	games[roomId].state = 'started';
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
			ret.message = "Can't find " + data.currWord + ' in our dictionary.';
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


/* Return socket ID of next player
 * @param: currPlayerId
*/
function identifyNextPlayer(currPlayerId) {
	var keys = Object.keys(games[roomLookup[currPlayerId]].players); // Get list of socket IDs in the room
	var idx = (keys.indexOf(currPlayerId) + 1) % keys.length; // index of next player
    return keys[idx]; // ID of next player
}


/* Check if game is over
 * @param: nextPlayerId
 */
function checkGameOver(nextPlayerId) {
	var roomId = roomLookup[nextPlayerId];
    var turn = ++games[roomId].players[nextPlayerId].turn; // Update turn number
	console.log('next player:', nextPlayerId, '\ndata:', games[roomId].players);
	if (turn > config.MAX_TURNS) { // If all turns have been played
		var winner = computeWinner(roomId); // get winner info
		console.log('winner:', winner);
		games[roomId].state = 'ended';
		//delete games[roomId]; // clean up array
		
		// Notify clients that game is over
		io.sockets.to(roomId).emit('gameOver', winner); 
	}
}

/* Prepares for the next round if previous player's response is valid.
 * 		Send next word, scores and other related data to all players.
 * 		Identify next player.
 * 		If game is over, send winner information.
 * @param: data - currWord, prevWord, pinOrBan, letter, nextPinOrBan, nextLetter
 */
function nextTurn(data) {
	data.id = this.id;
	var roomId = roomLookup[data.id];
	var valid;
	
	// If no room found for client
	if (roomId === undefined) {
		io.sockets.to(data.id).emit('error', {message: 'Unable to communicate with room.'});
		return;
	}
	
	// Notify player whether response is valid or invalid
	valid = isValidWord(data);
	if (valid.value) {
//		io.sockets.to(data.id).emit('responseAccepted');
	}
	else {
		io.sockets.to(data.id).emit('error', {message: valid.message});
		return;
	}
	
	//If word is valid
	data.playerName = games[roomId].players[data.id].name; // Name of current player
	
	// Get next player info
	data.nextPlayerId = identifyNextPlayer(data.id);
	data.nextPlayerName = games[roomId].players[data.nextPlayerId].name; // Name of next player
    data.nextPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.nextPlayerId].pinBanUsed; // number of pins/ bans left for next player
	
	// Identify reused fragment and score
	data.reusedFragment = reusedFragment(data.currWord, data.prevWord);
    data.currScore = 10 * data.reusedFragment.length; // score for this turn
    games[roomId].players[data.id].totalScore += data.currScore; //update total score
    data.totalScore = games[roomId].players[data.id].totalScore; 
    
    // Assign pin/ ban for next turn
    data.pinOrBan = data.nextPinOrBan; 
    data.letter = data.nextLetter;
    if (data.nextPinOrBan === 'pin' || data.nextPinOrBan === 'ban') {
    	games[roomId].players[data.id].pinBanUsed++; //update number of pins/ bans used 
    }
    
    // Remove unnecessary properties
    delete data.prevWord; 
    delete data.nextPinOrBan;
    delete data.nextLetter;

	// Notify clients to prepare for next player's turn
    io.sockets.to(roomId).emit('newWord', data);
	
    // Check if game is over
    checkGameOver(data.nextPlayerId);
}


/* Notify clients to end current player's turn and pass turn to next player.
 * @param: id - Socket ID of current player
 */
function passTurn(id) {
	id = this.id || id; //either use id value passed to function or id of calling socket
	var roomId = roomLookup[id];
	var data = {};
	
	// Get next player info
	data.nextPlayerId = identifyNextPlayer(id); // Id of next player
	data.nextPlayerName = games[roomId].players[data.nextPlayerId].name; // Name of next player
    data.nextPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.nextPlayerId].pinBanUsed; // number of pins/ bans left for next player
        
    // Notify clients to activate player
    io.sockets.to(roomId).emit('activateNextPlayer', data);
    
    // Check if game is over
    if (games[roomId].state !== 'ended') {
    	checkGameOver(data.nextPlayerId);  
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
			var turns = [];
			var key;
			var data = {};

			// Notify other players in the room that somebody left
			io.sockets.to(roomId).emit('playerLeftRoom', players[id].name);
		
			// Determine whose turn it is
			for (key in players) {
				if (players.hasOwnProperty(key)) {
					turns.push(players[key].turn); // create an array with turn #s
				}
			}
			var maxTurn = Math.max.apply(Math, turns); // Find the highest turn #
			
			for (key in players) {
				if (players[key].turn === maxTurn) { // Identify last player that matches maxTurn
					break;
				}
			}
		
			// If the player who left had the active turn, pass turn to next player
			if (key === id) {
				passTurn(id);
			}
			
			// Delete player data
			try {
				delete games[roomId].players[id];
				delete roomLookup[id];
			}
			catch (err) {
		        console.log('Could not delete from array: ' + err);
			}
			
		}
	}
}


// Using 'exports' makes this function available to other files once imported
exports.initGame = function(sio, socket) {
	io = sio;
    gameSocket = socket;
    gameSocket.on('createNewGame', createNewGame);
    gameSocket.on('joinExistingGame', joinExistingGame);
    gameSocket.on('startGame', firstTurn);
    gameSocket.on('nextTurn', nextTurn);
    gameSocket.on('passTurn', passTurn);
    gameSocket.on('disconnect', disconnect);
    gameSocket.on('error', function (err) { console.error(err.stack);});
    
    // Load dictionary if not already loaded
	if (wordList.length === 0 || rejectList.length === 0) {
		loadWordLists();
		//console.log('Random word test:', randomWord());
	}
	console.log('testing random word:', randomWord());
};


//TODO: Organize the code better. Like classes..
//var player = function(){
//	a: function(){}	
//};



