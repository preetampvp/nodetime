'use strict';


function HttpProbe(agent) {
  this.agent = agent;

  this.packages = ['http', 'https'];
}
exports.HttpProbe = HttpProbe;



HttpProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__nodetimeProbeAttached__) return;
  obj.__nodetimeProbeAttached__ = true;

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;
  var counter = profiler.createSkipCounter();
  var serverMetrics = profiler.createCallMetricsGroups();
  var clientMetrics = profiler.createCallMetricsGroups();

  var typeServer = 'HTTP Server';
  var typeClient = 'HTTP Client';


  // server probe
  proxy.before(obj.Server.prototype, ['on', 'addListener'], function(obj, args) {
    if(args[0] !== 'request') return;

    if(obj.__httpProbe__) return;
    obj.__httpProbe__ = true;

    proxy.callback(args, -1, function(obj, args) {
      var req = args[0];
      var res = args[1];
      var group = self.agent.namedTransactions.matchRequest(req);
      var time = profiler.time(typeServer, group, true);
      serverMetrics.callStart(typeServer, null, time);
      if(group) serverMetrics.callStart(typeServer, group, time);

      var skipSample = counter.skip(time);
      if(!skipSample) {
        profiler.startTransaction(time);
      }

      proxy.after(res, 'end', function(obj, args) {
        var error = res.__caughtException__;
        if(error) res.__caughtException__ = undefined;

        if(!time.done(error ? true : false)) return;
        serverMetrics.callDone(typeServer, null, time);
        if(group) serverMetrics.callDone(typeServer, group, time);
        if(skipSample) return;

        var sample = profiler.createSample();
        sample['Type'] = typeServer;
        sample['Method'] = req.method;
        sample['URL'] = req.url;
        sample['Request headers'] = req.headers;
        sample['Status code'] = res.statusCode;
        sample['Stack trace'] = profiler.formatStackTrace(error);
        sample['Error'] = (error ? (error.message || 'Uncaught exeption') : undefined);
        sample._group = typeServer;
        sample._label = req.url;

        profiler.addSample(time, sample);
      });
    });
  });


  // client error probe
  proxy.after(obj, 'request', function(obj, args, ret) {
    var time = undefined;
    var trace = profiler.stackTrace();
    var opts = args[0];
    var group = (opts.method || 'GET');

    // exclude api communication
    if(opts && opts.headers && opts.headers['X-Agent-Version']) return;

    proxy.before(ret, 'end', function(obj, args) {
      time = opts.__time__ = !opts.__time__ ? profiler.time(typeClient, opts.method || 'GET') : undefined;
      clientMetrics.callStart(typeClient, null, time);
      clientMetrics.callStart(typeClient, group, time);
    });

    proxy.before(ret, ['on', 'addListener'], function(obj, args) {
      if(args[0] !== 'error') return;

      proxy.callback(args, -1, function(obj, args) {
        if(!time || !time.done(proxy.hasError(args))) return;
        clientMetrics.callDone(typeClient, null, time);
        clientMetrics.callDone(typeClient, group, time);
        if(counter.skip(time)) return;

        var error = proxy.getErrorMessage(args);
        var sample = profiler.createSample();
        sample['Type'] = typeClient;
        sample['Method'] = opts.method;
        sample['URL'] = 
          (opts.hostname || opts.host) + 
          (opts.port ? ':' + opts.port : '') + 
          (opts.path || '/');
        sample['Request headers'] = opts.headers;
        sample['Stack trace'] = trace;
        sample['Error'] = error;
        sample._group = typeClient + ': ' + group;
        sample._label = typeClient + ': ' + sample.URL;

        profiler.addSample(time, sample);
      });   
    });
  });


  // client probe
  proxy.before(obj, 'request', function(obj, args) {
    var trace = profiler.stackTrace();
    var opts = args[0];
    var group = (opts.method || 'GET');
 
    // exclude api communication
    if(opts && opts.headers && opts.headers['X-Agent-Version']) return;

    proxy.callback(args, -1, function(obj, args) {
      var res = args[0];
      proxy.before(res, ['on', 'addListener'], function(obj, args) {
        if(args[0] !== 'end') return;
        
        proxy.callback(args, -1, function(obj, args) {
	        var time = opts.__time__;
          if(!time || !time.done()) return;
          clientMetrics.callDone(typeClient, null, time);
          clientMetrics.callDone(typeClient, group, time);
          if(counter.skip(time)) return;

          var sample = profiler.createSample();
          sample['Type'] = typeClient; 
          sample['Method'] = opts.method;
          sample['URL'] = 
            (opts.hostname || opts.host) + 
            (opts.port ? ':' + opts.port : '') + 
            (opts.path || '/');
          sample['Request headers'] = opts.headers; 
          sample['Response headers'] = res.headers; 
          sample['Status code'] = res.statusCode;
          sample['Stack trace'] = trace;
          sample._group = typeClient + ': ' + group;
          sample._label = typeClient + ': ' + sample.URL;

          profiler.addSample(time, sample);
        });
      });
    });
  });
};


