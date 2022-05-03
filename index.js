const { Client, Intents, version, MessageReaction} = require("discord.js");
const config = require("./config.json")
const { Translate } = require("@google-cloud/translate").v2;
const textToSpeech = require("@google-cloud/text-to-speech");
const speech = require("@google-cloud/speech");
const util = require("util");
const axios = require("axios");
const ytdl = require("ytdl-core");
const yts = require("yt-search");
require("dotenv").config();

const projectId = "angular-unison-338316"
const keyFilename = "angular-unison-338316-0c8e7e275407.json"
const translate = new Translate({projectId, keyFilename});
const tts = new textToSpeech.TextToSpeechClient({projectId, keyFilename});
const sst = new speech.SpeechClient({projectId, keyFilename});

//global variables for searching on youtube
var ytcounter = 0;
var ytsearch = "";
var ytlink = "";

//global variables for music bot
var servers = {};
var globalConnection;

const client = new Client({
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.GUILD_MESSAGE_REACTIONS],
});

//initializing discord bot
client.once("ready", () => {
    console.log("Logged in " + version);
});

//function to convert a string to mp3 using google's text-to-speech API
function texttomp3(text, message) {
    const request = {
        input: {text: text},
        voice: {languageCode: "en_UK", ssmlGender: "MALE"},
        audioConfig: {audioEncoding: "MP3"}
    };
    try{
        const [response] = tts.synthesizeSpeech(request);
    }
    catch (error){
        console.log("Error with text to speech.");
    }

    if (checkUserChannelValid(message) ){
        if (!servers[message.guild.id]){
            servers[message.guild.id] = {
                queue: [],
                queueString: []
            };
        }
        const server = servers[message.guild.id];
        if (server.dispatcher){
            if (server.dispatcher.player.voiceConnection.speaking.bitfield == 0 && !server.queue){
                try{
                    message.member.voice.channel.join().then((connection) => {
                        connection.play(response.audioContent);
                        server.dispatcher.setVolume(0.05);
                    });
                }
                catch (error){
                    console.log("Error playing mp3 file.");
                }
            }
        }
        else{
            try{
                message.member.voice.channel.join().then((connection) => {
                    connection.play(response.audioContent);
                    server.dispatcher.setVolume(0.05);
                });
            }
            catch (error){
                console.log("Error playing mp3 file.");
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
    //function in ytdl call searches for format with specific itag of 250, only uses that one
    try{
        server.dispatcher = connection.play(ytdl(server.queue[0], (format) => format.quality === "249"));
    }
    catch (error){
        console.log("Error playing music.");
    }
    server.dispatcher.setVolume(0.05);
    //shift removes the first element in the array
    server.queue.shift();
    server.queueString.shift();
    //statement runs once mp3 file is finished
    //for some reason ffmpeg ends it early, so manual delay of 1 second is set
    server.dispatcher.streams.ffmpeg.once("end", () => {
        setTimeout(function(){
        if (server.queue[0]) {
            play(connection, message);
        }
    }, 1000)
    })
}

//function to search youtube with a key phrase and check if results are correct
async function youtubeSearch(search, message){
    try{
        axios.get("https://serpapi.com/search.json?engine=youtube&search_query=" + search + "&api_key=" + process.env.SEARCH_TOKEN).then(resp =>{
            const video = resp.data.video_results[ytcounter];
            ytlink = video.link;
            ytsearch = search;
            message.channel.send("Title of video is "  + video.title + " by " + video.channel.name + " with " + video.views + " views. Is this correct? (?y/?n)");
        });
    }
    catch (error){
        console.log("Error searching through Youtube.");
    }
}

function minuteLeft(message) {
    const output = "One minute left!";
    message.channel.send(output);
    texttomp3(output, message);
}

function timeUp(message) {
    const output = "Time is up!";
    message.channel.send(output);
    texttomp3(output, message);
}

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
        console.log("Error checking permissions on voice channels.");
    }
    return valid;
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
    const keyword = tokens[0].toLowerCase();

    //test ping
    if (keyword == "ping") {
        message.channel.send("pong");
    }
    //random test functions
    else if (keyword == "test"){
        const server = servers[message.guild.id];
    }
    //format of play is ?play youtubeLink
    //TODO: add tts messages for messages in play channel
    //TODO: add error handling for other functions
    else if (keyword == "play" || keyword == "p") {
        //must have something after and user must be in voice channel
        if (!tokens[1]) {
            message.channel.send("You need to provide a link!");
            return;
        }
        
        var link = tokens[1];
        /*
        try{
            if (!ytdl.validateURL(tokens[1])){
                link = await axios.get("https://serpapi.com/search.json?engine=youtube&search_query=" + tokens.slice(1).join(" ") + "&api_key=" + process.env.SEARCH_TOKEN).then((resp) =>{
                    return resp.data.video_results[0].link;
                });
            }
            const title = await axios.get("https://serpapi.com/search.json?engine=youtube&search_query=" + tokens.slice(1).join(" ") + "&api_key=" + process.env.SEARCH_TOKEN).then((resp) =>{
                return resp.data.video_results[0].title;
            });
        }
        catch (error){
            console.log("Error searching through Youtube.");
        }
        */
        if (!checkUserChannelValid(message)){
            return;
        }

        //creates queue for specific server that member is in?
        if (!servers[message.guild.id]){
            servers[message.guild.id] = {
                queue: [],
                queueString: []
            };
        }

        const server = servers[message.guild.id];
        server.queue.push(link);
        //server.queueString.push(title);

        //joins and starts playing if bot isn't already playing
        if (!server.dispatcher || server.dispatcher.player.voiceConnection.speaking.bitfield == 0){
            message.member.voice.channel.join().then((connection) => {
                globalConnection = connection;
                play(connection, message);
            });
        }
    }
    else if (keyword == "skip"){
        const server = servers[message.guild.id];
        if (server.dispatcher){
            server.dispatcher.end();
            play(globalConnection, message);
        }
        else{
            message.channel.send("Please start playing music before trying to skip!");
        }
    }
    else if (keyword == "q" || keyword == "queue"){
        const server = servers[message.guild.id];
        var queue = "";
        for (i = 0; i < server.queueString.length; i = i + 1){
            queue = queue + (i + 1) + ". " + server.queueString[i] + "\n";
        }
        message.channel.send(queue);
    }
    else if (keyword == "tts") {
        if (!tokens[1]){
            message.channel.send("Please follow the correct format for text to speech!");
            return;
        }
        const text = tokens.slice(1).join(" ");
        texttomp3(text, message);
    }
    //format of translate is ?translate, target language (2 letters), phrase to translate (?translate fr hello world)
    else if (keyword == "translate") {
        if (!tokens[2]){
            message.channel.send("Please follow the correct format for translations!");
            return;
        }
        const text = tokens.slice(2).join(" ");
        const target = tokens[1];
        let [translations] = await translate.translate(text, target);
        message.channel.send(translations.toString());
    }
    //format of weather is ?weather cityName, will write mp3 file on top of sending a message
    else if (keyword == "weather") {
        if (!tokens[1]){
            message.channel.send("Please follow the correct format for weather!");
            return;
        }
        const city = tokens[1];
        try{
            axios.get("http://api.openweathermap.org/data/2.5/weather?q=" + city + "&units=metric&appid=" + process.env.WEATHER_TOKEN).then(resp => {
                const output = "The temperature is " + resp.data.main.temp + " degrees Celcius, it feels like " + resp.data.main.feels_like + " degrees Celcius, and the weather is "
                    + resp.data.weather[0].description + ".";
                message.channel.send(output);
                texttomp3(output, message);
            });
        }
        catch (error){
            console.log("Error searching up weather.");
        }
    }
    //takes input in minutes and notifies user when one minute is left and when time is up
    else if (keyword == "timer") {
        if(!tokens[1] && !typeof(tokens[1]) == "number"){
            message.channel.send("Please follow the correct format for timers!");
            return;
        }
        const time = tokens[1] * 60000;
        setTimeout(() => minuteLeft(message), time - 60000);
        setTimeout(() => timeUp(message), time);
    }
    //searches google with keyphrase, if knowledge graph is available then reads it off, otherwise
    //reads snippet of first organic (not ads) result, also writes mp3
    else if (keyword == "search") {
        if (!tokens[1]){
            message.channel.send("Please follow the correct format for the search function!")
        }
        const searchText = tokens.slice(1).join(" ");
        try{
            axios.get("https://serpapi.com/search.json?engine=google&q=" + searchText + "&api_key=" + process.env.SEARCH_TOKEN).then(resp => {
                if (!(typeof resp.data.knowledge_graph === "undefined") && !(typeof resp.data.knowledge_graph.title === "undefined") && !(typeof resp.data.knowledge_graph.description === "undefined")) {
                    const output = resp.data.knowledge_graph.description;
                    message.channel.send(output);
                    texttomp3(output, message);
                }
                else {
                    const output = resp.data.organic_results[0].snippet
                    message.channel.send(output);
                    texttomp3(output, message);
                }
            });
        }
        catch (error){
            console.log("Error conducting google search.");
        }
    }
    else if (keyword == "ytsearch") {
        if (!tokens[1]){
            message.channel.send("Please follow the correct format for searching in youtube!");
            return;
        }
        const search = tokens.slice(1).join(" ");
        youtubeSearch(search, message);
    }
    else if (keyword == "y") {
        if (ytlink == "") {
            const output = "Please search for a youtube video first. "
            message.channel.send(output);
            texttomp3(output, message);
        }
        else {
            message.channel.send(ytlink);
            ytlink = "";
            ytcounter = 0;
        }
    }
    else if (keyword == "n") {
        if (ytlink == "") {
            const output = "Please search for a youtube video first. "
            message.channel.send(output);
            texttomp3(output, message);
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
    console.log("Error logging in.");
}