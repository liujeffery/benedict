const { Client, Intents, version} = require("discord.js");
const axios = require("axios");
const ytdl = require("ytdl-core");
const ytpl = require("ytpl");
const fs = require("fs");
const Ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const events = require("events").EventEmitter;
const lyricsFinder = require("lyrics-finder");
const gtts = require("gtts");
const { translate } = require('free-translate');
const ytSearch = require("youtube-search-without-api-key");
const speech = require("@google-cloud/speech");
require("dotenv").config();

const stt = new speech.SpeechClient({projectId : "googleKey", keyFilename: "googleKey.json"});

//global variables for searching on youtube
var ytcounter = 0;
var ytsearch = "";
var ytlink = "";

//global variables for music bot
var servers = {};

//global variable to manage listening and connections
//for values inside array, 0 || null = have not declared state, 1 = listening, 2 = ignoring
var listenOn = [];

//global variable for transcribe function
var emitter = new events();

const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
});

//initializing discord bot
client.once("ready", () => {
    console.log("Logged in " + version);
    client.user.setPresence({activity: {name: "? for commands | ?help"}});
});

//activates when typing ?complete or discord bot disconnects
emitter.on("off", async (message) => {
    const server = servers[message.guild.id];
    if (server.transcribing){
        try{
            await message.channel.send({
                files: [{attachment: "transcript_" + message.guild.id + ".txt"}]
            });
            fs.unlinkSync("transcript_" + message.guild.id + ".txt");
        }
        catch (error){
            message.channel.send("Error sending transcript.");
            console.log(error);
        }
        server.transcribing = false;
    }
});

//function to convert a string to mp3 using google's text-to-speech API
async function texttomp3(text, message) {
    if (checkUserChannelValid(message)){
        if (!servers[message.guild.id]){
            servers[message.guild.id] = {
                queue: [],
                queueString: [],
                currentSong: "",
                connection: "",
                transcribing: false
            };
        }
        const server = servers[message.guild.id];

        if ((!server.dispatcher || (!server.dispatcher._writableState.writing && server.queue.length == 0)) && checkUserChannelValid(message)){
            try{
                const tts = new gtts(text, "en");
                tts.save("output_" + message.guild.id + ".mp3", error => {
                    if (error){
                        message.channel.send("Error converting from text to speech.");
                        console.log(error);
                    }
                });
                message.member.voice.channel.join().then((connection) => {
                    if (!server.connection)
                        setupConnection(connection, message);
                    server.dispatcher = server.connection.play("output_" + message.guild.id + ".mp3");
                    server.dispatcher.setVolume(0.08);

                    //statement runs once mp3 file is finished  
                    //for some reason ffmpeg ends it early, so manual delay of 1 second is set
                    server.dispatcher.streams.ffmpeg.once("end", () => {
                        fs.unlinkSync("output_" + message.guild.id + ".mp3");
                        setTimeout(() => {
                        if (server.queue[0]) {
                            play(server.connection, message);
                        }
                    }, 1000)
                    });
                });
            }
            catch (error){
                message.channel.send("Error playing mp3 file.");
                console.log(error);
            }
        }
    }
    else{
        message.channel.send(text);
    }
}

//dedicated play function for playing music
function play(connection, message) {
    const server = servers[message.guild.id];

    //dispatcher sends voice packet data, connection.play accepts any mp3 file
    //function in ytdl call searches for format with specific itag of 249, only uses that one
    try{
        server.dispatcher = connection.play(ytdl(server.queue[0], {
            filter: "audioonly",
            itag: "250",
            opusEncoded: false,
            fmt: "mp3",
            encoderArgs: ["-af", "bass=g=10,dynaudnorm=f=200"],
            dlChunkSize: 262144
        }), {type: "unknown"});
    }
    catch (error){
        message.channel.send("Error playing music.");
        console.log(error);
    };
    server.dispatcher.setVolume(0.08);
    //shift removes the first element in the array
    message.channel.send("Now playing: **" + server.queueString[0] + "**.");

    server.queue.shift();
    server.currentSong = server.queueString.shift();
    //statement runs once mp3 file is finished  
    //for some reason ffmpeg ends it early, so manual delay of 1 second is set
    try{
        server.dispatcher.streams.ffmpeg.once("end", () => {
            setTimeout(() => {
            if (server.queue[0]) {
                play(connection, message);
            }
            else{
                if (!server.transcribing)
                    message.member.voice.channel.leave();
            }
        }, 1000)
        });
    }
    catch (error){
        message.channel.send("Error playing music.");
        console.log(error);
    }
}

async function findLyrics(tokens, message){
    const server = servers[message.guild.id];
    var search = "";

    if (!tokens[0]){
        if (!server || !server.currentSong){
            message.channel.send("No song is currently playing!");
            return;
        }
        search = server.currentSong;
    }
    else
        search = tokens.join(" ");

    try{
        const response = await lyricsFinder(search, "");
        if (response){
            if (response.length > 1994){
                response = response.substring(0, 1994);
            }
            message.channel.send("```" + response + "```");
        }
        else
            message.channel.send("Could not find lyrics!");
        
    }
    catch (error){
        message.channel.send("Error searching for lyrics.");
        console.log(error);
    }
}

//dedicated function to search for videos on youtube
async function youtubeSearch(search, message){
    try{
        const response = await ytSearch.search(search);
        const video = response[ytcounter];
        ytlink = video.url;
        ytsearch  = search;

        message.channel.send("Title of video is "  + video.title + ". Is this correct? (?y/?n)");
    }
    catch (error){
        message.channel.send("Error searching through youtube");
        console.log(error);
    }
}

function minuteLeft(message) {
    const output = "One minute left!";
    texttomp3(output, message);
}

function timeUp(message) {
    const output = "Time is up!";
    texttomp3(output, message);
}

//checks if sender of message is in a voice channel that is appropriate for bot
function checkUserChannelValid(message){
    var valid = true;
    try{
        if (!message.member.voice.channel) {
            message.channel.send("You must be in a channel to play the bot!");
            valid = false;
        }
        else if (!message.member.voice.channel.joinable){
            message.channel.send("I cannot join that channel!");
            valid = false;
        }
        else if(!message.member.voice.channel.speakable){
            message.channel.send("I cannot speak in that channel!");
            valid = false;
        }
    }
    catch (error){
        valid = false;
        message.channel.send("Error checking permissions on voice channels.");
        console.log(error);
    }
    return valid;
}

//function to listen to users if they type >listen
async function listenStream(connection, message, member) {
    const readableStream = connection.receiver.createStream(member, {mode: "pcm"})
        .on("error", console.error);

    const command = Ffmpeg(readableStream)
        .setFfmpegPath(ffmpegPath)
        .inputOptions([
            "-ar 48000",
            "-ac 2",
            "-f s16le"
        ])
        .audioChannels(1)
        .on("error", (error) => {
            message.channel.send("Error processing speech from Discord.");
            console.log(error);
        })
        .on("end", async () =>{
            if(listenOn[member.id] == 1){
                const request = {
                    config: {
                        encoding: "LINEAR16",
                        sampleRateHertz: 48000,
                        languageCode: "en-US"
                    },
                    audio: {
                        content: fs.readFileSync("ffmpeg_" + member.user.id + ".wav").toString("base64")
                    }
                };

                const [response] = await stt.recognize(request);
                const transcription = response.results
                    .map(result => result.alternatives[0].transcript)
                    .join("\n");
                console.log(member.user.username + ": " + transcription);

                const server = servers[message.guild.id]; 
                const tokens = transcription.trim().split(" ");
                var keyword = tokens.shift().toLowerCase();

                if (keyword == "benedict" && tokens[0]){
                    keyword = tokens.shift().toLowerCase();

                    if (keyword == "complete"){
                        if (!server.transcribing){
                            message.channel.send("Please start transcription first!");
                        }
                        else{
                            emitter.emit("off", message);
                        }
                    }
                    else if (keyword == "disconnect" || keyword == "leave"){
                        try{
                            if(!message.member.voice.channel.members.get("829383202916532314"))
                                message.channel.send("I am not in the voice channel!")
                            else{
                                message.member.voice.channel.leave();
                                message.channel.send("Disconnected from voice channel.");
                            }
                        }
                        catch (error){
                            message.channel.send("Error disconnecting.");
                            console.log(error);
                        }
                    }
                    else if(keyword == "ignore"){
                        if (listenOn[message.member.id] == 2)
                            message.channel.send("Bot is already ignoring you!");
                        else{
                            listenOn[message.member.id] = 2;
                            message.channel.send("Stopped listening to **" + message.member.user.username + "**.");
                        }
                    }
                    else if (keyword == "lyrics"){
                        findLyrics(tokens, message);
                    }
                    else if(keyword == "play"){
                        if (!tokens[0]){
                            message.channel.send("You need a provide a search query!");
                        }
                        else{
                            try{
                                var ytResponse = await ytSearch.search(tokens.join(" "));
                                
                                const link = ytResponse[0].url;
                                const title = ytResponse[0].title;

                                server.queue.push(link);
                                server.queueString.push(title);
                                
                                if (!server.dispatcher || (!server.dispatcher._writableState.writing && server.queue.length == 1)){
                                    message.member.voice.channel.join().then((connection) => {
                                        if (!server.connection)
                                            setupConnection(connection, message);
                                        play(server.connection, message);
                                    });
                                }
                                else{
                                    message.channel.send("Queued **" + server.queueString[server.queueString.length - 1] + "**.");
                                }
                                
                            }
                            catch (error) {
                                message.channel.send("Error trying to play music.");
                                console.log(error);
                            }
                        }
                    }
                    else if (keyword == "q" || keyword == "queue"){
                        if (server.queueString.length == 0){
                            message.channel.send("Queue is empty!");
                        }
                        else{
                            var queue = "```";
                            for (i = 0; i < Math.min(15, server.queueString.length); i = i + 1){
                                queue = queue + (i + 1) + ". " + server.queueString[i] + "\n";
                            }
                            queue = queue + "```";
                            message.channel.send(queue);
                        }
                    }
                    else if (keyword == "remove"){
                        try{
                            if(!tokens[0]){
                                message.channel.send("Please follow the correct format for removing songs from queue!");
                            }
                            else if (tokens[0] == "last"){
                                const [removedSong] = server.queueString.splice(server.queueString.length - 1, 1);
                                server.queue.splice(server.queue.length - 1, 1);
                                message.channel.send("Removed **" + removedSong + "**.");
                            }
                            else if (!tokens[0] || isNaN(parseInt(tokens[0]))){
                                message.channel.send("Please follow the correct format for removing songs from queue!");
                            }
                            else if (tokens[0] <= 0){
                                message.channel.send("Cannot remove song from a position of 0 or less!");
                            }
                            else if (tokens[0] > server.queue.length){
                                message.channel.send("Given index is larger than the length of the queue!");
                            }
                            else{
                                const [removedSong] = server.queueString.splice(tokens[0] - 1, 1);
                                server.queue.splice(tokens[0] - 1, 1);
                    
                                message.channel.send("Removed **" + removedSong + "**.");
                            }
                        }
                        catch (error) {
                            message.channel.send("Error removing song from queue.");
                            console.log(error);
                        }
                    }   
                    else if (keyword == "skip"){
                        if (message.member.voice.channel && message.member.voice.channel.members.get("829383202916532314") && server.dispatcher){
                            try{
                                server.dispatcher.end();
                                message.channel.send("Skipped!");
                            }
                            catch (error){
                                message.channel.send("Error skipping song.");
                                console.log(error);
                            }
                            if(server.queue.length != 0){
                                try{
                                    play(server.connection, message);
                                }
                                catch (error){
                                    message.channel.send("Error playing next song.");
                                    console.log(error);
                                }
                            }
                        }
                        else{
                            message.channel.send("Please start playing something and be in the voice channel before trying to skip!");
                        }
                    }
                    else if (keyword == "transcribe"){
                        if (server.transcribing){
                            message.channel.send("Transcribe is already on!");
                        }
                        else{
                            const date = new Date();
                            const [day, month, year] = [date.getDate(), date.getMonth(), date.getFullYear()];
                            var [hour, minutes, seconds] = [date.getHours(), date.getMinutes(), date.getSeconds()];
                            if (seconds < 10)
                                seconds = "0" + seconds;
                            if (minutes < 10)
                                minutes = "0" + minutes;
                            if (hour < 10)
                                hour = "0" + hour;

                            const fullDate = day + "/" + month + "/" + year + ", " + hour + ":" + minutes + ":" + seconds;

                            try{
                                fs.writeFileSync("transcript_" + message.guild.id + ".txt", "Transcript started at " + fullDate + ".", {flag: "a"});
                            }
                            catch (error){
                                message.channel.send("Error starting transcription.");
                                console.log(error);
                            }
                            try{
                                message.channel.send("Starting transcription.");
                                server.transcribing = true;
                                async function manageListens(value, key){
                                    if (!listenOn[key] && !value.user.bot){
                                        listenOn[key] = 1;
                                        listenStream(connection, message, value);
                                    }
                                }
                                message.member.voice.channel.members.forEach(manageListens);
                            }
                            catch (error){
                                message.channel.send("Error listening to members.");
                                console.log(error);
                            }
                        }
                    }
                    else if (keyword == "weather"){
                        if (!tokens[0]){
                            message.channel.send("Please follow the correct format for weather!");
                        }
                        else{
                            const city = tokens.join(" ");
                            try{
                                axios.get("http://api.openweathermap.org/data/2.5/weather?q=" + city + "&units=metric&appid=" + process.env.WEATHER_TOKEN).then(resp => {
                                    const output = "The temperature is " + resp.data.main.temp + " degrees Celcius, it feels like " + resp.data.main.feels_like + " degrees Celcius, and the weather is "
                                        + resp.data.weather[0].description + ".";
                                    texttomp3(output, message);
                                })
                                .catch ((error) => {
                                    message.channel.send("Error searching for weather.");
                                    console.log(error);
                                });
                            }
                            catch (error){
                                if (error.response.data.message == "city not found"){
                                    message.channel.send("Please input a valid city name!");
                                }
                                else{
                                    message.channel.send("Error searching for weather.");
                                }
                            }
                        }
                    }
                }
                if (server.transcribing){
                    if (transcription != ""){
                        const date = new Date();
                        const memberName = member.user.username;
                        var [hour, minutes, seconds] = [date.getHours(), date.getMinutes(), date.getSeconds()];

                        if (seconds < 10)
                            seconds = "0" + seconds;
                        if (minutes < 10)
                            minutes = "0" + minutes;
                        if (hour < 10)
                            hour = "0" + hour;
                        const timestamp = "(" + hour + ":" + minutes + ":" + seconds + ")";
                        try{
                            fs.writeFileSync("transcript_" + message.guild.id + ".txt", memberName + " " + timestamp + ": " + transcription + "\n", {flag: "a"});

                        }
                        catch (error){
                            message.channel.send("Error writing to transcription file.");
                            console.log(error);
                        }
                    }
                }
                try{
                    fs.unlinkSync("ffmpeg_" + member.user.id + ".wav");
                }
                catch (error){
                    message.channel.send("Error deleting audio file.");
                    console.log(error);
                }
                listenStream(connection, message, member);
            }
        })
        .save("ffmpeg_" + member.user.id + ".wav");
}

//adds emitter event if bot ever disconnects from server
async function setupConnection(connection, message){
    const server = servers[message.guild.id];
    server.connection  = connection;
    server.connection
    .on("disconnect", () => {
        emitter.emit("off", message);
        server.connection = undefined;
        server.queue = [];
        server.queueString = [];
    });
}

//checking any message that is sent
client.on("message", async (message) => {
    const prefix = "?";
    //bot's own messages are ignored
    if (message.author.bot) return;
    //commands must start with correct prefix
    if (!message.content.startsWith(prefix)) return;
    //removes prefix and converts string into tokens
    const tokens = message.content.slice(prefix.length).trim().split(" ");
    const keyword = tokens.shift().toLowerCase();

    //test ping
    if (keyword == "test"){
        const server = servers[message.guild.id];
    }
    //if transcribing, stops transcription and sends text file
    else if (keyword == "complete"){
        const server = servers[message.guild.id];
        if (!server.transcribing){
            message.channel.send("Please start transcription first!");
            return;
        }
        emitter.emit("off", message);
    }
    else if (keyword == "disconnect" || keyword == "leave"){
        if(!message.member.voice.channel.members.get("829383202916532314")){
            message.channel.send("I am not in the voice channel!");
            return;
        }
        try{
            message.member.voice.channel.leave();
            message.channel.send("Disconnected from voice channel.");
        }
        catch (error){
            message.channel.send("Error disconnecting.");
            console.log(error);
        }
    }
    //DMs list of commands
    else if (keyword == "help"){
        const channel = await message.member.createDM();
        const helpMessage = "```TEXT COMMANDS:\n" + 
            "?play/?p (video link/playlist link/search query) to play a song.\n" +
            "?queue/?q to check on the queue.\n" +
            "?skip to skip the current song.\n" + 
            "?lyrics to get the lyrics for the current song.\n" +
            "?lyrics (search query) to get lyrics from search.\n" +
            "?remove (number or \"last\") to remove a song in the queue at a specific place.\n\n" +
            "?ytsearch (search query) to search for videos on Youtube.\n" +
            "?weather (city name) to look up current weather in any city.\n" +
            "?timer (hours minutes seconds) to set a timer for the specified hours, minutes, and seconds.\n\n" +
            "?translate (language code to translate to) (content to translate) to translate text.\n" +
            "?tts (content) to make bot join channel and read content out loud.\n" +
            "?listen to make bot join and listen to ALL members.\n" +
            "?ignore to make bot stop listening to you.\n\n" +
            "?transcribe to make bot join and start transcribing speech of ALL participants.\n" +
            "?complete to stop transcription and upload text file.\n" +
            "?disconnect/leave to make bot leave voice channel.\n\n" +
            "VOICE COMMANDS:\n" +
            "Keyword to activate bot is Benedict.\n" +
            "play/queue/skip/lyrics/remove/weather/ignore/transcribe/complete/disconnect are all also voice activated commands.```";

        channel.send(helpMessage);
    }
    else if (keyword == "ignore"){
        if (listenOn[message.member.id] == 2){
            message.channel.send("Bot is already ignoring you!");
            return;
        }
        listenOn[message.member.id] = 2;
        message.channel.send("Stopped listening to **" + message.member.user.username + "**.");
    }

    else if (keyword == "listen") {
        if (!checkUserChannelValid(message)){
            return;
        }
        if (!servers[message.guild.id]){
            servers[message.guild.id] = {
                queue: [],
                queueString: [],
                currentSong: "",
                connection: "",
                transcribing: false
            };
        }
        try{
            const server = servers[message.guild.id];
            message.member.voice.channel.join().then((connection) =>{
                if (!server.connection)
                    setupConnection(connection, message);
                //manaully forces bot to listen to user
                if (listenOn[message.member.id] != 1){
                    listenOn[message.member.id] = 1;
                    listenStream(server.connection, message, message.member);
                }
                //function for adding listen requests to all members in channel
                async function manageListens(value, key){
                    if (!listenOn[key] && !value.user.bot){
                        listenOn[key] = 1;
                        listenStream(server.connection, message, value);
                    }
                }
                message.member.voice.channel.members.forEach(manageListens);

                message.channel.send("Now listening to everyone in **" + message.member.voice.channel.name + "**.");
            });
        }
        catch (error){
            message.channel.out("Error joining and listening to channel.");
            console.log(error);
        }
    }
    else if (keyword == "lyrics" || keyword == "l"){
        findLyrics(tokens, message);
    }
    //format of play is ?play youtubeLink
    else if (keyword == "play" || keyword == "p") {
        //must have something after and user must be in voice channel
        if (!tokens[0]) {
            message.channel.send("You need to provide a link or a search query!");
            return;
        }

        if (!checkUserChannelValid(message)){
            return;
        }
        
        //creates queue for specific server that member is in
        if (!servers[message.guild.id]){
            servers[message.guild.id] = {
                queue: [],
                queueString: [],
                currentSong: "",
                connection: "",
                transcribing: false
            };
        }

        const server = servers[message.guild.id];
        
        try{
            var link = tokens[0];
            var title = "";
            
            if (ytpl.validateID(link)){
                const playlist = await ytpl(link);

                for (let i = 0; i < playlist.items.length; i = i + 1){
                    link = playlist.items[i].shortUrl
                    title = playlist.items[i].title;

                    server.queue.push(link);
                    server.queueString.push(title);
                }

                await message.channel.send("Queued " + playlist.items.length + " songs from **" + playlist.title + "**.");
            }
            else{
                var response = "";

                if(ytdl.validateURL(link))
                    response = await ytSearch.search(ytdl.getVideoID(link));
                else{
                    response = await ytSearch.search(tokens.join(" "));
                    link = response[0].url;
                }

                title = response[0].title;

                server.queue.push(link);
                server.queueString.push(title);
            }
            //joins and starts playing if bot isn't already playing
            //bot has unique, constant id
            try{
                if (!message.member.voice.channel.members.get("829383202916532314") || !server.dispatcher || (!server.dispatcher._writableState.writing && server.queue.length == 1)){
                    message.member.voice.channel.join().then((connection) => {
                        if (!server.connection)
                            setupConnection(connection, message);
                        play(server.connection, message);
                    });
                }
                else{
                    message.channel.send("Queued **" + server.queueString[server.queueString.length - 1] + "**.");
                }
            }
            catch (error){
                message.channel.send("Error trying to join.")
                console.log(error);
            }
        }
        catch (error){
            message.channel.send("Error searching through Youtube.");
            console.log(error);
        }
    }
    else if (keyword == "q" || keyword == "queue"){
        const server = servers[message.guild.id];

        if (!server || server.queueString.length == 0){
            message.channel.send("Queue is empty!");
            return;
        }

        var queue = "```";
        for (i = 0; i < Math.min(15, server.queueString.length); i = i + 1){
            queue = queue + (i + 1) + ". " + server.queueString[i] + "\n";
        }
        queue = queue + "```";
        message.channel.send(queue);
    }
    //removes song from specific position in queue
    else if(keyword == "remove"){
        try{
            if (!tokens[0]){
                message.channel.send("Please follow the correct format for removing songs from queue!");
                return;
            }
            else if (tokens[0] == "last"){
                const [removedSong] = server.queueString.splice(server.queueString.length - 1, 1);
                server.queue.splice(server.queue.length - 1, 1);
                message.channel.send("Removed **" + removedSong + "**.");
                return;
            }
            else if (isNaN(parseInt(tokens[0]))){
                message.channel.send("Please follow the correct format for removing songs from queue!");
                return;
            }
            const server = servers[message.guild.id];
            if (!server.queue){
                message.channel.send("Please initialize a queue first!");
                return;
            }

            const index = tokens.shift();
            if (index <= 0){
                message.channel.send("Cannot remove song from a position of 0 or less!");
                return;
            }
            if (index > server.queue.length){
                message.channel.send("Given index is larger than the length of the queue!");
                return;
            }
            const [removedSong] = server.queueString.splice(index - 1, 1);
            server.queue.splice(index - 1, 1);

            message.channel.send("Removed **" + removedSong + "**.");
        }
        catch (error) {
            message.channel.send("Error removing song from queue.");
            console.log(error);
        }
    }
    else if (keyword == "skip"){
        const server = servers[message.guild.id];
        if (message.member.voice.channel && message.member.voice.channel.members.get("829383202916532314") && server.dispatcher){
            try{
                server.dispatcher.end();
                message.channel.send("Skipped!");
            }
            catch (error){
                message.channel.send("Error skipping song.");
                console.log(error);
            }
            if(server.queue.length != 0){
                try{
                    play(server.connection, message);
                }
                catch (error){
                    message.channel.send("Error playing next song.");
                    console.log(error);
                }
            }
        }
        else{
            message.channel.send("Please start playing music and be in the voice channel before trying to skip!");
            return;
        }
    }
    //takes input in hours, minutes, seconds and notifies user when one minute is left and when time is up
    else if (keyword == "timer") {
        if(!tokens[0] || isNaN(parseInt(tokens[0])) || isNaN(parseInt(tokens[1])) || isNaN(parseInt(tokens[2]))){
            message.channel.send("Please follow the correct format for timers!");
            return;
        }
        const seconds = tokens[0] * 1000;
        const minutes = tokens[1] * 60000;
        const hours = tokens[2] * 3600000;
        const time = hours + minutes + seconds;
        setTimeout(() => minuteLeft(message), time - 60000);
        setTimeout(() => timeUp(message), time);
    }
    else if (keyword == "tts") {
        if (!tokens[0]){
            message.channel.send("Please follow the correct format for text to speech!");
            return;
        }
        const text = tokens.join(" ");
        texttomp3(text, message);
    }
    else if (keyword == "transcribe"){
        if (!checkUserChannelValid(message)){
            return;
        }

        if (!servers[message.guild.id]){
            servers[message.guild.id] = {
                queue: [],
                queueString: [],
                currentSong: "",
                connection: "",
                transcribing: false
            };
        }
        const server = servers[message.guild.id];
        if (server.transcribing){
            message.channel.send("Transcribe is already on!");
            return;
        }

        try{
            message.member.voice.channel.join().then((connection) =>{
                const date = new Date();
                const [day, month, year] = [date.getDate(), date.getMonth(), date.getFullYear()];
                var [hour, minutes, seconds] = [date.getHours(), date.getMinutes(), date.getSeconds()];

                if (seconds < 10)
                    seconds = "0" + seconds;
                if (minutes < 10)
                    minutes = "0" + minutes;
                if (hour < 10)
                    hour = "0" + hour;
                const fullDate = day + "/" + month + "/" + year + ", " + hour + ":" + minutes + ":" + seconds;
                    
                try{
                    fs.writeFileSync("transcript_" + message.guild.id + ".txt", "Transcript started at " + fullDate + ".\n", {flag: "a"});
                }
                catch (error){
                    message.channel.send("Error starting transcription.");
                    console.log(error);
                }

                if (!server.connection)
                    setupConnection(connection, message);
                message.channel.send("Starting transcription.");
                server.transcribing = true;
                async function manageListens(value, key){
                    if (!listenOn[key] && !value.user.bot){
                        listenOn[key] = 1;
                        listenStream(server.connection, message, value);
                    }
                }
                message.member.voice.channel.members.forEach(manageListens);
            });
        }
        catch (error){
            message.channel.out("Error joining and listening to channel.");
            console.log(error);
        }
    }
    //format of translate is ?translate, target language, phrase to translate (?translate fr hello world)
    else if (keyword == "translate") {
        if (!tokens[1]){
            message.channel.send("Please follow the correct format for translations!");
            return;
        }
        try{
            var target = tokens.shift().toLowerCase();
            const text = tokens.join(" ");
            const translation = await translate(text, {from: "en", to: target});
            message.channel.send(translation);
        }
        catch (error){
            message.channel.send("Error translating text.");
            console.log(error);
        }
    }
    //format of weather is ?weather cityName, will write mp3 file on top of sending a message
    else if (keyword == "weather") {
        if (!tokens[0]){
            message.channel.send("Please follow the correct format for weather!");
            return;
        }
        const city = tokens.join(" ");
        try{
            axios.get("http://api.openweathermap.org/data/2.5/weather?q=" + city + "&units=metric&appid=" + process.env.WEATHER_TOKEN).then(resp => {
                const output = "The temperature is " + resp.data.main.temp + " degrees Celcius, it feels like " + resp.data.main.feels_like + " degrees Celcius, and the weather is "
                    + resp.data.weather[0].description + ".";
                message.channel.send(output);
            })
            .catch ((error) => {
                if (error.response.data.message == "city not found"){
                    message.channel.send("Please input a valid city name!");
                }
                else{
                    message.channel.send("Error searching for weather.");
                }
            });
        }
        catch (error){
            message.channel.send("Error searching up weather.");
            console.log(error);
        }
    }
    //searches youtube for videos matching query
    else if (keyword == "ytsearch") {
        if (!tokens[0]){
            message.channel.send("Please follow the correct format for searching in youtube!");
            return;
        }
        const search = tokens.join(" ");
        youtubeSearch(search, message);
    }
    else if (keyword == "y") {
        if (ytlink == "") {
            const output = "Please search for a youtube video first."
            message.channel.send(output);
        }
        else {
            message.channel.send(ytlink);
            ytlink = "";
            ytcounter = 0;
        }
    }
    else if (keyword == "n") {
        if (ytlink == "") {
            const output = "Please search for a youtube video first."
            message.channel.send(output);
        }
        else {
            ytcounter = ytcounter + 1;
            youtubeSearch(ytsearch, message);
        }
    }
});
try{
    client.login(process.env.BOT_TOKEN);
}
catch (error){
    console.log(error);
}