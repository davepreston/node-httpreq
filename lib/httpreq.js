/*
Copyright (c) 2013 Sam Decrock <sam.decrock@gmail.com>

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var querystring = require('querystring');
var https = require('https');
var http = require('http');
var url = require('url');
var fs = require('fs');


/**
 * Generate multipart boundary string
 *
 * @return {string}
 */

function generateBoundary() {
  var boundary = '---------------------------';
  var charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var i;

  for (i = 0; i < 29; i++) {
    boundary += charset.charAt(Math.floor(Math.random() * charset.length));
  }

  return boundary;
}


/**
 * Parse cookies from headers
 *
 * @param required {object} headers
 * @return {array}
 */

function extractCookies(headers) {
  var rawcookies = headers['set-cookie'];
  var rawcookie;
  var cookies = [];
  var i;

  if (!rawcookies || !rawcookies.length) {
    return [];
  }

  for (i = 0; i < rawcookies.length; i++) {
    rawcookie = rawcookies[i].split(';');
    if (rawcookie[0]) {
      cookies.push(rawcookie[0]);
    }
  }
  return cookies;
}


/**
 * HTTP request
 *
 * @param required {object} o
 * @param required {function} callback
 * @return {void}
 */

function doRequest(o, callback) {
  var contentType;
  var reqUrl;
  var reqError;
  var key;

  var port;
  var host;
  var path;
  var isHttps = false;

  var request;

  var boundary = generateBoundary();
  var separator = '--' + boundary;
  var bodyArray = new Array();
  var footer = '\r\n' + separator + '--\r\n';

  var body;
  var chunks = [];
  var haveAlreadyAddedAFile = false;
  var encodedParameter;
  var encodedFile;
  var filepath;
  var filename;
  var requestOptions;
  var headerName = null;
  var headerValue = null;


  // prevent multiple callbacks
  var finalCallbackDone = false;

  if (!callback) {
    // dummy function
    callback = function() {};
  }

  function finalCallback(err, res) {
    if (!finalCallbackDone) {
      finalCallbackDone = true;
      callback(err, res);
    }
  }

  if (!o.maxRedirects) {
    o.maxRedirects = 10;
  }

  if (o.proxy) {
    port = o.proxy.port;
    host = o.proxy.host;
    path = o.url;

    if (o.proxy.protocol && o.proxy.protocol.match(/https/)) {
      isHttps = true;
    }
  } else {
    reqUrl = url.parse(o.url);
    host = reqUrl.hostname;
    path = reqUrl.path;

    if (reqUrl.protocol === 'https:') {
      isHttps = true;
    }

    if (reqUrl.port) {
      port = reqUrl.port;
    } else if (isHttps) {
      port = 443;
    } else {
      port = 80;
    }
  }

  if (o.files && o.files.length && o.method === 'GET') {
    reqError = new Error('Can\'t send files using GET');
    reqError.code = 'CANT_SEND_FILES_USING_GET';
    return finalCallback(reqError);
  }

  if (o.parameters) {
    if (o.method === 'GET') {
      path += '?' + querystring.stringify(o.parameters);
    } else {
      body = new Buffer(querystring.stringify(o.parameters), 'utf8');
      contentType = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
  }

  if (o.json) {
    body = new Buffer(JSON.stringify(o.json), 'utf8');
    contentType = 'application/json';
  }

  if (o.files) {
    // if the user wants to POST/PUT files, other parameters need to be encoded using 'Content-Disposition'
    for (key in o.parameters) {
      encodedParameter = separator + '\r\n' +
        'Content-Disposition: form-data; name="' + encodeURIComponent(key) + '"\r\n\r\n' +
        encodeURIComponent(o.parameters[key]) + '\r\n';

      bodyArray.push(new Buffer(encodedParameter));
    }

    // now for the files:
    for (key in o.files) {
      filepath = o.files[key];
      filename = filepath.replace(/\\/g, '/').replace(/.*\//, '');

      encodedFile = separator + '\r\n' +
        'Content-Disposition: file; name="' + key + '"; filename="' + filename + '"\r\n' +
        'Content-Type: application/octet-stream\r\n\r\n';

      // add crlf before separator if we have already added a file
      if (haveAlreadyAddedAFile) {
        encodedFile = '\r\n' + encodedFile;
      }

      bodyArray.push(new Buffer(encodedFile));

      // add binary file:
      bodyArray.push(require('fs').readFileSync(filepath));

      haveAlreadyAddedAFile = true;
    }

    bodyArray.push(new Buffer(footer));

    // set body and contentType:
    body = Buffer.concat(bodyArray);
    contentType = 'multipart/form-data; boundary=' + boundary;
  }

  // overwrites the body if the user passes a body:
  // clears the content-type
  if (o.body) {
    body = new Buffer(o.body, 'utf8');
    contentType = null;
  }

  requestOptions = {
    host: host,
    port: port,
    path: path,
    method: o.method,
    headers: {}
  };

  if (!o.redirectCount) {
    o.redirectCount = 0;
  }

  if (body) {
    requestOptions.headers['Content-Length'] = body.length;
  }

  if (contentType) {
    requestOptions.headers['Content-Type'] = contentType;
  }

  if (o.cookies) {
    requestOptions.headers.Cookie = o.cookies.join('; ');
  }

  if (isHttps && o.rejectUnauthorized) {
    requestOptions.rejectUnauthorized = o.rejectUnauthorized;
  }

  if (isHttps && o.key) {
    requestOptions.key = o.key;
  }

  if (isHttps && o.cert) {
    requestOptions.cert = o.cert;
  }

  if (isHttps && o.secureProtocol) {
    requestOptions.secureProtocol = o.secureProtocol;
  }

  // add custom headers:
  if (o.headers) {
    for (key in o.headers) {
      requestOptions.headers[key] = o.headers[key];
    }
  }

  if (o.agent) {
    requestOptions.agent = o.agent;
  }

  if (o.auth) {
    requestOptions.auth = o.auth;
  }

  if (o.localAddress) {
    requestOptions.localAddress = o.localAddress;
  }

  if (o.secureOptions) {
    requestOptions.secureOptions = o.secureOptions;
  }

  function requestResponse(res) {
    var ended = false;
    var currentsize = 0;
    var downloadstream = null;

    if (o.downloadlocation) {
      downloadstream = fs.createWriteStream(o.downloadlocation);
    }

    res.on('data', function(chunk) {
      var totalsize;

      if (o.downloadlocation) {
        // write it to disk, not to memory
        downloadstream.write(chunk);
      } else {
        chunks.push(chunk);
      }

      if (o.progressCallback) {
        totalsize = res.headers['content-length'];

        if (totalsize) {
          currentsize += chunk.length;

          o.progressCallback(null, {
            totalsize: totalsize,
            currentsize: currentsize,
            percentage: currentsize * 100 / totalsize
          });
        } else {
          o.progressCallback(new Error('no content-length specified for file, so no progress monitoring possible'));
        }
      }
    });

    res.on('end', function() {
      var responsebody = null;
      var error = null;

      ended = true;

      // check for redirects
      if (res.headers.location && o.allowRedirects) {
        if (o.redirectCount < o.maxRedirects) {
          o.redirectCount++;
          o.url = res.headers.location;
          return doRequest(o, finalCallback);
        }

        error = new Error('Too many redirects (> ' + o.maxRedirects + ')');
        error.code = 'TOOMANYREDIRECTS';
        error.redirects = o.maxRedirects;
        return finalCallback(error);
      }

      if (!o.downloadlocation) {
        responsebody = Buffer.concat(chunks);

        if (!o.binary) {
          responsebody = responsebody.toString('utf8');
        }

        return finalCallback(error, {
          headers: res.headers,
          statusCode: res.statusCode,
          body: responsebody,
          cookies: extractCookies(res.headers)
        });
      }

      downloadstream.end(null, null, function() {
        return finalCallback(null, {
          headers: res.headers,
          statusCode: res.statusCode,
          downloadlocation: o.downloadlocation,
          cookies: extractCookies(res.headers)
        });
      });
    });

    res.on('close', function() {
      if (!ended) {
        finalCallback(new Error('Request aborted'));
      }
    });
  }

  // remove headers with undefined keys or values
  // else we get an error in Node 0.12.0 about `setHeader()`
  for (key in requestOptions.headers) {
    headerValue = requestOptions.headers[key];
    if (!headerName || !headerValue) {
      delete requestOptions.headers[key];
    }
  }

  if (isHttps) {
    request = https.request(requestOptions, requestResponse);
  } else {
    request = http.request(requestOptions, requestResponse);
  }

  if (o.timeout) {
    request.on('socket', function(socket) {
      socket.on('timeout', function() {
        var error = new Error('request timed out');

        error.code = 'TIMEOUT';
        finalCallback(error);
        request.abort();
      });

      socket.setTimeout(parseInt (o.timeout, 10));
    });
  }

  request.on('error', function(err) {
    finalCallback(err);
  });

  if (body) {
    request.write(body);
  }

  request.end();
}


/**
 * API: HTTP GET request
 *
 * @param required {string} fullUrl
 * @param optional {object} options
 * @param required {function} callback
 * @return {void}
 */

exports.get = function(fullUrl, options, callback) {
  if (!callback && typeof options === 'function') {
    callback = options;
  }

  options = options instanceof Object ? options : {};
  options.url = fullUrl;
  options.method = 'GET';

  if (!options.allowRedirects) {
    options.allowRedirects = true;
  }

  doRequest(options, callback);
};


/**
 * API: HTTP POST request
 *
 * @param required {string} fullUrl
 * @param optional {object} options
 * @param required {function} callback
 * @return {void}
 */

exports.post = function(fullUrl, options, callback) {
  if (!callback && typeof options === 'function') {
    callback = options;
  }

  options = options instanceof Object ? options : {};
  options.url = fullUrl;
  options.method = 'POST';
  doRequest(options, callback);
};


/**
 * API: HTTP PUT request
 *
 * @param required {string} fullUrl
 * @param optional {object} options
 * @param required {function} callback
 * @return {void}
 */

exports.put = function(fullUrl, options, callback) {
  if (!callback && typeof options === 'function') {
    callback = options;
  }

  options = options instanceof Object ? options : {};
  options.url = fullUrl;
  options.method = 'PUT';
  doRequest(options, callback);
};


/**
 * API: HTTP DELETE request
 *
 * @param required {string} fullUrl
 * @param optional {object} options
 * @param required {function} callback
 * @return {void}
 */

exports.delete = function(fullUrl, options, callback) {
  if (!callback && typeof options === 'function') {
    callback = options;
  }

  options = options instanceof Object ? options : {};
  options.url = fullUrl;
  options.method = 'DELETE';
  doRequest(options, callback);
};


/**
 * API: Download a file to disk
 *
 * @param required {string} fullUrl
 * @param required {string} downloadlocation
 * @param optional {function} progressCallback
 * @param required {function} callback
 * @return {void}
 */

exports.download = function(fullUrl, downloadlocation, progressCallback, callback) {
  var options = {};

  options.url = fullUrl;
  options.method = 'GET';
  options.downloadlocation = downloadlocation;
  options.allowRedirects = true;

  if (!callback && typeof progressCallback === 'function') {
    callback = progressCallback;
  } else {
    options.progressCallback = progressCallback;
  }

  doRequest(options, callback);
};


/**
 * API: Upload files (deprecated)
 *
 * @param required {object} options
 * @param required {function} callback
 * @return {void}
 */

exports.uploadFiles = function(options, callback) {
  options = options instanceof Object ? options : {};
  options.method = 'POST';
  doRequest(options, callback);
};


/**
 * API: Customized request
 *
 * @param required {object} options
 * @param required {function} callback
 * @return {void}
 */

exports.doRequest = doRequest;
