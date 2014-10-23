'use strict';
var express = require('express');
var domain = require('domain');
var cluster = require('cluster');
var http = require('http');

var SERVER_CLOSE_TIMEOUT_SECS = 5;

function startServer(){
    var server;
    var app = express();
    var port = process.env.PORT || 80;
    var router = express.Router();
    
    function badFunc(){
        process.nextTick(function(){
            a+b; // jshint ignore:line
        });
    }
    
    router.use(function(req, res, next) {
        console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] %s %s', req.method, req.path);
        next();  
    });
    
    router.get('/', function(req, res, next){
        res.send('everything is fine here');  
    });
    
    router.get('/fail', function(req, res, next) {
        badFunc();
    });
    
    // Force serverDomain failure
    // a+b;

    app.use(function(req, res, next){
        var requestDomain = domain.create();
        
        // Only process one error, the rest we will ignore
        requestDomain.once('error', function(err){
            console.error('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Request domain got error: \n' + err.stack);

            try {
                var serverTimeout = setTimeout(function(){
                    console.warn('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Failed to close server after ' + SERVER_CLOSE_TIMEOUT_SECS + ' seconds.');
                    console.warn('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Number of server connections still alive before killing process: ' + server.connections);
                    process.exit(1);
                }, SERVER_CLOSE_TIMEOUT_SECS*1000);

                // http://nodejs.org/api/timers.html#timers_unref
                // if the timer is the only item left in the event loop won't keep the program running
                serverTimeout.unref();
                
                // disconnect from the cluster
                var worker = cluster.worker;
                if(worker) {
                    console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] disconecting');
                    worker.disconnect();
                } else {
                    console.warn('Not a worker.');
                }
    
                // Stop taking new requests
                console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Closing server');
                console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Number of server connections still alive before attempting to close server: ' + server.connections);
                server.close(function(){
                    console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Server no longer listening');
                });
    
                try{
                    console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Attempt to use express error route');
                    next(err);
                } catch(err) {
                    console.warn('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Express error mechanism failed.\n', err.stack);
                    res.statusCode = 500;
                    res.send('Server error.');
                } 
            }catch(err) {
                    console.warn('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Unable to send 500 response.\n', err.stack);
            }
        });
        
        requestDomain.add(req);
        requestDomain.add(res);
        requestDomain.run(next);
    });

    app.use('/', router);
    server = http.createServer(app);
    server.listen(port, function(){
        console.log('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Server listening on port ' + port);

    });  
}

function main(){
    if (cluster.isMaster){
        cluster
            .on('disconnect', function(worker, code, signal){
                console.log('[ID: ' + worker.id + ', PID: ' + worker.process.pid + '][DISCONNECT] Worker disconnected. Forking a new worker process...');
                cluster.fork();
            })
            .on('exit', function(worker, code, signal){
                console.log('[ID: ' + worker.id + ', PID: ' + worker.process.pid + '][EXIT] Worker exited.');
                // cluster.fork();
            })
            .on('online', function(worker){
                console.log('[ID: ' + worker.id + ', PID: ' + worker.process.pid + '][ONLINE] Worker started');
            });
                
        var cpuCount = require('os').cpus().length;
        console.log('Number of cores on this host = ' + cpuCount);   

        for (var i = 0; i < cpuCount; i ++) {
            cluster.fork();
        }
    } else {
        // Worker code

        // Server domain
        var d = domain.create();
        d.on('error', function(err){
            console.error('[ID: ' + cluster.worker.id + ', PID: ' + cluster.worker.process.pid + '] Server domain got error: \n' + err.stack);
            cluster.worker.disconnect();
        });
        
        d.run(function(){
            startServer();
        });
    }
}

// Go!
main();
