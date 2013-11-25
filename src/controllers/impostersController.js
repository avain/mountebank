'use strict';

var Validator = require('../util/validator'),
    Q = require('q');

function create (spec) {

    function protocolFor (protocolName) {
        var matches = spec.protocols.filter(function (protocol) {
            return protocol.name === protocolName;
        });
        return (matches.length === 0) ? undefined : matches[0];
    }

    function get (request, response) {
        var result = Object.keys(spec.imposters).reduce(function (accumulator, id) {
            return accumulator.concat(spec.imposters[id].hypermedia(response));
        }, []);
        response.send({ imposters: result });
    }

    function post (request, response) {
        var protocol = request.body.protocol,
            port = request.body.port,
            protocolSupport = {},
            validator;

        protocolSupport[protocol] = protocolFor(protocol);
        validator = Validator.create({
            requiredFields: {
                protocol: protocol,
                port: port
            },
            requireValidPorts: { port: port },
            requireProtocolSupport: protocolSupport
        });

        if (!validator.isValid()) {
            response.statusCode = 400;
            response.send({errors: validator.errors()});
            return Q(true);
        }

        return spec.Imposter.create(protocolFor(protocol), port, spec.allowInjection).then(function (imposter) {
            spec.imposters[port] = imposter;
            response.setHeader('Location', imposter.url(response));
            response.statusCode = 201;
            response.send(imposter.hypermedia(response));
        }, function (error) {
            response.statusCode = (error.code === 'insufficient access') ? 403 : 400;
            response.send({errors: [error]});
        });
    }

    return {
        get: get,
        post: post
    };
}

module.exports = {
    create: create
};
