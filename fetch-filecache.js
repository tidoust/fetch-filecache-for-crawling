/**
 * Implementation of a `fetch` that extends the implementation from `node-fetch`
 * to add caching support to a local cache folder.
 *
 * @module fetch-filecache
 */

const crypto = require('crypto');
const URL = require('url');
const filenamifyUrl = require('filenamify-url');
const { rimraf } = require('rimraf');
const path = require('path');
const fs = require('fs');

let globalConfig = {
  cacheFolder: '.cache',
  resetCache: false,
  refresh: 'default',
  logToConsole: false
};


// The list of URLs that are being fetched and that should soon
// be available from the cache, together with the Promise to have
// fetched them
const pendingFetches = {};

// Reset the cache folder only once
let cacheFolderReset = {};

// Request counter
let counter = 0;

// Launch time
const launchTime = (new Date()).getTime();


/**
 * Wrapper around the filenamify library to handle lengthy URLs.
 *
 * By default filenamify truncates the result to 100 characters, but that may
 * not be enough to distinguish between cache entries. When string is too long,
 * replace the end by an MD5 checksum.
 *
 * Note we keep the beginning from filenamify because it remains somewhat human
 * friendly.
 *
 * @function
 * @param {String} url The URL to convert to a filename
 * @return {String} A safe filename that is less than 100 characters long
 */
function filenamify(url) {
  let res = filenamifyUrl(url);
  if (res.length >= 60) {
    res = res.substr(0, 60) +
      '-md5-' +
      crypto.createHash('md5').update(url, 'utf8').digest('hex');
  }
  return res;
}


/**
 * Sleep during the provided number of ms
 *
 * @function
 * @param {Number} ms Number of milliseconds to sleep
 * @return {Promise} promise to sleep during the provided number of ms
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * Return the value of the given HTTP header
 *
 * The function performs a case-insensitive search for the request HTTP header
 * name in the given list of HTTP headers.
 *
 * @function
 * @param {Object} headers HTTP headers
 * @param {string} name HTTP header name to look for
 * @return {string} HTTP header value or null if header is not set.
 */
function getHeaderValue(headers, name) {
  if (!headers) {
    return null;
  }
  const lname = name.toLowerCase();
  const key = Object.keys(headers).find(h => h.toLowerCase() === lname);
  return key ? headers[key] : null;
}


/**
 * Return true if a 304 response should be returned, false otherwise
 *
 * The function is loosely adapted from:
 * https://github.com/http-party/http-server/blob/cf17c2fe97342f6a268bfb8fc79a2b82464c4d25/lib/core/index.js#L135
 * Copyright (c) 2011-2021 Charlie Robbins, Marak Squires, Jade Michael Thornton and the Contributors.
 * Published under an MIT license: https://github.com/http-party/http-server/blob/master/LICENSE
 *
 * Adaptation includes giving priority to If-None-Match over If-Modified-Since
 * (per the HTTP spec), and handling list of values in If-None-Match header.
 *
 * @function
 * @param {Array<string>} requestHeaders Request headers (case-insensitive)
 * @param {Array<string>} responseHeaders Headers from fetch response or cache (all lower-case)
 * @return {boolean} true when a 304 could be returned, false otherwise
 */
function shouldReturn304(requestHeaders, responseHeaders) {
  const requestEtags = (getHeaderValue(requestHeaders, 'If-None-Match') ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(value => !!value);
  if (requestEtags.length > 0) {
    const responseEtag = responseHeaders['etag'] ?? '';
    return !!requestEtags.find(etag =>
      (etag === responseEtag) ||
      (etag === `W/${responseEtag}`) ||
      (`W/${etag}` === responseEtag));
  }

  const requestKnownDate = getHeaderValue(requestHeaders, 'If-Modified-Since');
  if (requestKnownDate) {
    let knownDate;
    // Catch "illegal access" dates that will crash v8
    try {
      knownDate = new Date(Date.parse(requestKnownDate));
    } catch (err) {
      return false;
    }
    if (knownDate.toString() === 'Invalid Date') {
      return false;
    }
    // If the client's copy is older than the server's, don't return 304
    return (knownDate >= new Date(responseHeaders['last-modified']));
  }

  return false;
}



/**
 * Wrapper around the baseFetch function that returns the response from the
 * local cache if one is found.
 *
 * TODO: use encoding specified in content-type header for file operations?
 *
 * @function
 * @private
 * @param {String} url The URL to retrieve
 * @param {Object} options Fetch options, include specific HTTP headers to
 *   send along with the request.
 * @return {Promise<Response>} The promise to get an HTTP response
 */
async function cacheFetch(url, options) {
  // We may modify request options in place, let's make a shallow copy
  options = Object.assign({}, options);
  if (options.headers) {
    options.headers = Object.assign({}, options.headers);
  }

  // Increment request counter and save it locally for logging purpose
  counter += 1;
  let requestId = counter;

  // Specific parameters given in `options` override possible settings read
  // from the `config.json` file.
  // NB: `avoidNetworkRequests` and `forceRefresh` are deprecated but still
  // supported. The `refresh` parameter should rather be used.
  const config = {
    cacheFolder: options.cacheFolder || globalConfig.cacheFolder,
    resetCache: options.hasOwnProperty('resetCache') ?
      options.resetCache :
      globalConfig.resetCache,
    refresh: globalConfig.refresh,
    logToConsole: options.hasOwnProperty('logToConsole') ?
      options.logToConsole :
      globalConfig.logToConsole
  };
  if (options.hasOwnProperty('avoidNetworkRequests')) {
    config.refresh = (options.avoidNetworkRequests ? 'never' : config.refresh);
  }
  if (options.hasOwnProperty('forceRefresh')) {
    config.refresh = (options.forceRefresh ? 'force' : config.refresh);
  }
  if (options.hasOwnProperty('refresh')) {
    config.refresh = options.refresh;
  }
  // Requesting agent may be cache-aware, in which case we will return a 304
  // when resource has not been modified.
  const isRequestCacheAware =
    getHeaderValue(options.headers, 'If-None-Match') ||
    getHeaderValue(options.headers, 'If-Modified-Since');

  const cacheFilename = path.join(config.cacheFolder, filenamify(url));
  const cacheHeadersFilename = cacheFilename + '.headers';

  if (config.resetCache && !cacheFolderReset[config.cacheFolder]) {
    cacheFolderReset[config.cacheFolder] = true;
    await rimraf(config.cacheFolder + '/*', { glob: true });
  }

  function log(msg) {
    if (!config.logToConsole) return;
    console.log(requestId + ' - ' + msg);
  }

  /**
   * Look at HTTP headers, current time and refresh strategy to determine whether
   * cached content has expired
   *
   * @function
   * @param {Object} headers HTTP headers received last time
   * @param {String|Integer} refresh Refresh strategy
   * @return {Boolean} true if cached content has expired (or does not exist),
   *   false when it can still be returned.
   */
  function hasExpired(headers, refresh) {
    if (!headers) {
      log('response is not in cache');
      return true;
    }
    if (refresh === 'force') {
      log('response in cache but refresh requested');
      return true;
    }
    if (refresh === 'never') {
      log('response in cache and considered to be always valid');
      return false;
    }

    let received = new Date(
      headers.received || headers.date || 'Jan 1, 1970, 00:00:00.000 GMT');
    received = received.getTime();
    if (refresh === 'once') {
      if (received < launchTime) {
        log('response in cache but one refresh requested');
        return true;
      }
      else {
        log('response in cache and already refreshed once')
        return false;
      }
    }

    let now = Date.now();
    if (Number.isInteger(refresh)) {
      if (received + refresh * 1000 < now) {
        log('response in cache is older than requested duration');
        return true;
      }
      else {
        log('response in cache is fresh enough for requested duration');
        return false;
      }
    }

    // Apply HTTP expiration rules otherwise
    if (headers.expires) {
      try {
        let expires = (new Date(headers.expires)).getTime();
        if (expires < now) {
          log('response in cache has expired');
          return true;
        }
        else {
          log('response in cache is still valid');
          return false;
        }
      }
      catch (err) {}
    }

    if (headers['cache-control']) {
      try {
        let tokens = headers['cache-control'].split(',')
          .map(token => token.split('='));
        for (token of tokens) {
          let param = token[0].trim();
          if (param === 'no-cache') {
            log('response in cache but no-cache directive');
            return true;
          }
          else if (param === 'max-age') {
            let maxAge = parseInt(token[1], 10);
            if (received + maxAge * 1000 < now) {
              log('response in cache has expired');
              return true;
            }
            else {
              log('response in cache is still valid');
              return false;
            }
          }
        }
      }
      catch (err) {}
    }

    // Cannot tell? Let's refresh the cache
    log('response in cache has expired (no explicit directive)');
    return true;
  }


  async function checkCacheFolder() {
    try {
      let stat = await fs.promises.stat(config.cacheFolder);
      if (!stat.isDirectory()) {
        throw new Error('Looking for a cache folder but found a cache file instead');
      }
    }
    catch (err) {
      // Create the folder if it does not exist yet
      if (err.code !== 'ENOENT') {
        throw err;
      }
      try {
        await fs.promises.mkdir(config.cacheFolder);
      }
      catch (mkerr) {
        // Someone may have created the folder in the meantime
        if (mkerr.code !== 'EEXIST') {
          throw mkerr;
        }
      }
    }
  }

  function isFetchPending() {
    return !!pendingFetches[url];
  }

  async function pendingFetchIsOver() {
    if (pendingFetches[url]) {
      log('wait for pending request');
      await pendingFetches[url].promise;
    }
    else {
      throw new Error('There was no pending request');
    }
  }

  /**
   * Create a pending fetch promise and keep control over that promise so that
   * the code may resolve or reject it through calls to resolvePendingFetch and
   * rejectPendingFetch functions
   */
  function addPendingFetch() {
    let resolve = null;
    let reject = null;
    let promise = new Promise((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    pendingFetches[url] = { promise, resolve, reject };

    // Make sure that we catch rejection (in case no one is actually looking
    // for this URL at the same time, otherwise Node.js will complain with an
    // "UnhandledPromiseRejectionWarning" message)
    promise.catch(err => {});
  }

  function resolvePendingFetch() {
    if (!pendingFetches[url]) return;
    pendingFetches[url].resolve(true);
    delete pendingFetches[url];
  }

  function rejectPendingFetch(err) {
    if (!pendingFetches[url]) return;
    pendingFetches[url].reject(err);
    delete pendingFetches[url];
  }

  async function readHeadersFromCache() {
    try {
      let data = await fs.promises.readFile(cacheHeadersFilename);
      let headers = JSON.parse(data, 'utf8');
      return headers;
    }
    catch (err) {
      // Ignore cache/JSON errors for now, falling back to a network request
      // TODO: throw or report?
    }
  }

  async function readFromCache() {
    let data = await fs.promises.readFile(cacheHeadersFilename, 'utf8');
    let headers = JSON.parse(data);
    let status = headers.status || 200;
    if (headers.status) {
      delete headers.status;
    }
    if (headers.received) {
      delete headers.received;
    }
    if (isRequestCacheAware && shouldReturn304(options.headers, headers)) {
      // Only keep useful headers for 304 response, see:
      // https://httpwg.org/specs/rfc7232.html#status.304
      const toDelete = Object.keys(headers).filter(header =>
        !['cache-control', 'content-location', 'date', 'etag',
          'expires', 'last-modified', 'vary'].includes(header));
      toDelete.forEach(header => delete headers[header]);
      return new Response(null, { url, status: 304, headers });
    }
    let readable = fs.createReadStream(cacheFilename);
    // Indicate this is coming from the cache via
    // https://www.rfc-editor.org/rfc/rfc9211.html
    headers["cache-status"] = "fetch-filecache-for-crawling; hit";
    return new Response(readable, { url, status, headers });
  }

  async function saveToCacheIfNeeded(response, prevHeaders) {
    // Not needed if response is the one we have in cache
    // (but we'll still update the "received" date if we can to note that we
    // checked the cache entry)
    if (response.status === 304) {
      if (!prevHeaders) {
        log('response is not in cache but client has it');
        return false;
      }
      else {
        log('response in cache is still valid');
        prevHeaders.received = (new Date()).toUTCString();
        response.headers.forEach((value, header) => {
          if ((header === 'expires') || (header === 'cache-control') || (header === 'date')) {
            prevHeaders[header] = value;
          }
        });
        try {
          await fs.promises.writeFile(cacheHeadersFilename, JSON.stringify(prevHeaders, null, 2), 'utf8');
        }
        catch (err) {
        }
        return true;
      }
    }

    log('fetch and save response to cache');
    return new Promise(async (resolve, reject) => {
      let writable = fs.createWriteStream(cacheFilename);
      writable.on('close', _ => {
        let headers = { status: response.status, received: (new Date()).toUTCString() };
        response.headers.forEach((value, header) => headers[header] = value);
        fs.promises.writeFile(cacheHeadersFilename, JSON.stringify(headers, null, 2), 'utf8')
          .then(_ => resolve(true)).catch(reject);
      });
      writable.on('error', reject);
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          writable.close();
          break;
        }
        else {
          writable.write(chunk.value);
        }
      }
    });
  }

  async function conditionalFetch(prevHeaders) {
    options.headers = options.headers || {};
    if (prevHeaders && prevHeaders['last-modified'] && !isRequestCacheAware) {
      options.headers['If-Modified-Since'] = prevHeaders['last-modified'];
    }
    if (prevHeaders && prevHeaders.etag && !isRequestCacheAware) {
      options.headers['If-None-Match'] = prevHeaders.etag;
    }
    if (getHeaderValue(options.headers, 'If-Modified-Since') ||
        getHeaderValue(options.headers, 'If-None-Match')) {
      log('send conditional request');
    }
    else {
      log('send regular request');
    }

    // To overcome transient network errors, we'll fetch the same URL again
    // a few times before we surrender when a network error occurs, letting
    // a few seconds elapse between attempts
    async function fetchWithRetry(url, options, remainingAttempts) {
      try {
        return await fetch(url, options);
      }
      catch (err) {
        if ((err.name === 'AbortError') || (remainingAttempts <= 0)) throw err;
        log('fetch attempt failed, sleep and try again');
        await sleep(2000 + Math.floor(Math.random() * 8000));
        return await fetchWithRetry(url, options, remainingAttempts - 1);
      }
    }

    let response = await fetchWithRetry(url, options, 3);
    const inCache = await saveToCacheIfNeeded(response, prevHeaders);
    if (inCache) {
      return readFromCache();
    }
    else {
      // This happens when agent set an If-None-Match or If-Modified-Since
      // header, server returned a 304, and we don't yet have the resource in
      // the file cache. Let's just transparently pass the response over to the
      // agent.
      return response;
    }
  }

  log('fetch ' + url);
  await checkCacheFolder();
  if (isFetchPending()) {
    // There is a pending fetch, wait for that fetch to finish and reuse the
    // cached answer (NB: we cannot reuse the Response object directly because
    // response body stream can only be read once)
    let pendingFetch = await pendingFetchIsOver();

    log('pending request over, return response from cache');
    return readFromCache();
  }
  else {
    addPendingFetch();
    try {
      let headers = await readHeadersFromCache();
      if (hasExpired(headers, config.refresh)) {
        let response = await conditionalFetch(headers);
        resolvePendingFetch();
        return response;
      }
      else {
        resolvePendingFetch();
        return readFromCache();
      }
    }
    catch (err) {
      rejectPendingFetch(err);
      throw err;
    }
  }
}

module.exports = cacheFetch;
module.exports.setParameter = function (name, value) {
  globalConfig[name] = value;
}
