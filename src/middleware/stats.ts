import express from 'express';
import * as promClient from 'prom-client';

promClient.collectDefaultMetrics();

const requestsInFlight = new promClient.Gauge({
    name: 'http_server_requests_in_flight',
    help: 'Gauge for requests currently being processed',
    labelNames: [ 'method' ]
});

const requestsTotalCounter = new promClient.Counter({
    name: 'http_xserver_requests_total',
    help: 'Counter for total requests',
    labelNames: [ 'method', 'code', 'uri' ]
});

const requestDuration = new promClient.Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'duration histogram of http responses',
    labelNames: [ 'method', 'uri' ],
    buckets: [ 0.003, 0.01, 0.05, 0.1, 0.3, 1.0, 2.5, 10 ]
});

/**
 * Express middleware for computing basic http requests Prometheus stats
 * @param req
 * @param res
 * @param next
 */
export function middleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
    const start = process.hrtime();
    const method = req.method.toLowerCase();

    requestsInFlight.inc({ method });

    let started = false;
    const stat = () => {
        if (!started) {
            started = true;
            const delta = process.hrtime(start);
            let uri = 'unknown';

            if (req.route) {
                uri = req.route.path.replace(':', '');
            }
            requestDuration.observe({ method,
                uri }, delta[0] + (delta[1] / 1e9));

            const code = res.statusCode;

            requestsTotalCounter.inc({ method,
                code,
                uri });
            requestsInFlight.dec({ method });
        }
    };


    // Fire stat on both finish and close to ensure that stat is
    // emitted even if http client cancels before response.
    res.on('finish', stat);
    res.on('close', stat);
    next();
}

/**
 * Metrics handler which will be queried by Prometheus
 * @param app express app
 * @param path path on which to register this handler
 */
export function registerHandler(app: express.Express, path: string): void {
    app.get(path, async (req: express.Request, res: express.Response) => {
        try {
            res.set('Content-Type', promClient.register.contentType);
            res.end(promClient.register.metrics());
        } catch (err) {
            res.status(500).end(err);
        }
    });
}
