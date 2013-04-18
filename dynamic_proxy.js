/*
 * Written by Gared (Stefan Mueller, mu.stefan@googlemail.com)
 *
 * This reverse proxy is intended to do a kind of load balancing for
 * etherpad-lite instances. If you request a pad url (http://server/p/pad)
 * it will be proxied to a random eplite server. The pad url and the host will be
 * temporarily saved in a routing table to forward a request to the same url
 * also to the same  eplite server.
 *
 * Requirements: This script requires node-http-proxy
 *               (https://github.com/nodejitsu/node-http-proxy)
 */

var http = require('http'),
    httpProxy = require('http-proxy'),
    fs = require('fs');

var epliteCounter = 0;
var clusterServer = [
  "127.0.0.1:9001", "127.0.0.1:9002"
]

var routingFile = './routingTable.json';

var proxy = new httpProxy.RoutingProxy();

saveRouting = function(myData) {
  fs.writeFileSync(routingFile, JSON.stringify(myData, null, 4));
}

var routingTable = require(routingFile);

function isPadUrl(url) {
  if (url.match(".*\/p\/.*$")) {
    console.log("isPadUrl: yes");
    return true;
  } else {
    console.log("isPadUrl ("+url+"): no");
    return false;
  }
}

/*
 * Check if pad url is in routing table
 */
function isUrlInRoutingTable(url) {
    var requestedSite = url;
    if (routingTable[requestedSite] === undefined) {
      return false;
    } else {
      console.log("Request "+requestedSite+" forwarded to: "+routingTable[requestedSite]);
      return true;
    }
}
function getProxyServerForUrl(url) {
  console.log("getProxyServerForUrl: "+url);
  if (isPadUrl(url)) {
    return routingTable[url];
  } else {
    console.log("getProxyServerForUrl: No proxy found for url!");
    return false;
  }
}

/*
 * Get proxy server for referer
 */
function getProxyServerForReferer(referer) {
  console.log("getProxyServerForReferer: "+referer);
  var urlParts = referer.split("/");
  var url = "/"+urlParts[3]+"/"+urlParts[4];
  return getProxyServerForUrl(url);
}

/*
 * Check if we need to get the referer of the request to send the request to a
 * specific proxy server.
 * Specific proxy: Handle session and user action
 * Other proxy: Deliver static content
 */
function urlNeedsRefererCheck(url) {
  if (url.match(".*\/socket.io\/.*")) {
    return true;
  } /*else if (url.match(".*\/socket.io.js$")) {
    return true;
  }*/
  else if (url.match(".*locale.*")) {
    return true;
  } else if (url.match(".*pluginfw.*")) {
    return true;
  }
  return false;
}

/*
 * Add the url with the "next" proxy server to the routing table
 */
function addUrlToRoutingTable(url) {
  if (url.match(".*\/p\/.*$")) {
    if (epliteCounter >= clusterServer.length) {
      epliteCounter = 0;
    }
    routingTable[url] = clusterServer[epliteCounter];
    console.log("Added url to routing table");
    console.log(routingTable);
    saveRouting(routingTable);
    epliteCounter++;
  } else {
    console.log("addUrlToRoutingTable: Not a pad url");
  }
}

function writeError(text, res) {
  res.writeHead(400, { 'Content-Type': 'text/plain' });
  res.write('Error: ' +'\n' + text);
  res.end();
}

httpProxy.createServer(function (req, res) {
  console.log("---- new request ----");
  var proxyServerOnReferer;
  var error = false;

  if (isUrlInRoutingTable(req.url)) {
    console.log("url already in routing table");
  } else if (urlNeedsRefererCheck(req.url)) {
    if (req.headers['referer'] !== undefined && isPadUrl(req.headers['referer'])) {
      proxyServerOnReferer = getProxyServerForReferer(req.headers['referer']);
    } else {
      console.log("ERROR: No referer in request:");
      console.log(req);
      writeError("Please enable referer in your browser!", res);
      error = true;
    }
  } else {
    addUrlToRoutingTable(req.url);
  }
  var proxyServer = getProxyServerForUrl(req.url);
  if (proxyServer === false) {
    proxyServer = proxyServerOnReferer;
    if (proxyServer === undefined) {
      console.log("Falling back to first server to deliver static files");
      proxyServer = clusterServer[0];
    }
  }
  var host = proxyServer.split(":")[0];
  var port = proxyServer.split(":")[1];

  if (!error) {
    proxy.proxyRequest(req, res, {
      host: host,
      port: port
    });

    console.log("Request proxied to "+host+":"+port);
  }
}).listen(8000);
console.log("Proxy server started on port 8000");
