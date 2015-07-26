var App = function() {
	'use strict';
	var socket = io.connect();
	var	myName, // player name
		myRoomId, // player room
		myPinOrBan, // pin or ban challenge for current turn
		myLetter, 	// letter pinned or banned for current turn
		myTimerId, // timer handler
		turnsArray = [], // array with data for each turn
		totalScoresArray = []; //array with total scores for each player
	
	//Display the landing page with Create and Join buttons
	showScreen('#create-join');
//	$('#game-screen').hide();
//	$('#game-over').hide();
//	$('#create-join').show();
	
	function createGame() {
		myName = $('#name-input').val() || socket.id;
		var data = {
				playerName: myName, 
				numPlayers: parseInt($('#numPlayers-input').val())
		};
	    socket.emit('createNewGame',data);
	    return false;
	}
	    
	
	function joinGame() {
		myName = $('#name-input').val() || socket.id;
	    var data = {
		    	playerName: myName, 
				roomId: $('#room-input').val()
	    };
	    
	    // Validate room input
	    if(data.roomId.length === 0) {
	    	$('#message1').text('Enter a room id.');
	    	return false;
	    }
	    
	    socket.emit('joinExistingGame', data);
	    return false;
	}
	
	
	function playerJoinedRoom(data) {
		myRoomId = data.roomId; 
		
		// Update form elements
	    $('#create-btn').prop('disabled', true);
		$('#join-btn').prop('disabled', true);
		$('#room-input').val('');
		$('#room-input').prop('disabled', true);
		$('#numPlayers-input').prop('disabled', true);
		$('#name-input').val(myName);
		$('#name-input').prop('disabled', true);
		
		// If all players have not joined, then wait
		if (data.numPlayersInRoom < data.numPlayers) {
			if (data.numPlayersInRoom === 1) { // If this is the host (first person to join room)
				$('#message1').text('Created room ' + data.roomId + ' for ' + data.numPlayers + 
						' players. The game will automatically start once all players join.');
			}
			if (data.numPlayersInRoom >= 2) { // If at least 2 players are in the room
				$('#start-btn').show(); // Enable start button
				$("#message1").text(data.playerName + ' joined room ' + data.roomId +
						'. The game will automatically start once all players join.');
			}
		}
		
		// If all players have joined, then start game
		else if (data.numPlayersInRoom === data.numPlayers) {
			// Only the last client to join the room notifies the server to start game.
			// This is to avoid multiple emits going to the server.
			if (socket.id === data.id){
				socket.emit('startGame',data.roomId);
			}
		}
		
		//If room is full. This is an error trap. This is already handled on the server.
		else {
			$("#message1").text("Too many players. Expected " + data.numPlayers + 
					". Found " + data.numPlayersInRoom);		
		}
	}
	
	
	function isFragmentReused(string1, string2) {
		var shortWord,
		 	longWord,
		 	i = 0,
		 	isReused=false;
		if (string1.length < string2.length) {
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
	
	
/* On Submit button click.
 * First, validate word input. Then validate pin ban input. 
 *  if valid, send request to server to validate against dictionary.
 */	
	function validateResponse() {
		var currWord = $('#word-input').val().toUpperCase().trim();
		var prevWord = $("#word").text();
		var valid = true;
		var message = '';
		//$("#message2").text(''); // Reset message area
		
		// Check if a word has been entered
		if(currWord.length === 0) {
			//$("#message2").text('Enter a word.');
			message = 'Enter a word.';
			return false;
		}
		
		// Check for spaces or special characters
		if (!/^[A-Z]+$/.test(currWord)) { 
			//$("#message2").text('Word can only contain letters. No spaces or special characters.');
			message = 'Word can only contain letters. No spaces or special characters.';
			valid = false;
		}
	
		// Check if at least one letter is reused
		if (!isFragmentReused(currWord, prevWord)){
			//$("#message2").append('<br>Must reuse at least one letter from the previous word.');
			message += '<br>Must reuse at least one letter from the previous word.';
			valid = false;
		}
		
		// Check if the word has been played before
/*		var pastWords = " " + $('#word-list').find('li').filter(function() { // Convert unordered list into string separated by spaces
	        return $(this).find('ul').length === 0;
	    	}).map(function(i, e) {
	    		return $(this).text();
	    	}).get().join(' ') + " ";*/
		var pastWords = turnsArray.map(function(obj) {
			return obj.word;
		});
		console.log(currWord, pastWords);
		if (pastWords.indexOf(currWord) > -1) { // if currWord is contained in pastWords 
			//$("#message2").append('<br>' + currWord + ' has already been played.');
			message += '<br>' + currWord + ' has already been played.';
			valid = false;
		}
		
		// Check if word is subset of previous word
		else if (prevWord.indexOf(currWord) > -1){ // if currWord is contained in prevWord
			//$("#message2").append('<br>Word cannot be a subset of the previous word.');
			message += '<br>Word cannot be a subset of the previous word.';
			valid = false;
		} 
	
		// Check if word contains the pinned letter
		if (myPinOrBan === 'pin') {
			if (currWord.indexOf(myLetter) === -1){ // if pinned letter is NOT contained in currWord
				//$("#message2").append('<br>Word should contain the pinned letter: ' + myLetter + '.');
				message += '<br>Word should contain the pinned letter: ' + myLetter + '.';
				valid = false;
			} 
		}
		
		// Check if word contains the banned letter
		else if (myPinOrBan === 'ban'){
			if (currWord.indexOf(myLetter) > -1){ // if banned letter is contained in currWord
				//$("#message2").append('<br>Word should not contain the banned letter: ' + myLetter + '.');
				message += '<br>Word should not contain the banned letter: ' + myLetter + '.';
				valid = false;
			} 
		}
		
		$("#message2").html(message); //display message
		
		// If word is invalid, don't validate pin/ ban yet
		if (!valid) {  
			return false; 
		}
		
		// Validate pin/ ban input
		var pb; // pin or ban for next player
		var l = $("#letter-input").val().toUpperCase().trim(); // letter to pin or ban for next player
	
		// If Pin/ Ban is selected
		if ($(".pin-ban-rdo").is(':checked')) {
			pb = $(".pin-ban-rdo:checked").val();
			
			// Check if letter is entered
			if(l.length === 0) { 
				//$("#message2").text("Enter a letter from your word to pin/ ban");
				message = 'Enter a letter from your word to pin/ ban';
				valid = false;
			}
			
			// Check if more than one letter is entered
			else if (l.length > 1) { 
				//$("#message2").text("Enter only ONE letter to pin/ ban");
				message = 'Enter only ONE letter to pin/ ban';
				valid = false;
			}
			
			// Check if letter exists in current word
			else if (currWord.indexOf(l) === -1) { // if letter does not exist in current word
				//$("#message2").text("Letter should be in the word " + currWord);
				message = 'Letter should be in the word ' + currWord;
				valid = false;
			}
		}
		
		
		else { // If Pin/ Ban not selected
			pb = '';
			l = '';
		}
		
		$("#message2").html(message); //display message
		
		// If user input is valid, request server to validate against dictionary and prepare next turn
		if (valid) {
			var data = {
					//roomId: myRoomId, //instead, identify on server using roomLookup
					//playerName: myName, // instead, identify name on server using socket ID
					currWord: currWord,
					prevWord: prevWord,
					pinOrBan: myPinOrBan,
					letter: myLetter,
					nextPinOrBan: pb,
					nextLetter: l
			};
			socket.emit('nextTurn',data);
			console.log('nextTurn',data);
		}
		return false;
	}
	
	
/*	Display error messages
*/	
	function error(err){
		$('#message1').text(err.message);	
		$('#message2').text(err.message);
	}
	
	
/*	On Pin Ban radio button click
*/	
	$('.pin-ban-rdo').click(function() {
		
		// Toggle check and uncheck
		if ($(this).hasClass('uncheck')){ // if previously checked
			$(this).prop('checked', false); // uncheck radio button
			$('.pin-ban-rdo').removeClass('uncheck'); // can no longer uncheck this
		}
		else{ // if not previously checked
			$('.pin-ban-rdo').removeClass('uncheck'); // remove uncheck from any radio button in the group
			$(this).addClass('uncheck'); 
		}
		
		// Show text box only if pin or ban is checked	
		if ($('.pin-ban-rdo').is(':checked')) {
			$('#letter-input').show();
		}
		else{
			$('#letter-input').hide();
		}
	});
	
	
	
/*	If game is over display winner and all words played along with scores
*/	
	function gameOver(winner) {
		var text = '';
		
		// Display 'game-over' div and hide other divs.
		showScreen('#game-over');
//		$('#create-join').hide();
//		$('#game-screen').hide();
//		$('#game-over').show();
	
		//populate table with all words
		showWordList('#word-list2'); 
		
		//Stop timer if still running
		stopTimer();
		
		if (winner.length === 1){
			if (winner[0].id === socket.id){
				text = 'Yoohoo! You Win';
			}
			else{
				text = winner[0].name + ' wins';
			}
		}
		else if (winner.length > 1){
			text = "It's a tie between ";
			for (var i=0; i<winner.length; i++){
				if (winner[i].id === socket.id){
					text = text + "you and ";
				}
				else{
					text = text + winner[i].name + " and ";
				}
			}
			text = text.slice(0,-5); // remove last 5 characters - " and "
		}
		$("#message3").text(text + '!');
	}
	
	
/*	Stop timer
*/	
	function stopTimer() {
		clearTimeout(myTimerId);
		$("#timer").text('1:00');
		console.log('Timer stopped');
	}
	
/*	Start timer
*/	
	function startTimer() {
		var timeLeft = 600;
		function countdown() {
			if (timeLeft === 0) {
				//stopTimer();
				socket.emit('passTurn');
				console.log('Time is up');
			} 
			else {
				timeLeft--;
				$("#timer").text('0:' + timeLeft);
			}
		}
		console.log('Timer started');
		myTimerId = setInterval(countdown, 1000);
		
	}
	
	
//	function makeActivePlayer(pinBanLeft) {
//		$('#word-input').prop('disabled',false);
//		$('#submit-btn').prop('disabled',false);
//		$('#message2').text('Your turn.');
//			$('.pin-ban-rdo').prop('disabled',false);
//		if (pinBanLeft === 0) {
//			$('.pin-ban-rdo').prop('disabled',true);
//		}	
//	}
//	
//	function makeInactivePlayer(nextPlayerName) {
//		$('#word-input').prop('disabled',true);
//		$('#submit-btn').prop('disabled',true);
//		$('.pin-ban-rdo').prop('disabled',true);
//		$('#message2').text(nextPlayerName + "'s turn.");
//	}
	
	
	
/*	Activate form elements for current player only, disable for everyone else
*/	
	function activateNextPlayer(data) {
		// Reset form elements
		$('#word-input').val('');
		$('#letter-input').val('');
		$('#letter-input').hide();
		$('.pin-ban-rdo').prop('checked', false); 
		$('.pin-ban-rdo').removeClass('uncheck'); // reset check/ uncheck toggle
		
		if (data.nextPlayerId === socket.id) { 
			//makeActivePlayer(data.nextPinBanLeft);
			
			// Enable form elements for next player
			$('#word-input').prop('disabled',false);
			$('#submit-btn').prop('disabled',false);
			$('#message2').text('Your turn.');
				$('.pin-ban-rdo').prop('disabled',false);
			if (data.nextPinBanLeft === 0) {
				$('.pin-ban-rdo').prop('disabled',true);
			}	
			
			// Start timer
			console.log('in activateNextPlayer');
			startTimer(); 
		}
		else {
			//makeInactivePlayer(data.nextPlayerName);
			
			// Disable form elements for all other players
			$('#word-input').prop('disabled',true);
			$('#submit-btn').prop('disabled',true);
			$('.pin-ban-rdo').prop('disabled',true);
			$('#message2').text(data.nextPlayerName + "'s turn.");
			
			// Stop timer
			console.log('in activateNextPlayer');
			stopTimer();
		}
	}
	
	
	function showScreen(divId) {
		$('div:not('+ divId +')').hide(); // hide everything that isn't #divId
		$(divId).show();
	}

	
	/**
	* Displays the words, scores etc as a matrix
	* @param: numRows - (optional) number of rows to display. By default all rows are displayed.
	* Otherwise the specified number of rows starting from the most recent are displayed.
	*/
	function showWordList(tableId, numRows) {
		var startIndex;
		if (numRows == undefined) { // if all rows should be displayed
			numRows = turnsArray.length;
			startIndex = 0;
		}
		else { // to display the last 'numRows' rows
			startIndex = turnsArray.length - numRows;
			startIndex = startIndex < 0 ? 0 : startIndex; //convert negative numbers to 0
		}
		//console.log('showWordList: turnsArray',turnsArray);
		
		// Update table
		//TODO: Change from list to table
		$(tableId).empty();
		for (var i = startIndex; i < turnsArray.length; i++) {	
			$(tableId).append($('<li>').html(turnsArray[i].blueWord + ' ' + turnsArray[i].score + ' ' + turnsArray[i].playerName));
		}
		// TODO:Display total scores
		$(tableId).append($('<li>').html('TOTAL: display total here'));
	}
	

	/**
	 * When a word is received from the server, it is displayed on all clients with necessary formatting.
	 * @param data - data received from server
	 */
	function displayNewWord(data) {
		var formattedWord;
		
		//Show only game screen
		showScreen('#game-screen');
//		$('#create-join').hide();
//		$('#game-screen').show();
		
		// Activate next player
		activateNextPlayer(data);
		
		// Apply green/ red color to pinned/ banned letter
		if (myPinOrBan === ''){
			formattedWord = data.currWord; // no formatting
		}
		else if (myPinOrBan === 'pin'){
			formattedWord =  data.currWord.replace(myLetter, '<span style="color:lime">' + myLetter + '</span>'); 
		}
		else if (myPinOrBan === 'ban'){
			formattedWord =  data.currWord.replace(myLetter, '<span style="color:red">' + myLetter + '</span>');
		}
		$('#word').html(formattedWord);
		
		showWordList('#word-list',3); //populate table with last 3 words
		
		// Apply blue color to re-used fragment
//		formattedWord =  data.currWord.replace(data.reusedFragment, '<span style="color:blue">' + data.reusedFragment + '</span>');
//		$('#word-list').append($('<li>').html(formattedWord + ' ' + data.currScore + ' ' + data.playerName));
//		$('#word-list2').append($('<li>').html(formattedWord + ' ' + data.currScore + ' ' + data.playerName));
		
	}
	
	
	function getNewWordData(data) {
		//Get data from the server
		turnsArray.push({
			word: data.currWord,
			blueWord:  data.currWord.replace(data.reusedFragment, // Apply blue color to re-used fragment
							'<span style="color:blue">' + 
							data.reusedFragment + '</span>'),
			playerID: data.id,
			playerName: data.playerName,
			score: data.currScore
		});
		totalScoresArray[data.id] = data.totalScore;
		myPinOrBan = data.pinOrBan;
		myLetter = data.letter; 
		
		displayNewWord(data);
	}
	
	function playerLeftRoom(name) {
		$("#message1").text(name + " left the game.");
		$("#message2").text(name + " left the game.");
	}
	
	
	function startGame() {
		// Show confirm dialog 
		if(confirm("All users have not joined. " +
				"Starting the game will block other players from joining the game.")) {
		    //Ok button pressed
			socket.emit('startGame', myRoomId);	
		}	
	}
	
	
	//Event handlers
	$('#create-btn').on('click', createGame);
	$('#join-btn').on('click', joinGame);
	$("#submit-btn").on("click", validateResponse);
	$('#start-btn').on('click', startGame);
	$('#room-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	joinGame();
	    }
	});
	
	
	socket.on('playerJoinedRoom', playerJoinedRoom );
	socket.on('newWord', getNewWordData);
	//socket.on('responseAccepted', stopTimer);
	socket.on('activateNextPlayer', activateNextPlayer);
	socket.on('playerLeftRoom', playerLeftRoom );
	socket.on('gameOver', gameOver);
	socket.on('error', error);
	
};

// Initial call
new App();
