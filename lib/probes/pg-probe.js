'use strict';


function PgProbe(agent) {
  this.agent = agent;

  this.packages = ['pg'];
}
exports.PgProbe = PgProbe;



PgProbe.prototype.attach = function(obj) {
  var self = this;

  if(obj.__nodetimeProbeAttached__) return;
  obj.__nodetimeProbeAttached__ = true;

  var proxy = self.agent.proxy;
  var profiler = self.agent.profiler;
  var counter = profiler.createSkipCounter();
  var metrics = profiler.createCallMetricsGroups();
  var type = 'PostgreSQL';


  function probe(obj) {
    if(obj.__nodetimeProbeAttached__) return;
    obj.__nodetimeProbeAttached__ = true;

    // Callback API
    proxy.before(obj, 'query', function(obj, args, ret) {
      var client = obj;
      var trace = profiler.stackTrace();
      var command = args.length > 0 ? args[0] : undefined;
      var params = args.length > 1 && Array.isArray(args[1]) ? args[1] : undefined;
      var time = profiler.time(type, "query");
      metrics.callStart(type, null, time);

      proxy.callback(args, -1, function(obj, args) {
        if(!time.done(proxy.hasError(args))) return;
        metrics.callDone(type, null, time);
        if(counter.skip(time)) return;

        var error = proxy.getErrorMessage(args);
        var sample = profiler.createSample();
        sample['Type'] = type;
        sample['Connection'] = {
          host: client.host, 
          port: client.port, 
          user: client.user, 
          database: client.database ? client.database : undefined}; 
        sample['Command'] = truncate(profile, command);
        sample['Arguments'] = profiler.truncate(params);
        sample['Stack trace'] = trace;
        sample['Error'] = error;
        sample._group = type + ': query';
        sample._label = type + ': ' + sample['Command'];

        profiler.addSample(time, sample);
      });
    });


    // Evented API
    proxy.after(obj, 'query', function(obj, args, ret) {
      // If has a callback, ignore
      if(args.length > 0 && typeof args[args.length - 1] === 'function') return;

      var client = obj;
      var trace = profiler.stackTrace();
      var command = args.length > 0 ? args[0] : undefined;
      var params = args.length > 1 && Array.isArray(args[1]) ? args[1] : undefined;
      var time = profiler.time(type, "query");
      var error;
      metrics.callStart(type, null, time);

      proxy.before(ret, 'on', function(obj, args) {
        var event = args[0];

        if(event !== 'end' && event !== 'error') return;

        proxy.callback(args, -1, function(obj, args) {
          if(event === 'error') {
            error = proxy.getErrorMessage(args);
            return;
          }
 
          if(!time.done(proxy.hasError(args))) return;
          metrics.callDone(type, null, time);
          if(counter.skip(time)) return;

          var sample = profiler.createSample();
          sample['Type'] = type;
          sample['Connection'] = {
            host: client.host, 
            port: client.port, 
            user: client.user, 
            database: client.database ? client.database : undefined};
          sample['Command'] = truncate(profiler, command);
          sample['Arguments'] = profiler.truncate(params);
          sample['Stack trace'] = trace;
          sample['Error'] = error;
          sample._group = type + ': query';
          sample._label = type + ': ' + sample['Command'];

          profiler.addSample(time, sample);
        });
      });
    });
  }


  // Native, reinitialize probe 
  proxy.getter(obj, 'native', function(obj, ret) {
    proxy.after(ret, 'Client', function(obj, args, ret) {
      probe(ret.__proto__);
    });
  });

  probe(obj.Client.prototype);
};


function truncate(profiler, str) {
  if(str && typeof(str) === 'object') {
    str = str.text;
  }

  return profiler.truncate(str);
}


