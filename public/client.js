var App = function() {
	'use strict';
	var socket = io.connect();
	var	myName, // player name
		myRoomId, // player room
		myPinOrBan, // pin or ban challenge for current turn
		myLetter, 	// letter pinned or banned for current turn
		myTimerId, // timer handler
		turnsArray = [], // array with data for each turn
		totalScoresArray = [], //array with total scores for each player
		playersArray;
	//TODO: change to players array with name and total scores
	//TODO: Avoid sending player name from server as it is available in playersArray.
	

	//Display the landing page with Create and Join buttons
	showScreen('#home');
	// showScreen('#game-screen');
	// showScreen('#game-over');

	/**
	 * Requests server to create a new game
	 */
	function createGame() {
		// Store name on client
		myName = $('#name-input').val() || 'Anonymous';
	    socket.emit('createNewGame',myName);
	}
	    
	
	/**
	 * Requests server to join the specified game
	 */
	function joinGame() {
		// Store name on client
		myName = $('#name-input').val() || 'Anonymous';
	    var data = {
		    	playerName: myName, 
				roomId: $('#room-input').val()
	    };	    
	    socket.emit('joinExistingGame', data);
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
					message: data.playerName + ' joined',
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
			$('#players-list TBODY').append('<tr><td>' + playersArray[i].name + '</td></tr>');	
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
	 * Validates the input word. If word is valid, then pin ban input is validated. 
	 * If word and pin/ ban are valid, request is sent to server to validate against dictionary.
	 */	
	function validateResponse() {
		var currWord = $('#word-input').val().toUpperCase().trim();
		var prevWord = $("#word").text();
		var valid = true;
		var message = '';
		
		// Check if a word has been entered
		if(currWord.length === 0) {
			message = 'Enter a word.';
			valid = false;
		}
		
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
		
//		error({message: message});
		showMessage ({ // display message
			screen: '#game-screen',
			message: message,
			type:'error'
		});
		
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
				message = 'You have selected ' + pb + '. Enter a letter from your word to ' + pb;
				valid = false;
			}
			
			// Check if more than one letter is entered
			else if (l.length > 1) { 
				message = 'Enter only ONE letter to pin/ ban';
				valid = false;
			}
			
			// Check if letter exists in current word
			else if (currWord.indexOf(l) === -1) { // if letter does not exist in current word
				message = 'Letter should be in the word ' + currWord;
				valid = false;
			}
		}
		
		
		else { // If Pin/ Ban not selected
			pb = '';
			l = '';
		}
		
		showMessage ({ // display message
			screen: '#game-screen',
			message: message,
			type:'error'
		});
		
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
			console.log('Request server for to validate', data);
		}
		return false;
	}
	
	
	/**
	 * Processes error messages received from the server
	 * @param - data
	 */	
	function error(data) {
		//$("#home .status span").remove();
//		$("#home .status").append("<span class='error'>" + err.message + "</span>");
//		$("#home .status span").delay(2500).fadeOut(250, function() { 
//			$(this).remove(); 
//		});
		
//		$(".status").append("<span class='error'>" + err.message + "</span>");
//		$(".status span").delay(2500).fadeOut(250, function() { 
//			$(this).remove(); 
//		});
		
		//TODO: Display only in current div
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
		default:
			screen = '';
		}
		showMessage({
			screen: screen,
			message: data.message,
			type: 'error'
		});
	}
	
	
	//TODO: create function to display messages.. red if error, grey if info.
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
	function gameOver(winner) {
		var text = '';
		
		// Display 'game-over' div and hide other divs.
		showScreen('#game-over');
	
		//Populate table with all words
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
	
	
	/*	Stop timer
	*/	
	function stopTimer() {
		clearTimeout(myTimerId);
		$("#timer").text('1:00');
		console.log('Timer stopped', myTimerId);
	}
	
	/*	Start timer
	*/	
	function startTimer() {
		var timeLeft = 30;
		function countdown() {
			if (timeLeft === 0) {
				//stopTimer();
				console.log('Time is up');
				showMessage({
					screen: '#game-screen',
					message: 'Time is up!',
					type: 'error'
				});
				socket.emit('passTurn');	
			} 
			else {
				timeLeft--;
				$("#timer").text('0:' + timeLeft);
			}
		}
		myTimerId = setInterval(countdown, 1000);		
		console.log('Timer started', myTimerId);
	}
	
    /**
     * Display the countdown timer on the Host screen
     *
     * @param $el The container element for the countdown timer
     * @param startTime
     * @param callback The function to call when the timer ends.
     */
//	function timer_test( $el, startTime, callback) {
//
//        // Display the starting time on the screen.
//        $el.text(startTime);
//        App.doTextFit('#hostWord');
//
//        // console.log('Starting Countdown...');
//
//        // Start a 1 second timer
//        var timer = setInterval(countItDown,1000);
//
//        // Decrement the displayed timer value on each 'tick'
//        function countItDown(){
//            startTime -= 1
//            $el.text(startTime);
//            App.doTextFit('#hostWord');
//
//            if( startTime <= 0 ){
//                // console.log('Countdown Finished.');
//
//                // Stop the timer and do the callback.
//                clearInterval(timer);
//                callback();
//                return;
//            }
//        }
//
//    } 
	/** test end*/
	
	
	function makeActivePlayer(pinBanLeft) {
		$('#word-input').prop('placeholder', 'Enter your word');
		$('#word-input').prop('disabled',false);
		$('#submit-btn').prop('disabled',false);
		$('#word').addClass('reused'); //Make word blue for active player
		$('.pin-ban-rdo').prop('disabled',false);
		if (pinBanLeft === 0) {
			$('.pin-ban-rdo').prop('disabled',true);
		}
		showMessage({
			screen: '#game-screen',
			message: 'Your turn',
			type: 'info'
		});
	}
	
	function makeInactivePlayer(nextPlayerName) {
		$('#word-input').prop('placeholder', nextPlayerName + "'s turn.");
		$('#word-input').prop('disabled',true);
		$('#submit-btn').prop('disabled',true);
		$('.pin-ban-rdo').prop('disabled',true);
		$('#word').removeClass('reused'); // Make word black for inactive player
	}
	
	
	
	/*	Activate form elements for current player only, disable for everyone else
	*/	
	function activateNextPlayer(data) {
		// Reset form elements
		$('#word-input').val('');
		$('#letter-input').val('');
		$('#letter-input').prop('disabled', true);
		$('.pin-ban-rdo').prop('checked', false); 
		$('.pin-ban-rdo').removeClass('uncheck'); // reset check/ uncheck toggle
		
		if (data.nextPlayerId === socket.id) { 
			makeActivePlayer(data.nextPinBanLeft); // Enable form elements for next player
			console.log('in activateNextPlayer');
			startTimer(); // Start timer
		}
		else {
			makeInactivePlayer(data.nextPlayerName); // Disable form elements for all other players
			console.log('in activateNextPlayer');
			stopTimer(); // Stop timer
		}
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
	 * Displays word and other information for the current turn
	 * @param data - data received from server
	 */
	function displayNewWord(data) {
		var formattedWord;
		
		//Show only game screen
		showScreen('#game-screen');
		
		// Activate next player
		activateNextPlayer(data);
		
		// Apply green/ red color to pinned/ banned letter
		if (myPinOrBan === ''){
			formattedWord = data.currWord; // no formatting
		}
		else if (myPinOrBan === 'pin'){
			formattedWord =  data.currWord.replace(myLetter, '<span class="pin">' + myLetter + '</span>'); 
		}
		else if (myPinOrBan === 'ban'){
			formattedWord =  data.currWord.replace(myLetter, '<span class="ban">' + myLetter + '</span>');
		}
		$('#word').html(formattedWord);
		fitWord();
		
		showWordList('#word-list',3); //populate table with last 3 words
	}
	
	
	/**
	 * Get data for the current turn from the server
	 * @param data
	 */
	function getNewWordData(data) {
		//Get data from the server and store in client memory
		turnsArray.push({
			word: data.currWord,
			blueWord:  data.currWord.replace(data.reusedFragment, // Apply blue color to re-used fragment
							'<span class="reused">' + 
							data.reusedFragment + '</span>'),
			playerID: data.id,
			playerName: data.playerName,
			score: data.currScore
		});
		totalScoresArray[data.id] = data.totalScore;
		//use playersArray instead
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

//	function transition(from, to) {
//
//		console.log("transition - " + from + " -> " + to);
//		
//		$(from).addClass("scale-out");
//		$(to).removeClass("invisible-layer");
//		$(to).addClass("delay scale-up");
//
//		$(from).on("animationend webkitAnimationEnd oAnimationEnd MSAnimationEnd", function () {
//			console.log("animation end " + from);
//			$(from).off("animationend webkitAnimationEnd oAnimationEnd MSAnimationEnd");
//			$(from).addClass("invisible-layer");
//			$(from).removeClass("scale-out current-view");
//		});
//
//		$(to).on("animationend webkitAnimationEnd oAnimationEnd MSAnimationEnd", function () {
//			console.log("animation end: " + to);
//			$(to).off("animationend webkitAnimationEnd oAnimationEnd MSAnimationEnd");
//			$(to).addClass("current-view");
//			$(to).removeClass("delay scale-up");
//		});
//
//	}

//	function addPlayerToView(playerName){
//			var html = "<tr><td>" + playerName + "</td></tr>";
//			var tableBody = $('#players-list TBODY');
//			// var $tableBody = $('#players-list');
//			tableBody.append(html);
//			
//			// $scrollHeight = $tableBody.prop("scrollHeight");
//			// $height = $tableBody.height();
//			// $maxScroll = $scrollHeight - $height;
//
//			// console.log("scrollHeight: " + $scrollHeight + " | height: " + $height + " | maxScroll: " + $maxScroll);
//
//			// $tableBody.scrollTop($maxScroll);
//
//			// $lastRow = $('.tableSection tr:last');
//			// $div = $lastRow.find('td > div');
//			// $div.fadeIn();
//	}


	// -------------------------------------------------------

//	function startGame() {
//			socket.emit('startGame', myRoomId);	
//	}
	
	
	/**
	 * Handles player leaving the game.
	 * Removes player data from array.
	 * Notifies other players
	 */
	function playerLeftRoom(data) {
		// Remove player from playersArray
		for (var i=0; i<playersArray.length; i++) {
			if (playersArray[i].id == data.id) {
				playersArray.splice(i,1);
				break;
			}
		}

		if ($('#lobby').is(":visible")) { // Do this only if lobby is visible
			updatePlayerList(); // Remove name from player list in lobby screen
			checkStartStatus(); // Enable/ disable Start button in lobby screen
		} 
		
		if (socket.id !== data.id) { // Display message to other players
//			error({message: data.name + ' left'}); 
			showMessage({
				screen: '', // show on any screen - lobby, game-screen or game-over
				type: 'error',
				message: data.name + ' left',
				});
		}
	}
	
	
	// -------------------------------------------------------
	// UI Code 
	// -------------------------------------------------------
	$('#create-btn').on('click', createGame);
	$('#join-btn').on('click', joinGame);
	$("#submit-btn").on('click', validateResponse);
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
	
	$('#name-input').keypress(function(e) {
	    if(e.keyCode === 13) {
	    	var value = $('#room-input').val();
	    	if (value.length <= 0) {
	    		createGame();
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
	    	validateResponse();
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
			//$('#letter-input').show();
			$('#letter-input').prop('disabled', false);
		}
		else{
			//$('#letter-input').hide();
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
		// $('h1').text("touchstart");
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
		// $('h1').text(""+value);
		if(value.length <= 0) {
			$('#join-btn').prop('disabled',true);
			return;
		}
		$('#join-btn').prop('disabled',false);

	});
	
	
	//Event handlers	
	socket.on('playerJoinedRoom', playerJoinedRoom );
	socket.on('newWord', function(data) {
			getNewWordData(data);
			displayNewWord(data);
	});
	//socket.on('responseAccepted', stopTimer);
	socket.on('activateNextPlayer', activateNextPlayer);
	socket.on('playerLeftRoom', playerLeftRoom );
	socket.on('gameOver', gameOver);
	socket.on('error', error);
	
};

// Initial call
new App();
