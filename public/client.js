var App = function() {
	'use strict';
	var socket = io.connect();
	var	myName, // player name
		myRoomId, // player room
		myPinOrBan, // pin or ban challenge for current turn
		myLetter, 	// letter pinned or banned for current turn
		myTimerId, // timer handler
		turnsArray = [], // array with data for each turn
		playersArray;
	
	var MAX_TIME = 60; // Temporary config for testing.

	//TODO: Avoid sending player name from server as it is available in playersArray.

	//Display the landing page with Create and Join buttons
	showScreen('#home');
	// showScreen('#game-screen');
	// showScreen('#game-over');

	
	/**
	 * Requests server to create a new game
	 */
	function createGame() {
		var name = $('#name-input').val().trim() || 'Anonymous';
		if (!/^[A-Za-z0-9 ]+$/.test(name)) { 
			showMessage({
				message: 'Name cannot contain special characters.',
				type: 'error',
				screen: '#home'
			});
			return;
		}
		
		myName = name; // Store name on client
		
	    socket.emit('createNewGame',myName);
	}
	    
	
	/**
	 * Requests server to join the specified game
	 */
	function joinGame() {
		var name = $('#name-input').val().trim() || 'Anonymous';
		if (!/^[A-Za-z0-9 ]+$/.test(name)) { 
			showMessage({
				message: 'Name cannot contain special characters.',
				type: 'error',
				screen: '#home'
			});
			return;
		}
		
		myName = name; // Store name on client
		
	    socket.emit('joinExistingGame', {
	    	playerName: myName, 
			roomId: $('#room-input').val()
	    });
	}
	
	
	/**
	 * Updates lobby as players join the game
	 * @param - data - Object received from server
	 */
	function playerJoinedRoom(data) {
		myRoomId = data.roomId;
		playersArray = data.playersArray;
		
		if (playersArray.length === 1) { // If this is the host (first person to join room)
			$('#lobby h3').html('Hello, ' + data.playerName + 
								'!<br>Invite your friends to a game.<br>' +
								'Game ID: ' + myRoomId + '.');
		}
		else { // If this is someone joining the game
			if (socket.id === data.id) { // To player who just joined..
				$('#lobby h3').html('Hello, ' + data.playerName + 
									"! <br> You've joined Game " + myRoomId + '.'); // Display message
			}
			else { // To other players
				showMessage( { // Notify that a player joined
					screen: '#lobby',
					message: data.playerName + ' joined. ',
					type: 'info'
				});
			}
		}
		updatePlayerList(); // Update list of players
		checkStartStatus(); // Enable or disable Start button
		showScreen('#lobby'); // Switch to lobby
	}
	
	
	/**
	 * Updates the list of players in the room
	 */
	function updatePlayerList() {
		$('#players-list TBODY TR').remove(); // empty table
		for (var i=0; i<playersArray.length; i++) { // populate player names from playersArray
			if (playersArray[i]) {
				$('#players-list TBODY').append('<tr><td>' + playersArray[i].name + '</td></tr>');	
			}
		}
	}
	
	
	/**
	 * Enables Start button only if at least 2 players are present
	 */
	function checkStartStatus() {
		if (playersArray.length >= 2) { // If at least 2 players are in the room
			$('#start-btn').prop('disabled', false); // Enable start button
		}
		else {
			$('#start-btn').prop('disabled', true); // Disable start button
		}
	}
	
	
	/** 
	 * Checks if at least one letter is reused between the 2 strings
	 * @param: string1, string2
	 */
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
	
	/**
	 * Sends player's response (word + other info) to the server 
	 */
	function sendPlayerResponse() {
		//TODO: get prev turn data from turnsArray instead
		var prevWord = $("#word").text();
		
		// Current turn data
		var currWord = $('#word-input').val().toUpperCase().trim();
		var pb = ''; // pin or ban for next player
		var l = $("#letter-input").val().toUpperCase().trim(); // letter to pin or ban for next player
		
		// If user input is valid, request server to validate against dictionary and prepare next turn
		if (validateResponse()) {
			var data = {
					//roomId: myRoomId, //instead, identify on server using roomLookup
					//playerName: myName, // instead, identify name on server using socket ID
					currWord: currWord,
					prevWord: prevWord,
					pinOrBan: myPinOrBan,  //TODO: place this in turnsArray
					letter: myLetter,
					nextPinOrBan: pb,
					nextLetter: l,
					id: socket.id
			};
			socket.emit('nextTurn',data);
			console.log('Request server to validate response', data);
		}
		

		/** 
		 * Validates the input word. If word is valid, then pin ban input is validated. 
		 * (within scope of sendPlayerResponse)
		 */	
		function validateResponse() {
			var valid = true;
			var message = '';
			
			// Check for special case. If player passed turn, then word is '-'
			if (currWord === '-') {
				return true;
			}
			
			// If word was entered
			if(currWord.length > 0) {
			
				// Check for spaces or special characters
				if (!/^[A-Z]+$/.test(currWord)) { 
					message = 'Word can only contain letters. No spaces or special characters.';
					valid = false;
				}
			
				// Check if at least one letter is reused
				if (!isFragmentReused(currWord, prevWord)){
					message += '<br>Must reuse at least one letter from the previous word.';
					valid = false;
				}
				
				// Check if the word has been played before
				var pastWords = turnsArray.map(function(obj) {
					return obj.word;
				});
				if (pastWords.indexOf(currWord) > -1) { // if currWord is contained in pastWords 
					message += '<br>' + currWord + ' has already been played.';
					valid = false;
				}
				
				// Check if word is subset of previous word
				else if (prevWord.indexOf(currWord) > -1){ // if currWord is contained in prevWord
					message += '<br>Word cannot be a subset of the previous word.';
					valid = false;
				} 
			
				// Check if word contains the pinned letter
				if (myPinOrBan === 'pin') {
					if (currWord.indexOf(myLetter) === -1){ // if pinned letter is NOT contained in currWord
						message += '<br>Word should contain the pinned letter: ' + myLetter + '.';
						valid = false;
					} 
				}
				
				// Check if word contains the banned letter
				else if (myPinOrBan === 'ban'){
					if (currWord.indexOf(myLetter) > -1){ // if banned letter is contained in currWord
						message += '<br>Word should not contain the banned letter: ' + myLetter + '.';
						valid = false;
					} 
				}
			}
			else { // If no word was entered
				message = 'Enter a word.';
				valid = false;
			}
			
			showMessage ({ // display message
				screen: '#game-screen',
				message: message,
				type:'error'
			});
			
			// If word is invalid, don't validate pin/ ban yet
			if (!valid) {  
				return false; 
			}
			
			
			//*** Validate pin/ ban input***//
		
			// If Pin/ Ban is selected
			if ($(".pin-ban-rdo").is(':checked')) {
				pb = $(".pin-ban-rdo:checked").val();
				
				// Check if letter is entered
				if(l.length === 0) { 
					message = 'You have selected ' + pb + '. Enter a letter from your word to ' + pb +'. ';
					valid = false;
				}
				
				// Check if more than one letter is entered
				else if (l.length > 1) { 
					message = 'Enter only ONE letter to pin/ ban. ';
					valid = false;
				}
				
				// Check if letter exists in current word
				else if (currWord.indexOf(l) === -1) { // if letter does not exist in current word
					message = 'Letter should be in the word ' + currWord + '. ';
					valid = false;
				}
			}
			
			showMessage ({ // display message
				screen: '#game-screen',
				message: message,
				type:'error'
			});

			return valid;
		} // validateResponse ends
	}
	
	
	/**
	 * Processes error messages received from the server
	 * @param - data {processStep: , message: }
	 */	
	function error(data) {
		var screen;
		switch (data.processStep) {
		case 'init':
			screen = '#home';
			break;
		case 'join':
			screen = '#home';
			break;
		case 'start game':
			screen = '#lobby';
			break;
		case 'active game':
			screen = '#game-screen';
			break;
		case 'game over':
			screen = '#game-over';
			break;
		default:
			screen = '';
		}
		showMessage({
			screen: screen,
			message: data.message,
			type: 'error'
		});
	}
	
	
	/**
	 * Display messages in the appropriate screens. 
	 * Error messages have class='error'. Informational messages have class='info'.
	 * @param - data
	 */
	function showMessage(data) {
		$(data.screen + ' .status').append('<span class="' + data.type + '">' + data.message + '</span>');
		$(data.screen + ' .status span').delay(2500).fadeOut(250, function() { 
			$(this).remove(); 
		});
	}
	
	
	/**
	 * 	If game is over display winner, all the words played and scores
	 */	
	function gameOver(data) {
		var text = '';
		var winner = data.winner;
		
		// Display 'game-over' div and hide other divs.
		showScreen('#game-over');
		
		if (winner.length === 1){
			if (winner[0].id === socket.id){
				text = 'Yoohoo! You Win';
			}
			else{
				text = winner[0].name + ' wins';
			}
		}
		else if (winner.length > 1){
			//TODO: Update this logic
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
		$("#game-over h3").text(text + '!');
	}
	
	
	/**
	 * Stop timer
	 */
	function stopTimer() {
		clearTimeout(myTimerId);
		$("#timer").text('1:00');
		console.log('Timer stopped', myTimerId);
	}
	
	/**
	 * 	Start timer
	 */	
	function startTimer( elemId, time, callback) {
		function countdown() {
			if (time > 0) { // Timer is running
				time--;
				$(elemId).text('0:' + time);
			}
			else { // Timer expired
				
				//stopTimer(); //TODO: Do this here to avoid delay from server??
				
				console.log('Time is up', myTimerId);
				callback(); // Do the callback
			} 
		}
		
		myTimerId = setInterval(countdown, 1000); // Set a timer with 1s interval. Call countdown at every tick.		
		console.log('Timer started', myTimerId);
	}
	
	
	/**
	 * Passes current player's turn as timer expired. Sends data for passed turn to server.
	 */
	function passTurn(playerId) {
		//makeInactivePlayer(); // TODO: Disable UI here to avoid delay from server??
		
		// Send passed turn data to server
		resetGameUI(); //reset elements on game screen 
		$('#word-input').val('-'); // Set word as '-' for passed turn
		
		if (playerId == socket.id) { //If active turn
			showMessage({ 			// Display message
				screen: '#game-screen',
				message: 'Time is up! ',
				type: 'error'
			});
			console.log ('Timer expired. Sending blank word to server.');
			sendPlayerResponse(); 	// Send blank word
		}
	}
	
	
	/**
	 * Enables form elements. Applies color formatting.
	 * @param pinBanLeft
	 */
	function makeActivePlayer(pinBanLeft) {
		//Enable form elements
		$('#word-input').prop('disabled',false);
		$('#submit-btn').prop('disabled',false);
		$('.pin-ban-rdo').prop('disabled',false);
		//TODO: # of pins/ bans left
		if (pinBanLeft === 0) { // disable radio button if no more pin/ ban left
			$('.pin-ban-rdo').prop('disabled',true);
		}
		
		// Apply color formatting
		$('#word').addClass('reused'); // Make word blue for active player
		$('#pin').addClass('pin');
		$('#ban').addClass('ban');
		
		// Show message
		showMessage({
			screen: '#game-screen',
			message: 'Your turn. ',
			type: 'info'
		});
		$('#word-input').prop('placeholder', 'Enter your word');
	}
	
	
	/**
	 * Disable form elements. Removes color formatting.
	 * @param
	 */

	function makeInactivePlayer() {
		// Disable form elements
		$('#word-input').prop('disabled',true);
		$('#submit-btn').prop('disabled',true);
		$('.pin-ban-rdo').prop('disabled',true);
		
		// Remove color formatting
		$('#word').removeClass('reused'); // Make word black for inactive player
		$('#pin').removeClass('pin');
		$('#ban').removeClass('ban');
		
		// Display prompt
//		$('#word-input').prop('placeholder', nextPlayerName + "'s turn.");
	}
	
	
	function resetGameUI() {
		// Reset form elements
		$('#word-input').val('');
		$('#letter-input').val('');
		$('#letter-input').prop('disabled', true);
		$('.pin-ban-rdo').prop('checked', false); 
		$('.pin-ban-rdo').removeClass('uncheck'); // reset check/ uncheck toggle
	}
	
	
	/**
	 * Hide other divs and show the specified divs.
	 * @param divID ID of div to show 
	 */
	function showScreen(divId) {
		$('.scene').hide();
		$(divId).show();
	}

	/**
	 * Initializes the score board. Populates header with player names.
	 * @param: tableID
	 */
	function initScoreBoard(tableId) {
		// Populate table header
		$(tableId + ' THEAD TR TH').remove(); // clear table header
		$(tableId + ' THEAD TR').append('<th>Words</th>');
		for (var i=0; i<playersArray.length; i++) { 
			$(tableId + ' THEAD TR').append( // Add player names
					'<th class="' + playersArray[i].id + '">' + playersArray[i].name + '</th>');	
		}
		$(tableId + ' TBODY TR').remove(); // clear table body
	}
	
	
	/**
	* Displays the words, scores etc as a matrix
	* @param: numRows - (optional) number of rows to display. By default all rows are displayed.
	* Otherwise the specified number of rows starting from the most recent are displayed.
	*/
	function updateScoreBoard(id, tableId) {	
		var html,
			formattedWord,
			i,
			numCols = $(tableId + ' THEAD TR TH').length; // # of columns in header


		// Create html for new row containing word and score
		html = 	'<tr><td>';
		
		// populate word
		formattedWord = turnsArray[turnsArray.length-1].blueWord;
		if (turnsArray.length >= 2) {
			if (turnsArray[turnsArray.length-1].word === turnsArray[turnsArray.length-2].word) { // if player passed turn
				formattedWord = '<i>(pass)</i>'; // enter '-' instead of word
			}
		}
		else { // if this is the initial word from server
//			formattedWord = '<i>' + formattedWord + '</i>';
		}
		html += formattedWord + '</td>';

		// populate score
		for (i=0; i < numCols - 1; i++) { // use # columns in header as reference
			//html += '<td class="' + playersArray[i].id + '">';
			html += '<td>';
			if (!id) { // if this is the initial word from server
				html += '-';
			}
			else {
				if (!playersArray[i]) { // if player has left the game
					html += '<i>---</i>'; //enter '---' instead of score
				}
				else { // if player is still in the game
					if (id == playersArray[i].id) { // if player's turn
						html += turnsArray[turnsArray.length-1].score; 
					}
					else { // if not player's turn
						html += ''; // enter blank if not player's turn
					}
				}
			}
			html += '</td>';
		}
		html += '</tr>';
		$(tableId + ' TBODY').append(html);

		
		//*** Display total scores ***//
		$(tableId + ' .total').remove(); // remove existing total row
		
		// Create html for new row containing total scores
		html = '<tr class="total">' +
	 				'<td>TOTAL</td>';
		for (i=0; i < numCols - 1; i++) { // use number of columns in header as reference
			html += '<td>';
			if (!playersArray[i]) { // if player left the game
				html += '<i>---</i>';
			}
			else { // if player is still in the game
				html +=(playersArray[i].totalScore ? playersArray[i].totalScore : 0 ); // convert undefined to 0
			}
			html += '</td>';
		}
		html += '</tr>';
		$(tableId + ' TBODY').append(html);
	}
	
	
	/**
	 * 
	 */
	function truncateScoreBoard(tableId, maxRows) {
		var numRows = $(tableId + ' TBODY TR').length;
		if (numRows > maxRows) { // if number of rows in table body
			for (var i=1; i <= numRows - maxRows; i++) {
				$(tableId + ' TBODY TR:first').remove(); // remove first 
			}
		}
	}
	
	
	/**
	 * Displays word and other information for the current turn
	 * @param data - data received from server
	 */
	function displayNewTurn(data) {
		var formattedWord;
		var pinBanLeft;
		
		resetGameUI(); // Reset elements on game screen
		
		// Apply green/ red color to pinned/ banned letter
		if (myPinOrBan === ''){
			formattedWord = data.currWord; // no formatting
		}
//		else if (myPinOrBan === 'pin'){
		else {
//			formattedWord =  data.currWord.replace(myLetter, '<span class="pin">' + myLetter + '</span>'); 
			formattedWord =  data.currWord.replace(new RegExp(myLetter,'g'), '<span class="'+ myPinOrBan +'">' + myLetter + '</span>');
		}
//		else if (myPinOrBan === 'ban'){
////			formattedWord =  data.currWord.replace(myLetter, '<span class="ban">' + myLetter + '</span>');
//			formattedWord =  data.currWord.replace(new RegExp(myLetter,'g'), '<span class="ban">' + myLetter + '</span>');
//		}
		$('#word').html(formattedWord); // Display the formatted word
		
		showScreen('#game-screen'); // make game screen visible
		fitWord(); // Fit word to screen size. This has to be done AFTER game-screen is visible
		
		if (data.id == socket.id) {
			$('#pin-ban-left').text('(' + data.currPinBanLeft + ' left)');
		}
	}
	
	
	/**
	 * Get data for the current turn from the server
	 * @param data
	 */
	function getNewTurnData(data) {
		//Get data from the server and store in client memory
		turnsArray.push({
			word: data.currWord,
			//TODO: change to formattedWord
			blueWord:  data.currWord.replace(data.reusedFragment, // Apply blue color to re-used fragment
							'<span class="reused">' + 
							data.reusedFragment + '</span>'),
			id: data.id,
			playerName: data.playerName,
			score: data.currScore
		});
		for (var i=0; i<playersArray.length; i++) {
			if (playersArray[i] && playersArray[i].id == data.id) {
				playersArray[i].totalScore = data.totalScore;
			}
		}
		myPinOrBan = data.pinOrBan;
		myLetter = data.letter; 
	}


	function fitWord() {
		textFit($('#word'),
			{
				alignHoriz:true,
				alignVert:false,
				widthOnly:true,
				reProcess:true,
				maxFontSize:64
			}
		);
	}

	
	/**
	 * Handles player leaving the game.
	 * Removes player data from array.
	 * Notifies other players
	 */
	function playerLeftRoom(data) {
		// Remove player from playersArray
		for (var i=0; i<playersArray.length; i++) {
			if (playersArray[i] && playersArray[i].id == data.id) {
				delete playersArray[i]; // deletes value, but does not index
				break;
			}
		}

		//if ($('#lobby').is(":visible")) { // Do this only if lobby is visible
			updatePlayerList(); // Remove name from player list in lobby screen
			checkStartStatus(); // Enable/ disable Start button in lobby screen
		//} 
		
		if (socket.id !== data.id) { // Display message to other players
			showMessage({
				screen: '', // show on any screen - lobby, game-screen or game-over
				type: 'error',
				message: data.name + ' left. ',
				});
		}
	}
	
	
	
	// -------------------------------------------------------
	// UI Code 
	// -------------------------------------------------------
	$('#create-btn').on('click', createGame);
	$('#join-btn').on('click', joinGame);
	$("#submit-btn").on('click', function (data) {
		sendPlayerResponse(data);
	});
	$('#start-btn').on('click', function() {
		socket.emit('startGame', myRoomId);	
	});
	
	$('#home-btn, #back-btn').on('click', function() {
		// Show confirm dialog 
		if(confirm('Leave Game # ' + myRoomId + '?')) {
		    //Ok button pressed
			$('#room-input').val('');
			showScreen('#home');
			socket.emit('leaveGame');
		}
	});
	
	$('#play-again-btn').on('click', function() {
		showScreen('#lobby');
	});

	$('#how-to-play-btn').on('click',function(e){
		e.preventDefault();
		showScreen("#help");
	});

	$('#close-btn').on('click',function(e){
		e.preventDefault();
		showScreen("#home");
	});
	
	$('#name-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	var value = $('#room-input').val();
	    	if (value.length <= 0) {
	    		//createGame();
	    	}
	    	else {
	    		joinGame();
	    	}
	    }
	});
	
	$('#room-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	joinGame();
	    }
	});
	
	$('#word-input, #letter-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	sendPlayerResponse();
	    }
	});
	
	
	/**
	 * 	On Pin Ban radio button click
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
		
		// Enable text box only if pin or ban is checked	
		if ($('.pin-ban-rdo').is(':checked')) {
			$('#letter-input').prop('disabled', false);
		}
		else{
			$('#letter-input').prop('disabled', true);
		}
	});
	
	document.addEventListener("touchstart", function(){}, true);

	$(window).on('load resize',function() {
		if($("#game-screen").is(":visible")) {
			fitWord();
		}
	});

	
	$('.ghost-button').on("touchstart", function () {
		var isDisabled = $(this).prop('disabled');		
		if(isDisabled) {
			return false;
		}
		$(this).addClass("active");	
	});

	$('.ghost-button').on("touchend", function () {
		var isDisabled = $(this).prop('disabled');
		if(isDisabled) {
			return false;
		}
		$(this).removeClass("active");	
	});

	$('#room-input').on('input paste propertychange', function () {
		var value = $('#room-input').val();
		if(value.length <= 0) {
			$('#join-btn').prop('disabled',true); // Disable if no game ID is entered
			return;
		}
		$('#join-btn').prop('disabled',false);
	});
	
	
	//Event handlers	
	socket.on('playerJoinedRoom', playerJoinedRoom );
	socket.on('newWord', function(data) {
		console.log('next player: ', data.nextPlayerId, data.nextPlayerName);
		
		getNewTurnData(data);
		
		if (data.id == undefined) { // if first turn
			initScoreBoard('#score-board'); 
			$('#pin-ban-left').text('(' + data.currPinBanLeft + ' left)');
		}
		updateScoreBoard (data.id,'#score-board'); 
		$('#recent-words').html($('#score-board').html()); // copy score board
		truncateScoreBoard('#recent-words', 4); //truncate table to show only 4 rows (3 words + TOTAL row)
		displayNewTurn(data);
		
		if (data.nextPlayerId === socket.id) { // If next player
			makeActivePlayer(data.nextPinBanLeft); // Enable UI
		}
		else { // If not next player
			//makeInactivePlayer(); // Disable UI
			$('#word-input').prop('placeholder', data.nextPlayerName + "'s turn."); // show prompt
		}

		startTimer('#timer', MAX_TIME, function() {
			passTurn(data.nextPlayerId); // Execute callback at the end of 60 seconds
		});
	});
	
	socket.on('responseAccepted', function() {
		stopTimer();
		makeInactivePlayer();
	});
	
	socket.on('activateNextPlayer', function(data) { 
		stopTimer();
		console.log('next player: #2 ', data.nextPlayerId, data.nextPlayerName);
		
		if (data.nextPlayerId === socket.id) { // If next player
			makeActivePlayer(data.nextPinBanLeft); // Enable UI
		}
		else { // If not next player
			//makeInactivePlayer(); // Disable UI
			$('#word-input').prop('placeholder', data.nextPlayerName + "'s turn."); // show prompt
		}
	
		startTimer('#timer', MAX_TIME, function() {
			passTurn(data.nextPlayerId); // Execute callback at the end of 60 seconds
		});
	});
	
	
	socket.on('playerLeftRoom', playerLeftRoom );
	
	socket.on('gameOver', function(data) {
		getNewTurnData(data);

		updateScoreBoard (data.id,'#score-board');
		gameOver(data);
	});
	
	socket.on('error', error);
	
};

// Initial call
new App();
