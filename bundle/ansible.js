var engineio = require('engine.io-client');

var Connection = require('../source/Connection');

var states = {
    'unauthenticated': {
        mixin: {
            requestAuthorization: function (api_key, token, next) {
                this.sendRequest('authorization', 'token', api_key, token, function (error, result) {

                    if (error) {
                        return next(error);
                    }

                    this.setState('authenticated '+result);

                    next(null, this);
                });
            }
        }
    },
    'authenticated account': {
        mixin: {
            say: function (to, message) {
                this.sendMessage('say', to, message);
            }
        },
        message: {
            say: function (from, to, message) {
                this.emit('say', from, to, message);
            }
        }
    },
    'authenticated anonymous->account': {
        mixin: {
            say: function (message) {
                this.sendMessage('say', message);
            }
        },
        message: {
            say: function (from, to, message) {
                this.emit('say', from, to, message);
            }
        }
    }
};



/**
 *
 * @constructor
 */
function Ansible(api_key) {
    this.key = api_key;
    this.host = 'localhost:8081';
    this.protocol = 'ws';
}

Ansible.prototype.openConnection = function (token, next) {
    var socket = engineio(this.protocol + '://' + this.host);
    var me = this;

    socket.on('open', function () {
        var connection = new Connection(socket, states);

        connection.setState('unauthenticated');

        connection.requestAuthorization(me.key, token, next);
    });
};


Ansible.prototype.connectAccount = function (token, next) {
    this.openConnection(token, function (error, connection) {
        if (error) { return next(error); }

        if (connection.state != 'authenticated account') {
            return next('invalid');
        }

        return next(null, connection);
    });

};

Ansible.prototype.connectAnonymousToAccount = function (token, next) {
    this.openConnection(token, function (error, connection) {
        if (error) { return next(error); }

        if (connection.state != 'authenticated anonymous->account') {
            return next('invalid');
        }

        return next(null, connection);
    });
};


function createAnsible(api_key) {
    return new Ansible(api_key);
}


module.exports = {
    createAnsible: createAnsible
};

