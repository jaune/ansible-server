var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;

var Connection = function (socket, states) {
    this.state = null;
    this.states = states;

    this.socket = socket;

    this.data = {};

    this.request_counter = 0;
    this.requests = {};

    socket.on('message', this.processMessage.bind(this));
    socket.on('close', this.notifySocketClose.bind(this));
};

inherits(Connection, EventEmitter);


Connection.prototype.setState = function (state) {
    var nextState = this.states[state];
    var currentState = this.states[this.state];

    if (!nextState) {
        console.error('missing state `'+state+'`');
        return;
    }

    var me = this;

    if (this.state && currentState && currentState.mixin) {
        Object.keys(currentState.mixin).forEach(function (name) {
            delete me[name];
        });
    }

    if (nextState.mixin){
        Object.keys(nextState.mixin).forEach(function (name) {
            me[name] = nextState.mixin[name];
        });
    }

    this.state = state;
};

Connection.prototype.timeoutRequest = function (uuid) {
    delete this.requests[uuid];
};


Connection.prototype.sendMessageString = function (message) {
    console.log('--->', message);
    this.socket.send(message);
};

Connection.prototype.sendMessageArray = function (message) {
    this.sendMessageString(JSON.stringify(message));
};


Connection.prototype.sendMessage = function () {
    this.sendMessageArray(Array.prototype.slice.call(arguments, 0));
};


Connection.prototype.sendRequest = function () {
    var parameters = Array.prototype.slice.call(arguments, 0);
    var uuid = (Date.now()).toString(36) + '-' + this.request_counter.toString(36) + '-' + Math.round(Math.random() * 0xFF00FF).toString(36);
    var callback = parameters.pop();

    if (typeof callback !== 'function') {
        console.error('last argument must be a function');
        return;
    }

    var message = Array.prototype.slice.call(parameters, 0);

    message.unshift('request', uuid);

    this.request_counter++;

    this.requests[uuid] = {
        message: message,
        callback: callback,
        timeout: setTimeout(this.timeoutRequest.bind(this, uuid), 1000)
    };
    this.sendMessageArray(message);
};


Connection.prototype.processResponse = function (dataArray) {
    var uuid = dataArray[1];
    var error = dataArray[2];
    var result = dataArray[3];

    var request = this.requests[uuid];

    if (!request) {
        console.error('missing request `'+uuid+'`');
        return;
    }

    clearTimeout(request.timeout);
    delete this.requests[uuid];

    request.callback.call(this, error, result);
};

Connection.prototype.processRequest = function (dataArray) {
    var uuid = dataArray[1];
    var action = dataArray[2];

    var parameters = dataArray.slice(3);

    parameters.push((function (error, result) {
        this.me.sendMessage('response', this.uuid, error, result);
    }).bind(
        {
            me: this,
            uuid: uuid
        }
    ));

    var currentState = this.states[this.state];

    if (!currentState) {
        console.error('missing state `'+this.state+'`');
        return;
    }
    var availableActions = currentState.request;
    if (!availableActions) {
        console.error('missing actions(request) for state `'+this.state+'`');
        return;
    }

    var actionFunction = availableActions[action];
    if (!actionFunction) {
        console.error('missing action `'+action+'` for state `'+this.state+'`');
        return;
    }
    actionFunction.apply(this, parameters);
};

Connection.prototype.processMessage = function (dataString) {
    console.log('<---', dataString);

    var dataArray = JSON.parse(dataString);

    if (!Array.isArray(dataArray)) {
        console.error('data must be an array');
        return;
    }

    var action = dataArray[0];

    var currentState = this.states[this.state];

    if (!currentState) {
        console.error('missing state `'+this.state+'`');
        return;
    }

    switch (dataArray[0]) {
        case 'response':
            this.processResponse(dataArray);
            break;
        case 'request':
            this.processRequest(dataArray);
            break;
        default:
            var availableActions = currentState.message;
            if (!availableActions) {
                console.error('missing actions(message) for state `'+this.state+'`');
                return;
            }
            var actionFunction = availableActions[action];
            if (!actionFunction) {
                console.error('missing action `'+action+'` for state `'+this.state+'`');
                return;
            }
            actionFunction.apply(this, dataArray.slice(1));
    }
};


Connection.prototype.notifySocketClose = function () {
    console.log('---close---');
};

module.exports = Connection;
