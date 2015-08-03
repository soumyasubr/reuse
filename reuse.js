// Global variables
var fs = require('fs');
var config = JSON.parse(fs.readFileSync('config.json','utf-8'));
var io,
	gameSocket,
	games = {}, // game state and player information, indexed by roomId
	roomLookup = {}, // lookup room by client socket ID
	wordList = [], // list of words to validate against
	rejectList = []; // list of words to avoid


/** Load word lists for valid words and offensive words.
 * 	'2of12inf' file from http://wordlist.aspell.net/12dicts/ is used to identify valid words. 
 * 	Word list from bannedwordlist.com was used as starting point to identify rejected words.
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
 *  @param: playerName
 */
function createNewGame(playerName) {
	var roomId,
	 	room,
	 	id = this.id;
	
	// Create a unique room ID
	do {
		roomId = parseInt(Math.random() * 100); // Generate random roomId
		room = gameSocket.adapter.rooms[roomId]; // Array of clients in room. Should return nothing if room doesn't exist.
	}
	while (	room !== undefined || // Check if room already exists
			roomId === 0); // Room Id should be non-zero
		
	this.join(roomId.toString()); // Place client in room

	// Store room and client data as in-memory objects
	games[roomId] = {};
	games[roomId].state = 'waiting';
	games[roomId].players = {};
	games[roomId].players[id] = {
					name: playerName,
					turn: 0,
					totalScore: 0,
					pinBanUsed: 0,
					currPlayer: false
	};
	roomLookup[id] = roomId;
	
	var data = {
			roomId: roomId,
			playerName: playerName,
			playersArray: [],
	};
	data.playersArray.push({id: id,
							name: playerName
	});
	
    // Notify client that they have joined a room
    io.sockets.to(id).emit('playerJoinedRoom', data);  
    console.log(playerName, 'created Game', roomId);
}


/** 
 *  Joins the specified room if available
 * 	@param: data - playerName, roomId 
 */
function joinExistingGame(data) {
	var room = gameSocket.adapter.rooms[data.roomId]; // Get array of clients in room
	
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
	
	if (Object.keys(room).length >= config.MAX_PLAYERS) { //If # clients in room > max permitted
		// Notify requesting client that room is full
		io.sockets.to(this.id).emit('error', {
				processStep: 'join',
				message: 'Game ' + data.roomId + 
					' is full. Create new game or join a different game. '
		});  
		return;
	}
    	
    this.join(data.roomId.toString()); // Place client in room
    data.numPlayersInRoom = Object.keys(room).length; //Recalculate # players in room
    data.id = this.id;
            
	// Store client data as in-memory objects       
	games[data.roomId].players[data.id] = {
			name: data.playerName,
			turn: 0,
			totalScore: 0,
			pinBanUsed: 0,
			currPlayer: false
	};
	roomLookup[data.id] = data.roomId;
	
//	var players = games[data.roomId].players; 
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
 * Generate a random word that is no longer than 7 letters.
 * 5th grade word list from http://www.ideal-group.org/dictionary/ (p-5_ok.txt) is used.
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
			!/^[a-z]+$/.test(word) || // contains only lower case characters (filter out hyphenated words, abbreviations etc.)
			word.length < 3 || 			// word length between 3..
			word.length > 7); 			// .. and 7
	return word;
}


/* Prepares for the first round:
 * 		Sends an initial word to the players.
 * 		Identifies first player  
 * @param: roomId
 */
function firstTurn(roomId) {
	//console.log('firstTurn', roomId, games[roomId]);
	if (games[roomId] == undefined) {
		io.sockets.to(this.id).emit('error', {message: 'Unable to communicate with room. '});
		return;
	}
    var keys = Object.keys(games[roomId].players); // Get list of socket IDs in the room
    var data = {
    		nextPlayerId: keys[0], 
    		nextPlayerName: games[roomId].players[keys[0]].name,
    		currWord: randomWord().toUpperCase(),
    		currPinBanLeft: config.MAX_PIN_BAN,
    		pinOrBan: '',
    		letter: ''	
//			roomId: roomId,
//    		playerName: '(server)',
//    		currScore: '-',
//    		totalScore: 0
    };
	games[roomId].players[data.nextPlayerId].turn++; //increment turn # for first player
	games[roomId].players[data.nextPlayerId].currPlayer = true;
	games[roomId].state = 'started';
    io.sockets.to(roomId).emit('newWord', data);
}


/** 
 * Checks if at least one letter is reused between the 2 strings
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
	
	// Check for special case first. If player passed turn, then word is '-'
	if (data.currWord === '-') {
		return {
			message: 'Turn was passed. ', //TODO: Remove this. Not being used
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
	//console.log('isValidWord: ', ret, data.currWord);
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
	if (keys.length === 1) { // If this is the only player in the room
		return;
	}
	var idx = (keys.indexOf(currPlayerId) + 1) % keys.length; // index of next player
    return keys[idx]; // ID of next player
}


function isGameOver(roomId) {
	var players = games[roomId].players; // Get list of players in room
	
	console.log('isGameOver, players:', players);
	
	if (players.length === 1) { // If room has only 1 player //TODO: There is no length property for this object. CHange!
		// end game
		return true;
	}
	else {
		// Check if all turns have been played
		var turnsPlayed;
		for (var key in players) {
				turnsPlayed = players[key].turn; // last player's turn
		}
		
		if (turnsPlayed === config.MAX_TURNS) { // If each player has played specified # of turns
			return true; //game over
		}
	}
	return false; // if game is not over
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
	
	if (roomId == undefined) { // If no room found for client
		io.sockets.to(data.id).emit('error', {message: 'Unable to communicate with room. '});
		return;
	}
	console.log('in nextTurn, data:', data);
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
	
	//TODO: Don't send player name. client can retrieve from PlayersArray
	data.playerName = games[roomId].players[data.id].name; // Name of current player
	
	// Identify reused fragment and score
	if (data.currWord === '-') { // If turn was passed
		//data.reusedFragment = '';
		data.currScore = 0; // no points for this turn
		data.currWord = data.prevWord;
	}
	else { // if a valid word was received
		data.reusedFragment = reusedFragment(data.currWord, data.prevWord); // Identify reused fragment
	    data.currScore = 10 * data.reusedFragment.length; // calculate score for current turn
	}
    games[roomId].players[data.id].totalScore += data.currScore; //update total score
    data.totalScore = games[roomId].players[data.id].totalScore; 
	
    
    if (!isGameOver(roomId)) { // If game is NOT over
        // Assign pin/ ban for next turn
        data.pinOrBan = data.nextPinOrBan; 
        data.letter = data.nextLetter;
        if (data.nextPinOrBan === 'pin' || data.nextPinOrBan === 'ban') {
        	games[roomId].players[data.id].pinBanUsed++; //update # of pins/ bans used for current player
        }
        data.currPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.id].pinBanUsed; // number of pins/ bans left for current player
        
    	// Get next player info
    	data.nextPlayerId = identifyNextPlayer(data.id); // Get ID of next player
    	if (data.nextPlayerId !== undefined) { // If this is not the only player in the room
    		data.nextPlayerName = games[roomId].players[data.nextPlayerId].name; // Name of next player //TODO: Don't send name
    		console.log('nextTurn. next player:', data.nextPlayerId, data.nextPlayerName);
    	    data.nextPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.nextPlayerId].pinBanUsed; // number of pins/ bans left for next player
    	    
    	    //Update player information on server
    	    games[roomId].players[data.nextPlayerId].turn++; // Update turn number for next player
        	games[roomId].players[data.id].currPlayer = false;
        	games[roomId].players[data.nextPlayerId].currPlayer = true;
    	    
        	io.sockets.to(roomId).emit('newWord', data); // Notify clients to prepare for next player's turn
    	}
    	else {
    		console.log ('in nextTurn: only 1 player in room');
    	}
    }
    else { // If game is over
  		data.winner = computeWinner(roomId); // get winner info
  		console.log('winner:', data.winner);
  		games[roomId].state = 'ended';
//  		//delete games[roomId]; // clean up array
 		
  		// Notify clients that game is over
  		io.sockets.to(roomId).emit('gameOver', data); 
    }

//    Remove unnecessary properties
//    delete data.prevWord; 
//    delete data.nextPinOrBan;
//    delete data.nextLetter;

}


/** 
 * Handles player disconnect event received from client.
 * Deletes player data so turn is not passed to them.
 */
function disconnect() {
	var _this = this;
	var id = this.id; // ID of disconnected player  
	var data = {};
	var roomId = roomLookup[id]; // Room ID of disconnected player
	var currPlayerId;
	
	
	console.log('***************', id, 'disconnected ***********');
	
	// If player didn't belong to a room, do no more
	if (roomId == undefined) {
		return;
	}
	
	var players = {};
	players = games[roomId].players; // Get list of players in room
	//console.log('players: ',players);
	
	// Notify other players in the room that somebody left
	io.sockets.to(roomId).emit('playerLeftRoom', 
								{id: id, 
								name: players[id].name, 
	});
	console.log(players[id].name, 'left room', roomId);

	// if game is in waiting or ended state..
	console.log('game state: ', games[roomId].state);
	if (games[roomId].state !== 'started') {
		removePlayer(); // delete player info
		return; // Do nothing more
	}
	
	// Identify who has the current turn
	for (var key in players) {
		if (players[key].currPlayer) {
			currPlayerId = key;
		}
	}
	
	// If the player that left did not have the active turn..
	if (currPlayerId !== id) {
		removePlayer(); // delete player info
		console.log('DO NOTHING. not disconnected player\'s turn. ',currPlayerId);
		return; // Do nothing more
	}
	
	//**** If player who left had the active turn *****//
	
	//TODO: Create function
	if (!isGameOver(roomId)) { // If game is NOT over
		//console.log('Game not over');
		
    	// Get next player info
    	data.nextPlayerId = identifyNextPlayer(id); // Get ID of next player
    	if (data.nextPlayerId !== undefined) { // If this is not the only player in the room
    		data.nextPlayerName = games[roomId].players[data.nextPlayerId].name; // Name of next player //TODO: Don't send name
    		console.log('in disconnect. next player:', data.nextPlayerId, data.nextPlayerName);
    	    data.nextPinBanLeft = config.MAX_PIN_BAN - games[roomId].players[data.nextPlayerId].pinBanUsed; // number of pins/ bans left for next player
    	    
    	    //Update player data on server
    	    games[roomId].players[data.nextPlayerId].turn++; // Update turn number for next player
        	games[roomId].players[id].currPlayer = false;
        	games[roomId].players[data.nextPlayerId].currPlayer = true;
    	   
    	    io.sockets.to(roomId).emit('activateNextPlayer', data); // Notify clients to skip to next player
    	    //console.log('data sent to client:', data);
    	}
    	else {
    		//TODO: Handle only one player in room
    		console.log ('disconnect: only 1 player in room');
    	}
    }
    else { // If game is over
  		data.winner = computeWinner(roomId); // get winner info
  		console.log('winner:', data.winner);
  		games[roomId].state = 'ended';
//  	//delete games[roomId]; // clean up array
 		
  		// Notify clients that game is over
  		io.sockets.to(roomId).emit('gameOver', data); 
    }
	
	removePlayer();
	
	/**
	 * Removes player from room and deletes player info from server
	 * (within scope of disconnect)
	 */
	function removePlayer() {
		//Delete player data
		try {
//			this.leave(roomId);
			_this.leave(roomId);
			delete games[roomId].players[id];
			delete roomLookup[id];
		}
		catch (err) {
	        console.log('Could not delete from array: ' + err);
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
    gameSocket.on('disconnect', disconnect);
    gameSocket.on('leaveGame', disconnect);
    gameSocket.on('error', function (err) { console.error(err.stack);});
    
    // Load dictionary if not already loaded
	if (wordList.length === 0 || rejectList.length === 0) {
		loadWordLists();
		console.log('Testing random word:', randomWord());
	}
};


//TODO: Organize the code better. Like classes..
//var player = function(){
//	a: function(){}	
//};



