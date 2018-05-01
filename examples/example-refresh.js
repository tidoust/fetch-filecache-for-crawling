/**
 * Refresh modes example
 *
 * Run with `node example-refresh.js`.
 * 
 * By default, the library will act as a regular HTTP cache and follow rules
 * specified in HTTP headers (the `Expires` and `Cache-Control` directives).
 * The `refresh` parameter allows to change this behavior.
 *
 * The `refresh` parameter can take any of the following values:
 * - force: Always consider that the content in the cache has expired
 * - default: Follow regular HTTP rules (that's the default mode)
 * - once: Fetch the URL at least once, but consider the cached entry to then
 * be valid throughout the lifetime of the application
 * - never: Always consider that the content in the cache is valid
 * - an integer: Consider that cache entries are valid for the given period of
 *   time (in seconds)
 */
const fetch = require('../');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

fetch.setConfigParam('logToConsole', true);
fetch('https://api.github.com/users/tidoust', { refresh: 'once' })
  .then(_ => fetch('https://api.github.com/users/tidoust', { refresh: 'default' }))
  .then(_ => fetch('https://api.github.com/users/tidoust', { refresh: 'force' }))
  .then(_ => fetch('https://api.github.com/users/tidoust', { refresh: 'never' }))
  .then(_ => sleep(5000))
  .then(_ => fetch('https://api.github.com/users/tidoust', { refresh: 5 }))
  .then(_ => fetch('https://api.github.com/users/tidoust', { refresh: 300 }))
  .catch(err => console.error(err));