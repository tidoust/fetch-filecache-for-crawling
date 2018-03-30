/**
 * Implementation of a `fetch` that extends the implementation from `node-fetch`
 * to add caching support to a local cache folder.
 *
 * @module fetch-filecache
 */

const URL = require('url');
const filenamify = require('filenamify-url');
const baseFetch = require('node-fetch');
const Response = require('node-fetch').Response;
const rimraf = require('rimraf');
const path = require('path');
const promisifyRequire = require('promisify-require');
const fs = promisifyRequire('fs');

let globalConfig = null;
try {
  globalConfig = require(path.resolve('config.json'));
}
catch (e) {
  globalConfig = {};
};


// The list of URLs that are being fetched and that should soon
// be available from the cache, together with the Promise to have
// fetched them
const pendingFetches = {};

// The list of URLs that have been fetched (and that exist in the cache) per
// cache folder during the lifetime of the application. Used as a basic
// "max-age" mechanism to avoid sending multiple requests to the same URL
// during a run of the underlying application.
const fetchedUrls = [];

// Reset the cache folder only once
let cacheFolderReset = {};

// Request counter
let counter = 0;


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
async function fetch(url, options) {
  const cacheFilename = 'cache/' + filenamify(url);
  const cacheHeadersFilename = cacheFilename + '.headers';
  options = options || {};

  // Increment request counter and save it locally for logging purpose
  counter += 1;
  let requestId = counter;

  // Specific parameters given in `options` override possible settings read
  // from the `config.json` file.
  const config = {
    cacheFolder: options.cacheFolder || globalConfig.cacheFolder || 'cache',
    resetCache: options.hasOwnProperty('resetCache') ?
      options.resetCache :
      globalConfig.resetCache || false,
    avoidNetworkRequests: options.hasOwnProperty('avoidNetworkRequests') ?
      options.avoidNetworkRequests :
      globalConfig.avoidNetworkRequests || false,
    logToConsole: options.hasOwnProperty('logToConsole') ?
      options.logToConsole :
      globalConfig.logToConsole || false
  };

  if (config.resetCache && !cacheFolderReset[config.cacheFolder]) {
    cacheFolderReset[config.cacheFolder] = true;
    await rimraf(config.cacheFolder + '/*');
  }
  fetchedUrls[config.cacheFolder] = fetchedUrls[config.cacheFolder] || [];

  function log(msg) {
    if (!config.logToConsole) return;
    console.log(requestId + ' - ' + msg);
  }

  async function checkCacheFolder() {
    try {
      let stat = await fs.stat(config.cacheFolder);
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
        await fs.mkdir(config.cacheFolder);
      }
      catch (mkerr) {
        // Someone may have created the folder in the meantime
        if (mkerr.code !== 'EEXIST') {
          throw mkerr;
        }
      }
    }
  }

  async function getPendingFetch() {
    if (pendingFetches[url]) {
      log('wait for pending request');
      return pendingFetches[url].promise;
    }
    else {
      return false;
    }
  }

  /**
   * Create a pending fetch promise and keep controls over that promise so that
   * the code may resolve or reject it through calls to resolvePendingFetch and
   * rejectPendingFetch functions
   */
  function addPendingFetch(url) {
    let resolve = null;
    let reject = null;
    let promise = new Promise((innerResolve, innerReject) => {
      resolve = innerResolve;
      reject = innerReject;
    });
    pendingFetches[url] = { promise, resolve, reject };
  }

  function resolvePendingFetch(url) {
    if (!pendingFetches[url]) return;
    pendingFetches[url].resolve(true);
    delete pendingFetches[url];
  }

  function rejectPendingFetch(url, err) {
    if (!pendingFetches[url]) return;
    pendingFetches[url].reject(err);
    delete pendingFetches[url];
  }

  async function readHeadersFromCache() {
    try {
      let data = await fs.readFile(cacheHeadersFilename);
      let headers = JSON.parse(data, 'utf8');
      return headers;
    }
    catch (err) {
      // Ignore cache/JSON errors for now, falling back to a network request
      // TODO: throw or report?
    }
  }

  async function readFromCache() {
    let data = await fs.readFile(cacheHeadersFilename, 'utf8');
    let headers = JSON.parse(data);
    data = await fs.readFile(cacheFilename, 'utf8');
    return new Response(data, {
      url,
      status: 200,
      headers
    });
  }

  async function saveToCacheIfNeeded(response) {
    // Not needed if response is the one we have in cache
    if (response.status === 304) {
      log('response in cache is still valid');
      return;
    }

    log('save response to cache');
    const headers = {};
    response.headers.forEach((value, header) => headers[header] = value);
    await fs.writeFile(
        cacheHeadersFilename,
        JSON.stringify(headers, null, 2),
        'utf8');
    
    let data = await response.text();
    await fs.writeFile(cacheFilename, data, 'utf8');
  }

  async function conditionalFetch(prevHeaders) {
    if ((prevHeaders && config.avoidNetworkRequests) || fetchedUrls[config.cacheFolder][url]) {
      log('use cached version directly');
      return readFromCache();
    }

    options.headers = options.headers || {};
    if (prevHeaders && prevHeaders['last-modified']) {
      options.headers['If-Modified-Since'] = prevHeaders['last-modified'];
    }
    if (prevHeaders && prevHeaders.etag) {
      options.headers['If-None-Match'] = prevHeaders.etag;
    }

    if (options.headers['If-Modified-Since'] ||
        options.headers['If-None-Match']) {
      log('response in cache, send conditional request');
    }
    else {
      log('send regular request');
    }

    // To overcome transient network errors, we'll fetch the same URL again
    // a few times before we surrender when a network error occurs, letting
    // a few seconds elapse between attempts
    async function fetchWithRetry(url, options, remainingAttempts) {
      try {
        return baseFetch(url, options);
      }
      catch (err) {
        if (remainingAttempts <= 0) throw err;
        log('fetch attempt failed');
        return new Promise((resolve, reject) => {
          setTimeout(function () {
            fetchWithRetry(url, options, remainingAttempts - 1)
              .then(resolve)
              .catch(reject);
          }, 2000 + Math.floor(Math.random() * 8000));
        });
      }
    }

    let response = await fetchWithRetry(url, options, 3);
    await saveToCacheIfNeeded(response);

    log('return response from cache');
    return readFromCache();
  }

  log('fetch ' + url);
  await checkCacheFolder();
  let pendingFetchWasOngoing = await getPendingFetch();
  if (pendingFetchWasOngoing) {
    // There was a pending fetch, reuse the cached answer
    // (NB: we would not be able to reuse the Response object directly because
    // response body stream can only be read once)
    log('pending request over, return response from cache');
    return readFromCache();
  }
  else {
    addPendingFetch(url);
    try {
      let headers = await readHeadersFromCache();
      let response = await conditionalFetch(headers);
      fetchedUrls[config.cacheFolder][url] = true;
      resolvePendingFetch(url);
      return response;
    }
    catch (err) {
      rejectPendingFetch(url, err);
      throw err;
    }
  }
}

module.exports = fetch;