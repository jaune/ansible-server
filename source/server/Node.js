var async = require('async');
var zmq = require('zmq');

function Node(proxyID, rclient) {
    this.rclient = rclient;

    this.id = proxyID;

    this.pushSockets = {};
    this.pullSocket = zmq.socket('pull');

    this.pullSocket.on('message', this.processMessage.bind(this));

    this.subjectSockets = {};
}


Node.prototype.processMessage = function (dataBuffer) {
    var dataString = dataBuffer.toString('utf8');
    var dataArray = JSON.parse(dataString);

    if (dataArray[0] !== 'message') {
        return;
    }

    var sockets = this.subjectSockets[dataArray[2]],
        socket;
    for (var idSocket in sockets) {
        socket = sockets[idSocket];

        if (socket) {
            console.log(socket.id, JSON.stringify(dataArray[3]));
            socket.send(JSON.stringify(dataArray[3]));
        }
    }
};

Node.prototype.listen = function (pullPort, next) {
    var me = this;

    me.pullSocket.bind(pullPort, function (error) {
        if (error) {
            return next(error);
        }

        me.rclient.SET('node '+me.id, pullPort, function (error, value) {
            if (error) {
                return next(error);
            }
            next();
        });
    });
};

Node.prototype.lookupPushSocket = function (nodeID, next) {
    if (this.pushSockets.hasOwnProperty(nodeID)) {
        return next(null, this.pushSockets[nodeID]);
    }

    var socket = zmq.socket('push');

    this.pushSockets[nodeID] = socket;

    this.rclient.GET('node '+nodeID, function (error, value) {
        if (error) {
            return next(error);
        }

        try {
            socket.connect(value);
        } catch (error) {
            return next(error);
        }
        next(null, socket);
    });
};

Node.prototype.sendMessage = function (from, to, dataArray) {
    var dataString = JSON.stringify(['message', from, to, dataArray]);

    var me = this;

    this.rclient.SMEMBERS('clients '+to, function (error, values) {
        if (error) {
            return;
        }

        var socketsByNode = {};

        values.forEach(function (clientID) {
            var parts = clientID.split('@');
            var nodeID = parts[1];
            var socketID = parts[0];

            if (socketsByNode.hasOwnProperty(nodeID)) {
                socketsByNode[nodeID].push(socketID);
            } else {
                socketsByNode[nodeID] = [socketID];
            }
        });

        var nodes = Object.keys(socketsByNode);

        async.each(nodes, function(nodeID, done) {

            me.lookupPushSocket(nodeID, function (error, pushSocket) {
                if (error) {
                    return done(error);
                }

                pushSocket.send(dataString);

                done(null);
            });

        }, function (error) {
            if (error) {
                console.error(error);
            }
        });

    });

};


Node.prototype.registerSocket = function (subjectID, socket) {
    this.rclient.SADD('clients '+subjectID, socket.id+'@'+this.id);
    if (!this.subjectSockets.hasOwnProperty(subjectID))
    {
        this.subjectSockets[subjectID] = {};
    }
    this.subjectSockets[subjectID][socket.id+'@'+this.id] = socket;
};

Node.prototype.unregisterSocket = function (subjectID, socket) {
    this.rclient.SREM('clients '+subjectID, socket.id+'@'+this.id);
    delete this.subjectSockets[subjectID][socket.id+'@'+this.id];
};

module.exports = Node;