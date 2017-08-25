///////////////////////////
// Global Vars
///////////////////////////
var creator_ip = '127.0.0.1'//local ip
var creator_servo_base_port = 20013 + 32;//port to use servo driver.
var matrix_io = require('matrix-protos').matrix_io;//MATRIX protocol buffers
//Setup connection to use MATRIX Servos
var zmq = require('zmq');
var configSocket = zmq.socket('push')
configSocket.connect('tcp://' + creator_ip + ':' + creator_servo_base_port);
//Api keys
var fs = require("fs");
var userConfig = JSON.parse(fs.readFileSync(__dirname+'/configure.json'));
//Libraries
var stripe = require('stripe')(userConfig.apiKeys.stripe);
var request = require('request');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();

///////////////////////////
// SET SERVO POSITION
//////////////////////////
function moveServo(angle){
    //configure which pin and what angle
    var servo_cfg_cmd = matrix_io.malos.v1.io.ServoParams.create({
        pin: 0,
        angle: angle
    });
    //build move command
    var servoCommandConfig = matrix_io.malos.v1.driver.DriverConfig.create({
        servo: servo_cfg_cmd
    });
    //send move command
    configSocket.send(matrix_io.malos.v1.driver.DriverConfig.encode(servoCommandConfig).finish());
}

///////////////////////////
// GONG SWING TIMING
//////////////////////////
var gongsInQueue = 0;//gongs requested
var gongInUse = false;//control swing usage

function gongMaster(){
    setInterval(function() {
        //checks for gongs queued and for current swing to stop
        if(gongsInQueue > 0 && !gongInUse){ 
            gongInUse = true;
            gongsInQueue--;//lower queue amount by 1
            moveServo(180);//swing gong arm
            //delay for position transition 
            setTimeout(function(){
                moveServo(90);//gong arm rest position
                //delay for position transition 
                setTimeout(function(){
                    gongInUse = false;
                },400);
            },300);
        }
    },200)
}

///////////////////////////
// POST SLACK MESSAGE 
//////////////////////////
function logToSlack(message){
    request({
            // HTTP Archive Request Object 
            har: {
              url: 'https://slack.com/api/chat.postMessage',
              method: 'POST',
              headers: [
                {
                  name: 'content-type',
                  value: 'application/x-www-form-urlencoded'
                }
              ],
              postData: {
                mimeType: 'application/x-www-form-urlencoded',
                params: [
                  {
                    name: 'token',
                    value: userConfig.apiKeys.slack
                  },
                  {
                    name: 'channel',
                    value: userConfig.slackChannel
                  },
                  {
                    name: 'link_names',
                    value: true
                  },
                  {
                    name: 'text',
                    value: message
                  }
                ]
              }
            }
        });
}

///////////////////////////
// HANDLE API EVENTS
//////////////////////////
function processEvents(api, event){
    //stripe events
    if(api === 'stripe'){
        if(event.type === 'charge.succeeded'){
            if(event.data.object.status === 'paid'){
                console.log('There was a charge for '+event.data.object.amount);
                logToSlack("A Charge Has Occured");
                gongsInQueue++;//gong once
            }
        }
        else if(event.type === 'transfer.paid'){
            if(event.data.object.status === 'paid'){
                console.log('There was a transfer for '+event.data.object.amount);
                logToSlack("A Transfer Has Occured");
                gongsInQueue+=2;//gong twice
            }
        }
    }
    //slack event
    else if(api === 'slack'){
        //check that slack is sending a slash command event
        if(typeof event.command !== 'undefined' && event.command !== null)
            //check that the command is /gong
            if(event.command === '/gong'){
                gongsInQueue++;
                logToSlack('@'+event.user_name+' has summoned me!');
            }
    }
    //unhandled event
    else{
        console.log('I was not made to handle this event');
    }
}

//////////////////////
// SERVER
/////////////////////
app.use(bodyParser.urlencoded({ extended: true })); //handle urlencoded extended bodies
app.use(bodyParser.json()); //handle json encoded bodies

//STRIPE POST Request Handling
app.post('/events', function(req, res) {
    processEvents('stripe', req.body);//begin gong process
    res.sendStatus(200);//evrything is okay
});

//SLACK POST Request Handling
app.post('/slack_events', function(req, res) {
    //check that request is from slack (not guaranteed)
    if( req.headers['user-agent'].indexOf('https://api.slack.com/robots') > 0){
        processEvents('slack', req.body);//begin gong process
        console.log("received request from slack");
        res.send(req.body.user_name + ', Your Wish Has Been Gonged!');//response to user for /gong
    }
    //request is not from slack
    else
        res.send('You Have Angered The Gong Master!');
});

//Create Server
app.listen(userConfig.serverPort, function() {
    console.log('Gong listening on port '+userConfig.serverPort+'!');
    gongMaster();//listening for gong requests
});
