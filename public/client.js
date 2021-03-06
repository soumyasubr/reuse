var App = function() {
	'use strict';
	var socket = io.connect(),
		myName, 		 // player name
		myRoomId, 		 // player room
		myTimerId, 		 // timer handler
		playersArray,	 // array with player id and name
		turnsArray = []; // array with data for each turn

	//Display home page
	showScreen('#home');
	
	
	/**
	 * Hide other divs and show the specified divs.
	 * @param divID - ID of div to be shown 
	 */
	function showScreen(divId) {
		$('.scene').hide();
		$(divId).show();
	}
	
	
	/**
	 * Requests server to create a new game for specified number of players.
	 */
	function createGame() {
		var name = $('#name-input').val().trim() || 'Anonymous';
		if (!/^[A-Za-z0-9 ]+$/.test(name)) { // Name cannot contain special characters
			showMessage({
				message: 'Name cannot contain special characters.',
				type: 'error',
				screen: '#home'
			});
			return;
		}
		myName = name; // Store name on client
	    socket.emit('createNewGame',{
				playerName: myName,
				numPlayers: $('#numPlayers-input').val()
	    });
	}
	    
	
	/**
	 * Requests server to join the specified game.
	 */
	function joinGame() {
		var name = $('#name-input').val().trim() || 'Anonymous';
		if (!/^[A-Za-z0-9 ]+$/.test(name)) { // Name cannot contain special characters
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
	 * Updates lobby as players join the game.
	 * @param {Object} data
	 * @param {String} data.playerName
	 * @param {Number} data.roomId
	 * @param {Array} data.playersArray
	 */
	function playerJoinedRoom(data) {
		myRoomId = data.roomId;
		playersArray = data.playersArray;
		
		if (playersArray.length === 1) { // If this is the host (first person to join room)
			$('#lobby h3').html('Hello, ' + playersArray[0].name + 
								'!<br>Invite your friends to a game.<br>' +
								'Game ID: ' + myRoomId + '.');
		}
		else { // If this is not host
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
	 * Get data for the current turn from the server and update client.
	 * @param {Object} data
	 * @param {String} data.id
	 * @param {String} data.currWord
	 * @param {String} data.reusedFragment
	 * @param {String} data.pinOrBan
	 * @param {String} data.letter
	 * @param {String} data.playerName
	 * @param {Number} data.currScore
	 * @param {Number} data.totalScore
	 */
	function getNewTurnData(data) {
		try {
			//Get data from the server and store in client memory
			turnsArray.push({
				word: data.currWord,
				formattedWord:  data.currWord.replace(data.reusedFragment, // Apply blue color to re-used fragment
								'<span class="reused">' + 
								data.reusedFragment + '</span>'),
				id: data.id,
				playerName: data.playerName,
				score: data.currScore,
				pinOrBan: data.pinOrBan,
				letter: data.letter
			});
			for (var i=0; i<playersArray.length; i++) {
				if (playersArray[i] && playersArray[i].id == data.id) {
					playersArray[i].totalScore = data.totalScore;
				}
			}
		}
		catch(err){}
	}
	
	
	/**
	 * Prepare game screen for new turn - updates word and other information.
	 * @param {Object} data
	 * @param {String} data.id - ID of player that just played
	 * @param {String} data.currWord - word for next player
	 * @param {String} data.nextPlayerId - ID of next player
	 * @param {String} data.nextPlayerName - name of next player
	 * @param {Number} data.nextPinBanLeft - number of pin/ ban left for next player
	 * @param {Number} data.currPinBanLeft - number of pin/ ban left for current player
	 * @param {String} data.pinOrBan - pin or ban assigned to next player
	 * @param {String} data.letter - letter to pin or ban for next player
	 */
	function updateUI(data) {
		var formattedWord;
		
		resetGameUI(); // Reset elements on game screen
		showScreen('#game-screen'); // make game screen visible
		
		// Display word
		if (data.pinOrBan === 'pin' || data.pinOrBan === 'ban'){
		formattedWord =   data.currWord.replace(new RegExp(data.letter,'g'), '<span class="'+ data.pinOrBan +'">' + data.letter + '</span>'); // Apply green/ red color to pinned/ banned letter
	}
		else {
			formattedWord =  data.currWord; // no formatting
		}
		$('#word').html(formattedWord);
		fitWord(); // Fit word to screen size. This has to be done AFTER game-screen is visible
		
		// Update pin/ ban left
		if (data.id == undefined) { // if first round (i.e. word was not generated by another client) 
			$('#pin-ban-left').text('(' + data.currPinBanLeft + ' left)'); //update number of pins/ bans available for all players
			initScoreBoard('#score-board'); // create score board structure. populate player names.
		}
		else if (data.id == socket.id) {
			$('#pin-ban-left').text('(' + data.currPinBanLeft + ' left)'); //update number of pins/ bans only for previous player
		}
		
		//Update word list + scores
		updateScoreBoard (data.id,'#score-board'); // add the last word received to the score board
		$('#recent-words').html($('#score-board').html()); // create a copy of score board to show at the bottom of game screen
		truncateScoreBoard('#recent-words', 4); //truncate recent words table to show only 4 rows (3 words + TOTAL row)
	}
	
	
	/**
	 * Activate next player and publish next player's name to other players.
	 * @param {Object} data
	 * @param {String} data.nextPlayerId
	 * @param {String} data.nextPlayerName
	 * @param {Number} data.nextPinBanLeft
	 */
	function activateNextPlayer(data) {
		if (data.nextPlayerId != socket.id) {
			$('#word-input').prop('placeholder', data.nextPlayerName + "'s turn."); // show prompt
		}
		// Enable UI for next player
		else {
			makeActivePlayer(data.nextPinBanLeft); // Enable UI
		}
	}
	
	
	/**
	 * Start timer for specified duration (seconds) 
	 * and execute callback once timer has expired.
	 * @param {String} elemId
	 * @param {Number} time - timer duration in seconds
	 * @param {Function} callback - function to be executed at the end of the specified time
	 */	
	function startTimer( elemId, time, callback) {
		function countdown() {
			if (time > 0) { // Timer is running
				time--;
				$(elemId).text('0:' + time);
			}
			else { // Timer expired
				callback(); 
			} 
		}
		
		myTimerId = setInterval(countdown, 1000); // Set a timer with 1s interval. Call countdown at every tick.		
	}
	
	
	/**
	 * Stops and resets timer.
	 */
	function stopTimer() {
		clearTimeout(myTimerId);
		$("#timer").text('1:00');
	}
	
	
	/**
	 * Sends player's response (word + other info) to the server.
	 */
	function sendPlayerResponse() {
		var prevWord = turnsArray[turnsArray.length - 1].word; // word from previous turn
		
		// Current turn data
		var currWord = $('#word-input').val().toUpperCase().trim(),
		 	pb = '', // pin or ban for next player
		    l = $("#letter-input").val().toUpperCase().trim(), // letter to pin or ban for next player
		    myPinOrBan = turnsArray[turnsArray.length - 1].pinOrBan,
		    myLetter = turnsArray[turnsArray.length - 1].letter;
		
		// If user input is valid, request server to validate against dictionary and prepare next turn
		if (validateResponse()) {
			socket.emit('nextTurn', {
					currWord: currWord,
					prevWord: prevWord,
					pinOrBan: myPinOrBan,
					letter: myLetter,
					nextPinOrBan: pb,
					nextLetter: l
			});
		}
		

			/** 
			 * Validates the input word; If word is valid, then pin ban input is validated. 
			 * (within scope of sendPlayerResponse)
			 * @returns {Boolean}
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
			} // validateResponse() ends
	}

	

	/**
	 * Removes player from current game.
	 */
	function leaveGame() {
		if(confirm('Leave Game # ' + myRoomId + '?')) { // Show confirm dialog 
			playersArray = [];
			turnsArray = [];
			$('#room-input').val('');	
			showScreen('#home');
			socket.emit('leaveGame');
		}
	}

	
	/**
	 * Handles player leaving the game.
	 * Removes player data from array.
	 * Notifies other players
	 * @param {Object} data
	 * @param {String} data.id
	 * @param {String} data.gameState
	 * @param {String} data.name
	 */
	function playerLeftRoom(data) {
		// Remove player from playersArray
		for (var i=0; i<playersArray.length; i++) {
			if (playersArray[i] && playersArray[i].id == data.id) {
				if (data.gameState === 'waiting') {
					playersArray.splice(i,1); //deletes values and modifies index
				}
				else {
					delete playersArray[i]; // deletes value, but does not modify index
				}
				break;
			}
		}

		updatePlayerList(); // Remove name from player list in lobby screen
		checkStartStatus(); // Enable/ disable Start button in lobby screen
		
		if (socket.id !== data.id) { // Display message to other players
			showMessage({
				screen: '', // show on any screen - lobby, game-screen or game-over
				type: 'error',
				message: data.name + ' left. ',
				});
		}
	}
	
	
	/**
	 * Display winner(s).
	 * @param {Array} data.winner
	 *
	 */	
	function showWinner(winner) {
		var text = '';
		
		showScreen('#game-over'); // Display 'game-over' div and hide other divs.

		if (winner) {
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
		}
		else { // all others quit.. win by default
			text = 'Ending game..';
		}
		$("#game-over h3").text(text + '!');
	}


	/**
	 * Passes current player's turn and sends empty word to server.
	 * @param {String} playerId
	 */
	function passTurn(playerId) {
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
	 * Initializes the score board - populates header with player names.
	 * @param {String} tableID
	 */
	function initScoreBoard(tableId) {
		$(tableId + ' THEAD TR TH').remove(); // clear table header
		$(tableId + ' THEAD TR').append('<th>Words</th>');
		for (var i=0; i<playersArray.length; i++) { 
			$(tableId + ' THEAD TR').append( // Add player names
					'<th class="' + playersArray[i].id + '">' + playersArray[i].name + '</th>');	
		}
		$(tableId + ' TBODY TR').remove(); // clear table body
	}
	
	
	/**
	* Populate score board with word and score for the last turn.
	* @param {String} id
	* @param {String} tableId
	*/
	function updateScoreBoard(id, tableId) {	
		var html,
			formattedWord,
			numCols = $(tableId + ' THEAD TR TH').length, // # of columns in header
			numTurns = turnsArray.length;

		// Create html for new row containing word and current score
		html = 	'<tr><td>';
		
		// populate word
		formattedWord = turnsArray[numTurns-1].formattedWord;
		if (numTurns >= 2) { // if this is not the first turn
			if (turnsArray[numTurns-1].word === turnsArray[numTurns-2].word) { // if player passed turn
				formattedWord = '<i>(pass)</i>'; // enter '-' instead of word
			}
		}
		html += formattedWord + '</td>';

		// populate score
		for (var i=0; i < numCols - 1; i++) { // use # columns in header as reference
			html += '<td>';
			if (!id) { // if this is the initial word from server
				html += '-'; // no score
			}
			else {
				if (!playersArray[i]) { // if player has left the game
					html += '---'; //enter '---' instead of current score
				}
				else { // if player is still in the game
					if (id == playersArray[i].id) { // if player's turn
						html += turnsArray[numTurns-1].score; 
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

		
		updateTotalScore(tableId)  // Display total scores
	}
	
	
	/**
	 * Update total score in scoreboard.
	 * @param {String} tableId
	 */
	function updateTotalScore(tableId) {
		var html;
		var numCols = $(tableId + ' THEAD TR TH').length; // # of columns in header

		$(tableId + ' .total').remove(); // remove existing total row
		
		// Create html for new row containing total scores
		html = '<tr class="total">' +
	 				'<td>TOTAL</td>';
		for (var i=0; i < numCols - 1; i++) { // use number of columns in header as reference
			html += '<td>';
			if (!playersArray[i]) { // if player left the game
				html += '---';
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
	 * Truncates table by removing rows from the top
	 * to show only the specified number of rows.
	 * @param {String} tableId
	 * @param {Number} maxRows
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
	 * Enables form elements. Applies color formatting.
	 * @param {Number} pinBanLeft
	 */
	function makeActivePlayer(pinBanLeft) {
		//Enable form elements
		$('#word-input').prop('disabled',false);
		$('#submit-btn').prop('disabled',false);
		$('.pin-ban-rdo').prop('disabled',false);
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
	 * Disable form elements and removes color formatting.
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
	}

	
	/**
	 * Display messages in the appropriate screens. 
	 * Error messages have class='error'. Informational messages have class='info'.
	 * @param {Object} data
	 * @param {String} data.screen
	 * @param {String} data.type
	 * @param {String} data.message
	 */
	function showMessage(data) {
		$(data.screen + ' .status').append('<span class="' + data.type + '">' + data.message + '</span>');
		$(data.screen + ' .status span').delay(2500).fadeOut(250, function() { 
			$(this).remove(); 
		});
	}
	
	
	/**
	 * Processes error messages received from the server
	 * @param {Object} data 
	 * @param {String} data.processStep
	 * @param {String} data.message
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
	 * Updates the list of players in room
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
	 * Enables Start button if at least 2 players are in the room 
	 * and disables it otherwise.
	 */
	function checkStartStatus() {
		var count = 0;
		for (var i=0; i<playersArray.length; i++) {
			if (playersArray[i]) {
				count++;
			}
		}
		if (count >= 2) { // If at least 2 players are in the room
			$('#start-btn').prop('disabled', false); // Enable start button
		}
		else {
			$('#start-btn').prop('disabled', true); // Disable start button
		}
	}
	

	/**
	 * Adjusts font size to fit window
	 */
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
	 * Resets form elements.
	 */
	function resetGameUI() {
		$('#word-input').val('');
		$('#letter-input').val('');
		$('#letter-input').prop('disabled', true);
		$('.pin-ban-rdo').prop('checked', false); 
		$('.pin-ban-rdo').removeClass('uncheck'); // reset check/ uncheck toggle
	}
	
	
	/** 
	 * Checks if at least one letter is reused between the 2 strings
	 * @param {String} string1
	 * @param {String} string2
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
	
	
	// ---------------------------------------------------------//
	// UI Event Handlers										//
	// ---------------------------------------------------------//
	
	$('#create-btn').on('click', createGame);
	
	$('#join-btn').on('click', joinGame);
	
	$("#submit-btn").on('click', sendPlayerResponse);
	
	$('#start-btn').on('click', function() { socket.emit('startGame');});
	
	$('#home-btn, #back-btn').on('click', leaveGame);

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
	    	if (value.length > 0) {
	    		joinGame();
	    	}
	    }
	});
	
	$('#room-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	joinGame();
	    }
	});
	
	$('#room-input').on('input paste propertychange', function () {
		var value = $('#room-input').val();
		if(value.length <= 0) {
			$('#join-btn').prop('disabled',true);
			return;
		}
		$('#join-btn').prop('disabled',false);
	});
	
	$('#word-input, #letter-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	sendPlayerResponse();
	    }
	});
	
	$('.pin-ban-rdo').click(function() {
		// Toggle check and uncheck
		if ($(this).hasClass('uncheck')){
			$(this).prop('checked', false);
			$('.pin-ban-rdo').removeClass('uncheck');
		}
		else{ // if not previously checked
			$('.pin-ban-rdo').removeClass('uncheck');
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

	$(window).on('load resize',function() {
		if($("#game-screen").is(":visible")) {
			fitWord();
		}
	});

	document.addEventListener("touchstart", function(){}, true);
	
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
	
	// ---------------------------------------------------------//
	// Socket Event Handlers									//
	// ---------------------------------------------------------//
	
	socket.on('playerJoinedRoom', playerJoinedRoom );
	socket.on('newWord', function(data) {
		getNewTurnData(data); // Update client side data store
		updateUI(data); // Update UI for the next turn
		activateNextPlayer(data);
		startTimer('#timer', 60, function() {
			passTurn(data.nextPlayerId); // Execute this at the end of 60 seconds
		});

	});
	
	socket.on('responseAccepted', function() {
		stopTimer();
		makeInactivePlayer();
	});
	
	socket.on('activateNextPlayer', function(data) { 
		stopTimer();	
		activateNextPlayer(data);	
		startTimer('#timer', 60, function() {
			passTurn(data.nextPlayerId); // Execute callback at the end of 60 seconds
		});
	});
	
	socket.on('playerLeftRoom', playerLeftRoom );
	
	socket.on('gameOver', function(data) {
		stopTimer();
		makeInactivePlayer();
		if (!data.skipTurnProcessing) {
			getNewTurnData(data);
			updateScoreBoard (data.id,'#score-board');
		}
		updateTotalScore('#score-board');
		showWinner(data.winner);

	});
	
	socket.on('error', error);
	
};

// Initial call
new App();