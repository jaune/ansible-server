
var http = require('http');
var express = require('express');
var bodyParser = require('body-parser');
var morgan = require('morgan');
var engineio = require('engine.io');
var redis = require("redis"),
    rclient = redis.createClient();

var Connection = require('./source/Connection');
var Node = require('./source/server/Node');


var app = express();

var port = 8081;

var counter = 0x42;

// app.use(morgan('combined'));

app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());

// validate headers
app.post('/token', function (req, res, next) {
    res.type('json');

    if (!req.accepts('json')) {
        res.status(400).send('Sorry, body response must be JSON.');
        return;
    }

    if (!req.is('json')) {
        res.status(400).send('Sorry, body request must be JSON (Content-Type).');
        return;
    }

    next();
});

// validate authorization
app.post('/token', function (req, res, next) {
    var authorization = req.header('authorization');

    if (!authorization) {
        res.header('WWW-Authenticate: Basic realm="Ansible"');
        res.status(401).send();
        return;
    }

    var parts = authorization.split(' ');

    if (parts.length !== 2) {
        res.status(400).send('Sorry !!!');
        return;
    }

    var scheme = parts[0].toLowerCase(),
        credentials = new Buffer(parts[1], 'base64').toString(),
        separatorIndex = credentials.indexOf(':');

    if ((scheme != 'basic') || (separatorIndex < 0)) {
        return res.status(400).send('Sorry !!!');
    }

    req.authorization = {
        scheme: scheme,
        user: credentials.slice(0, separatorIndex),
        password: credentials.slice(separatorIndex + 1)
    };

    next();
});

// validate body
app.post('/token', function (req, res, next) {

    if (!req.body instanceof Object) {
        res.status(400).send('Sorry, body request must be JSON. (Body)');
        return;
    }

    if (typeof req.body.type !== 'string') {
        res.status(400).send('Sorry, body request must have type.');
        return;
    }

    next();
});


function requestAnonymousToAccount(api_key, account) {

}

app.post('/token', function (req, res, next) {

    var tokenType = req.body.type;

    switch (tokenType) {
        case 'account':
        case 'anonymous->account':
            (function (api_key, account, session) {
                if (typeof account !== 'string') {
                    res.status(400).send('Sorry, body request must have account.');
                    return;
                }

                counter++;

                if (!session) {
                    session = (Date.now()).toString(36) + counter.toString(36) + Math.round(Math.random() * 0xFF00FF).toString(36);
                }

                var token = (Date.now()).toString(36) + '-' + counter.toString(36) + '-' + Math.round(Math.random() * 0xFF00FF).toString(36),
                    key = 'token ' + api_key + ' ' + token;

                rclient.SETEX(key, 5, JSON.stringify({
                    type: tokenType,
                    key: api_key,
                    account: account,
                    session: session
                }), function (error, value) {
                    if (error) {
                        next(error);
                        return;
                    }

                    res.json({
                        token: token,
                        session: session
                    });
                    console.log('request token (' + token + ')');
                });


            })(req.authorization.user, req.body.account, req.body.session);
            break;
        default:
            res.status(400).send('Sorry, `' + tokenType + '` is an invalid type.');
    }
});


var node = new Node('node#0001', rclient);



var states = {
    'unauthenticated': {
        request: {
            'authorization': function (scheme, api_key, token, next) {
                if (scheme !== 'token') {
                    return next(null, false);
                }

                var connection = this;

                var key = 'token ' + api_key + ' ' + token,
                    data;

                rclient.MULTI()
                    .GET(key, function (error, value) {
                        if (error) {
                            return next(null, false);
                        }
                        data = JSON.parse(value);
                    })
                    .DEL(key)
                    .EXEC(function (error, replies) {
                        if (error) {
                            return next(null, false);
                        }

                        if (!data) {
                            return next(null, false);
                        }

                        // test socket.request.headers.origin IN data.key
                        // test data.account IN data.key


                        var socket = connection.socket;
                        var subjectID = '('+data.type+')';


                        if (data.type === 'account') {
                            connection.data.account = data.account;
                            subjectID += data.account;

                        }

                        if (data.type === 'anonymous->account') {
                            connection.data.account = data.account;
                            subjectID += data.session;
                        }

                        connection.data.subject = subjectID;

                        node.registerSocket(subjectID, socket);
                        connection.socket.on('close', function () {
                            node.unregisterSocket(subjectID, socket);
                        });


                        connection.state = 'authenticated '+data.type;

                        next(null, data.type);
                    });

            }
        }
    },
    'authenticated anonymous->account': {
        message: {
            say: function (message) {
                var connection = this;
                var from = connection.data.subject;

                node.sendMessage(from, '(account)'+connection.data.account, ['say', from, '(account)'+connection.data.account, message]);

            }
        }
    },
    'authenticated account': {
        message: {
            say: function (to, message) {
                var connection = this;
                var from = connection.data.subject;
                node.sendMessage(from, to, ['say', from, to, message]);

            }
        }
    }
};





var httpServer = http.createServer(app);

var engineServer = engineio.attach(httpServer);

node.listen('tcp://127.0.0.1:5557', function (error) {
    if (error) {
        console.error(error);
    }

});


engineServer.on('connection', function (socket) {
    var c = new Connection(socket, states);

    c.setState('unauthenticated');
});

httpServer.listen(port, '127.0.0.1');

console.log('Server running at http://127.0.0.1:' + port + '/');