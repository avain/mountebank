'use strict';

const assert = require('assert'),
    HttpProxy = require('../../../src/models/http/httpProxy'),
    api = require('../api').create(),
    promiseIt = require('../../testHelpers').promiseIt,
    port = api.port + 1,
    timeout = parseInt(process.env.MB_SLOW_TEST_TIMEOUT || 3000),
    airplaneMode = process.env.MB_AIRPLANE_MODE === 'true';

describe('http proxy', () => {
    const noOp = () => {},
        logger = { debug: noOp, info: noOp, warn: noOp, error: noOp },
        proxy = HttpProxy.create(logger);

    describe('#to', () => {
        promiseIt('should send same request information to proxied url', () => {
            const proxyRequest = { protocol: 'http', port },
                request = { path: '/PATH', method: 'POST', body: 'BODY', headers: { 'X-Key': 'TRUE' } };

            return api.post('/imposters', proxyRequest).then(() => proxy.to(`http://localhost:${port}`, request, {})).then(response => {
                assert.strictEqual(response.statusCode, 200, 'did not get a 200 from proxy');

                return api.get(`/imposters/${port}`);
            }).then(response => {
                const requests = response.body.requests;
                assert.strictEqual(requests.length, 1);
                assert.strictEqual(requests[0].path, '/PATH');
                assert.strictEqual(requests[0].method, 'POST');
                assert.strictEqual(requests[0].body, 'BODY');
                assert.strictEqual(requests[0].headers['X-Key'], 'TRUE');
            }).finally(() => api.del('/imposters'));
        }).timeout(timeout);

        promiseIt('should return proxied result', () => {
            const stub = { responses: [{ is: { statusCode: 400, body: 'ERROR' } }] },
                request = { protocol: 'http', port, stubs: [stub] };

            return api.post('/imposters', request).then(response => {
                assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

                return proxy.to(`http://localhost:${port}`, { path: '/', method: 'GET', headers: {} }, {});
            }).then(response => {
                assert.strictEqual(response.statusCode, 400);
                assert.strictEqual(response.body, 'ERROR');
            }).finally(() => api.del('/imposters'));
        }).timeout(timeout);

        promiseIt('should proxy to https', () => {
            const stub = { responses: [{ is: { statusCode: 400, body: 'ERROR' } }] },
                request = { protocol: 'https', port, stubs: [stub] };

            return api.post('/imposters', request).then(response => {
                assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

                return proxy.to(`https://localhost:${port}`, { path: '/', method: 'GET', headers: {} }, {});
            }).then(response => {
                assert.strictEqual(response.statusCode, 400);
                assert.strictEqual(response.body, 'ERROR');
            }).finally(() => api.del('/imposters'));
        }).timeout(timeout);

        promiseIt('should update the host header to the origin server', () => {
            const stub = {
                    responses: [{ is: { statusCode: 400, body: 'ERROR' } }],
                    predicates: [{ equals: { headers: { host: `localhost:${port}` } } }]
                },
                request = { protocol: 'http', port, stubs: [stub] };

            return api.post('/imposters', request).then(response => {
                assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

                return proxy.to(`http://localhost:${port}`, { path: '/', method: 'GET', headers: { host: 'www.mbtest.org' } }, {});
            }).then(response => {
                assert.strictEqual(response.statusCode, 400);
                assert.strictEqual(response.body, 'ERROR');
            }).finally(() => api.del('/imposters'));
        }).timeout(timeout);

        promiseIt('should capture response time to origin server', () => {
            const stub = { responses: [{ is: { body: 'ORIGIN' }, _behaviors: { wait: 250 } }] },
                request = { protocol: 'http', port, stubs: [stub] };

            return api.post('/imposters', request).then(response => {
                assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

                return proxy.to(`http://localhost:${port}`, { path: '/', method: 'GET', headers: {} }, {});
            }).then(response => {
                assert.strictEqual(response.body, 'ORIGIN');
                assert.ok(response._proxyResponseTime > 230); // eslint-disable-line no-underscore-dangle
            }).finally(() => api.del('/imposters'));
        }).timeout(timeout);

        if (!airplaneMode) {
            promiseIt('should gracefully deal with DNS errors', () => proxy.to('http://no.such.domain', { path: '/', method: 'GET', headers: {} }, {}).then(() => {
                assert.fail('should not have resolved promise');
            }, reason => {
                assert.deepEqual(reason, {
                    code: 'invalid proxy',
                    message: 'Cannot resolve "http://no.such.domain"'
                });
            })).timeout(timeout);

            promiseIt('should gracefully deal with bad urls', () => proxy.to('1 + 2', { path: '/', method: 'GET', headers: {} }, {}).then(() => {
                assert.fail('should not have resolved promise');
            }, reason => {
                assert.deepEqual(reason, {
                    code: 'invalid proxy',
                    message: 'Unable to connect to "1 + 2"'
                });
            })).timeout(timeout);
        }


        ['application/octet-stream', 'audio/mpeg', 'audio/mp4', 'image/gif', 'image/jpeg', 'video/avi', 'video/mpeg'].forEach(mimeType => {
            promiseIt(`should base64 encode ${mimeType} responses`, () => {
                const buffer = new Buffer([0, 1, 2, 3]),
                    stub = {
                        responses: [{
                            is: {
                                body: buffer.toString('base64'),
                                headers: { 'content-type': mimeType },
                                _mode: 'binary'
                            }
                        }]
                    },
                    request = { protocol: 'http', port, stubs: [stub] };

                return api.post('/imposters', request).then(response => {
                    assert.strictEqual(response.statusCode, 201, JSON.stringify(response.body));

                    return proxy.to(`http://localhost:${port}`, { path: '/', method: 'GET', headers: {} }, {});
                }).then(response => {
                    assert.strictEqual(response.body, buffer.toString('base64'));
                    assert.strictEqual(response._mode, 'binary');
                }).finally(() => api.del('/imposters'));
            }).timeout(timeout);
        });

        if (!airplaneMode) {
            promiseIt('should proxy to different host', () => proxy.to('https://google.com', { path: '/', method: 'GET', headers: {} }, {}).then(response => {
                // sometimes 301, sometimes 302
                assert.strictEqual(response.statusCode.toString().substring(0, 2), '30');

                // https://www.google.com.br in Brasil, google.ca in Canada, etc
                assert.ok(response.headers.Location.indexOf('google.') >= 0, response.headers.Location);
            })).timeout(timeout);
        }
    });
});
