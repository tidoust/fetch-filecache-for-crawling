# Implementation of fetch with a file-based HTTP cache for crawling purpose

Node.js module that exports a `fetch` function that extends the implementation
of Node.js native `fetch` to add an HTTP cache using a local cache folder.

The code was developed for a particular scenario with specific requirements in
mind, and no attempts were made to generalize them. Publication as an npm
package is mostly intended to ease reuse by a couple of specific projects.

Typically, the module is intended to be used for crawling purpose and makes the
following assumptions, which do not hold true in other cases:

1. The user is only interested in GET requests (although this will be fixed,
see [#3](https://github.com/tidoust/fetch-filecache-for-crawling/issues/3))
2. The HTTP headers sent with the request do not matter for the response
(although this will be fixed as well, see
[#3](https://github.com/tidoust/fetch-filecache-for-crawling/issues/3))
3. The user wants to preserve cached files in a folder, even after the
application is done running. That file cache will be used upon next run of the
application to send conditional requests.
4. The user will want to control the cache expiration strategy, through the
`refresh` parameter. By default, the cache follows HTTP expiration rules but
setting the parameter to e.g. `once` will make the cache behave completely
differently. The ability to tweak that behavior is the module's main added
value!


## Installation

Run `npm install fetch-filecache-for-crawling`.

## Usage

```js
const fetch = require('fetch-filecache-for-crawling');

// URLs to crawl, some of which may be identical
let urls = [
  'https://caniuse.com/data.json',
  'https://caniuse.com/data.json'
]

Promise.all(urls.map(url =>
  fetch(url, { logToConsole: true })
    .then(response => response.json())
    .then(json => console.log(Object.keys(json.data).length +
      ' entries in Can I Use'))
)).catch(err => console.error(err));
```

## Configuration

On top of usual `fetch` options, the following optional parameters can be
passed to `fetch` in the `options` parameter to change default behavior:

- `cacheFolder`: the name of the cache folder to use. By default, the code caches all files in a folder named `.cache`.
- `resetCache`: set to `true` to empty the cache folder when the application starts. Defaults to `false`. Note that the cache folder will only be reset once, regardless of whether the parameter is set to `true` in subsequent calls to `fetch`.
- `refresh`: the refresh strategy to use for the cache. Values can be one of:
  - `force`: Always consider that the content in the cache has expired
  - `default`: Follow regular HTTP rules (that is the mode by default)
  - `once`: Fetch the URL at least once, but consider the cached entry to then be valid throughout the lifetime of the application
  - `never`: Always consider that the content in the cache is valid
  - an integer: Consider that cache entries are valid for the given period of time (in seconds)
- `logToConsole`: set to `true` to output progress messages to the console. Defaults to `false`. All messages start with the ID of the request to be able to distinguish between them.

For instance, you may do:

```js
const fetch = require('fetch-filecache-for-crawling');

fetch('https://www.w3.org/', {
  resetCache: true,
  cacheFolder: 'mycache',
  logToConsole: true
}).then(response => {});
```

Configuration parameters may also be set for all requests programmatically by calling `fetch.setParameter(name, value)` where `name` is the name of the parameter to set and `value` the value to set it to. Note parameters passed in `options` take precedence).

## Licensing

The code is available under an [MIT license](LICENSE).
